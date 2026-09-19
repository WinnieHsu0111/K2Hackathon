import Phaser from 'phaser';
import { GameSession, MAP, TILE, DOOR_CODE, QUESTION, MONSTER_STATE, LIGHTS, LIGHT_COLORS } from './level.js';
import { createThreatAudio } from './audio.js';
import './style.css';
import { createAgentPanel } from './agent-panel.js';

const byId = (id) => document.getElementById(id);
const updateText = (element, value) => { if (element.textContent !== value) element.textContent = value; };

class GameUI {
  constructor() {
    this.dialog = byId('interaction');
    this.currentModal = null;
    byId('question-rule').textContent = QUESTION.rule;
    byId('question-prompt').textContent = QUESTION.prompt;
    byId('answers').replaceChildren(...QUESTION.options.map((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${option.id}.  ${option.value}`;
      button.onclick = () => { this.onManual?.(); this.session.answer(option.id); this.close(); };
      return button;
    }));
    byId('lock-form').onsubmit = (event) => {
      event.preventDefault();
      this.onManual?.();
      if (this.session.unlock(byId('door-code').value)) this.close();
      else {
        byId('lock-error').textContent = 'Incorrect code. Check the three digits on the key tag again.';
        byId('door-code').select();
      }
    };
    byId('close-dialog').onclick = () => { this.onManual?.(); this.close(); };
    byId('replay-lights').onclick = () => { this.onManual?.(); this.session.playLightSequence(); };
    this.dialog.oncancel = (event) => { event.preventDefault(); this.onManual?.(); this.close(); };
  }

  bind(session, keyboard) {
    this.close();
    this.session = session;
    this.keyboard = keyboard;
  }

  close() {
    this.session?.dismiss();
    if (this.dialog.open) this.dialog.close();
    this.currentModal = null;
    if (this.keyboard) {
      this.keyboard.resetKeys();
      this.keyboard.enabled = true;
    }
  }

  sync() {
    const session = this.session;
    updateText(byId('status'), session.message);
    updateText(byId('inventory'), !session.firstGateOpen ? `LIGHT CODE ${session.lightInput.length}/4` : session.hasKey ? `KEY ✓  /  CODE ${DOOR_CODE}` : 'KEY —');
    let threat = 'No threats detected';
    if (session.won) threat = 'Escaped successfully';
    else if (session.monsterActive) {
      if (session.playerInSafeZone) threat = 'Safe zone · Monster on patrol';
      else if (session.wakeRemaining > 0) threat = 'Anomaly awakening · Move away from the doorway now';
      else if (session.monster.state === MONSTER_STATE.CHASE) threat = 'Spotted · Head to the safe zone';
      else if (session.monster.state === MONSTER_STATE.SEARCH) threat = 'Monster searching · Stay hidden';
      else threat = 'Monster patrolling · Stay out of sight';
    } else if (session.playerInSafeZone) threat = 'Safe zone';
    updateText(byId('threat'), threat);
    byId('threat').dataset.active = String(session.monsterActive && !session.playerInSafeZone && session.monster.state === MONSTER_STATE.CHASE);

    if (!session.modal && this.currentModal) this.close();
    if (session.modal && this.currentModal !== session.modal) {
      this.currentModal = session.modal;
      const isLock = session.modal === 'lock';
      const isLight = session.modal === 'lights';
      byId('lock-panel').hidden = !isLock;
      byId('document-panel').hidden = isLock || isLight;
      byId('light-panel').hidden = !isLight;
      byId('dialog-title').textContent = isLight ? 'Memorize the light sequence' : isLock ? 'Enter the code' : `FILE #${QUESTION.id}`;
      byId('dialog-label').textContent = isLight ? 'LIGHT CODE / FIRST GATE' : isLock ? 'ACCESS CONTROL / LOCKED' : 'RECOVERED DOCUMENT';
      byId('lock-error').textContent = '';
      byId('door-code').value = '';
      this.keyboard.resetKeys();
      this.keyboard.enabled = false;
      this.dialog.showModal();
      if (isLock) byId('door-code').focus();
      else if (isLight) byId('close-dialog').focus();
      else byId('answers').querySelector('button').focus();
    }
    if (session.modal === 'lights') {
      updateText(byId('light-playback-status'), session.lightNotice);
      updateText(byId('light-current'), session.activeLight ? `${session.activeLight} · ${LIGHTS[session.activeLight]}` : '—');
      for (const light of document.querySelectorAll('[data-light]')) light.classList.toggle('lit', Number(light.dataset.light) === session.activeLight);
      byId('replay-lights').disabled = session.lightPhase === 'playback';
    }
    byId('close-dialog').textContent = session.modal === 'lights' && session.lightPhase === 'input' ? 'Return to the room and enter the sequence →' : 'Leave for now · ESC';
  }
}

const ui = new GameUI();
const audio = createThreatAudio(byId('sound-toggle'));

class Backrooms extends Phaser.Scene {
  constructor() { super('Backrooms'); }

  label(x, y, text, color = '#d8cc91', size = 14) {
    return this.add.text(x, y, text, { fontFamily: 'monospace', fontSize: `${size}px`, color }).setOrigin(0.5);
  }

  create() {
    this.session = new GameSession();
    this.lastRespawns = 0;
    this.finished = false;
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SHIFT,R,F');
    this.lightButtons = {};
    ui.bind(this.session, this.input.keyboard);
    this.agentPanel = createAgentPanel(this.session, () => this.scene.restart());
    ui.onManual = () => { if (this.agentPanel.controller.active) this.agentPanel.controller.pause('Manual interaction has taken over.'); };
    byId('backend-url').onfocus = () => { this.input.keyboard.resetKeys(); this.input.keyboard.enabled = false; };
    byId('backend-url').onblur = () => { this.input.keyboard.resetKeys(); this.input.keyboard.enabled = !this.session.modal; };
    this.events.once('shutdown', () => { this.agentPanel.destroy(); ui.close(); });

    MAP.forEach((row, y) => [...row].forEach((cell, x) => {
      const px = x * TILE + TILE / 2, py = y * TILE + TILE / 2;
      if (cell === '#') {
        this.add.rectangle(px, py, TILE, TILE, 0x8d8249).setStrokeStyle(2, 0x645b31);
        this.add.rectangle(px, py + 17, TILE - 4, 8, 0x716739);
        return;
      }
      this.add.rectangle(px, py, TILE, TILE, (x + y) % 2 ? 0x655d36 : 0x6b6239).setStrokeStyle(1, 0x595132);
      if (Object.hasOwn(LIGHTS, cell)) {
        const bulb = this.add.circle(px, py, 16, LIGHT_COLORS[cell]).setStrokeStyle(2, LIGHT_COLORS[cell]);
        const label = this.label(px, py, cell, '#111810', 18);
        this.lightButtons[cell] = { bulb, label };
      }
      if (cell === 'C') {
        this.add.rectangle(px, py, 36, 32, 0x253d3a).setStrokeStyle(2, 0x8abcb0);
        this.label(px, py - 2, 'C', '#d8eee4', 18);
        this.label(px, py + 21, 'F · PLAY', '#b9d7c6', 8);
      }
      if (cell === 'K') {
        this.keyMarker = this.add.container(px, py, [
          this.add.circle(-4, -3, 7, 0xebcf63).setStrokeStyle(2, 0xf9e9a8),
          this.add.rectangle(5, 5, 5, 20, 0xebcf63).setRotation(-0.65),
          this.add.rectangle(10, 8, 8, 4, 0xebcf63),
        ]);
      }
      if (cell === 'A' || cell === 'L' || cell === 'G') {
        const block = this.add.rectangle(px, py, TILE - 4, TILE - 4, cell === 'L' ? 0x413e2b : 0x404637)
          .setStrokeStyle(2, cell === 'L' ? 0xe0bd69 : 0xacae83);
        const title = cell === 'A' ? 'CODE' : cell === 'L' ? 'LOCK' : 'GATE';
        const label = this.label(px, py, title, '#e1d299', 10);
        this[cell === 'A' ? 'firstGate' : cell === 'L' ? 'lockDoor' : 'questionGate'] = { block, label, title };
      }
      if (cell === 'T') {
        this.add.rectangle(px, py, TILE, TILE, 0x39261c).setStrokeStyle(2, 0xa56837);
        this.label(px, py - 1, '×', '#e2a760', 34);
      }
      if (cell === 'D') {
        this.paper = this.add.container(px, py, [
          this.add.rectangle(0, 0, 27, 34, 0xe4dcc0).setStrokeStyle(2, 0x9e956f),
          this.add.rectangle(0, -6, 15, 2, 0x7d795f),
          this.add.rectangle(0, 0, 15, 2, 0x7d795f),
          this.add.rectangle(-3, 6, 9, 2, 0x7d795f),
        ]);
      }
      if (cell === 'S') {
        this.add.rectangle(px, py, TILE - 2, TILE - 2, 0x2a6c5e).setStrokeStyle(1, 0x8dccb5);
        this.label(px, py, 'S', '#b4e2cd', 20);
      }
      if (cell === 'E') {
        this.add.rectangle(px, py, 36, 40, 0x4b9166).setStrokeStyle(2, 0xc2e8b5);
        this.label(px, py, 'EXIT', '#e0f4c2', 10);
      }
    }));

    this.player = this.add.rectangle(this.session.player.x, this.session.player.y, 18, 18, 0xede4bd)
      .setStrokeStyle(2, 0x302c1a).setDepth(2);
    this.monster = this.add.container(0, 0, [
      this.add.rectangle(0, 0, 24, 24, 0x1b1010).setStrokeStyle(2, 0xb84339),
      this.add.rectangle(-5, -4, 4, 4, 0xffbf83),
      this.add.rectangle(5, -4, 4, 4, 0xffbf83),
    ]).setDepth(3).setVisible(false);
    this.cameras.main.setBounds(0, 0, MAP[0].length * TILE, MAP.length * TILE);
    this.cameras.main.startFollow(this.player, true);

    // Circular gradient field of view; wall occlusion is not implemented in this version.
    if (!this.textures.exists('darkness')) {
      const size = 2048;
      const texture = this.textures.createCanvas('darkness', size, size);
      const ctx = texture.context;
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 50, size / 2, size / 2, 225);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.7, 'rgba(0,0,0,0.40)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.98)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      texture.refresh();
    }
    this.darkness = this.add.image(this.player.x, this.player.y, 'darkness').setDepth(10);
    this.renderState();
  }

  renderState() {
    const state = this.session;
    this.player.setPosition(state.player.x, state.player.y);
    this.darkness.setPosition(state.player.x, state.player.y);
    this.keyMarker.setVisible(!state.hasKey);
    this.paper.setAlpha(state.documentAnswered ? 0.35 : 1);
    this.monster.setVisible(state.monsterActive).setPosition(state.monster.x, state.monster.y);
    for (const [door, open] of [[this.firstGate, state.firstGateOpen], [this.lockDoor, state.lockOpen], [this.questionGate, state.gateOpen]]) {
      door.block.setAlpha(open ? 0.15 : 1);
      door.label.setText(open ? 'OPEN' : door.title);
    }
    for (const [id, light] of Object.entries(this.lightButtons)) {
      const active = Number(id) === state.activeLight;
      light.bulb.setAlpha(active ? 1 : 0.5).setScale(active ? 1.15 : 1);
    }
    if (state.respawns !== this.lastRespawns) {
      this.lastRespawns = state.respawns;
      this.cameras.main.flash(180, 116, 41, 20);
    }
    if (state.won && !this.finished) {
      this.finished = true;
      this.add.text(480, 288, 'LEVEL 0 COMPLETE\n\nPress R to restart', {
        fontFamily: 'monospace', fontSize: '26px', align: 'center', color: '#eee6ba',
        backgroundColor: '#171710', padding: { x: 28, y: 24 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
    }
    ui.sync();
    this.agentPanel.sync();
    audio.update(state);
  }

  update(_time, delta) {
    const agent = this.agentPanel.controller;
    const typing = document.activeElement?.matches('input, textarea');
    const humanInput = !typing && this.input.keyboard.enabled &&
      [this.keys.W, this.keys.A, this.keys.S, this.keys.D, this.keys.F, this.keys.R,
        this.cursors.up, this.cursors.down, this.cursors.left, this.cursors.right].some((key) => key.isDown);
    if (humanInput && agent.active) agent.pause('Manual control has taken over. K2 paused.');
    if (agent.tick(delta)) { this.renderState(); return; }
    if (typing && !this.session.modal) { this.renderState(); return; }
    if (this.session.modal) {
      this.session.update(delta);
      this.renderState();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      this.input.keyboard.resetKeys();
      this.scene.restart();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) this.session.interact();
    const x = Number(this.keys.D.isDown || this.cursors.right.isDown) - Number(this.keys.A.isDown || this.cursors.left.isDown);
    const y = Number(this.keys.S.isDown || this.cursors.down.isDown) - Number(this.keys.W.isDown || this.cursors.up.isDown);
    this.session.update(delta, { x, y, sprint: this.keys.SHIFT.isDown });
    this.renderState();
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 576,
  backgroundColor: '#15150f',
  pixelArt: true,
  audio: { noAudio: true },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [Backrooms],
});

if (import.meta.hot) import.meta.hot.dispose(() => { ui.close(); audio.destroy(); game.destroy(true); });
