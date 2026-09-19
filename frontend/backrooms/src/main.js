import Phaser from 'phaser';
import { GameSession, MAP, TILE, DOOR_CODE, QUESTION, MONSTER_STATE } from './level.js';
import { createThreatAudio } from './audio.js';
import { K2Driver } from './k2driver.js';
import './style.css';

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
      button.onclick = () => { this.session.answer(option.id); this.close(); };
      return button;
    }));
    byId('lock-form').onsubmit = (event) => {
      event.preventDefault();
      if (this.session.unlock(byId('door-code').value)) this.close();
      else {
        byId('lock-error').textContent = '密碼不符。再看一次鑰匙牌上的三位數。';
        byId('door-code').select();
      }
    };
    byId('close-dialog').onclick = () => this.close();
    this.dialog.oncancel = (event) => { event.preventDefault(); this.close(); };
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
    updateText(byId('inventory'), session.hasKey ? `KEY ✓  /  CODE ${DOOR_CODE}` : 'KEY —');
    let threat = '未偵測到威脅';
    if (session.won) threat = '已成功逃離';
    else if (session.monsterActive) {
      if (session.playerInSafeZone) threat = '安全區 · 怪物正在巡邏';
      else if (session.wakeRemaining > 0) threat = '異常甦醒中 · 立刻離開門口';
      else if (session.monster.state === MONSTER_STATE.CHASE) threat = '被發現了 · 前往安全區';
      else if (session.monster.state === MONSTER_STATE.SEARCH) threat = '怪物搜尋中 · 保持隱蔽';
      else threat = '怪物巡邏中 · 避開視線';
    } else if (session.playerInSafeZone) threat = '安全區';
    updateText(byId('threat'), threat);
    byId('threat').dataset.active = String(session.monsterActive && !session.playerInSafeZone && session.monster.state === MONSTER_STATE.CHASE);

    if (session.modal && this.currentModal !== session.modal) {
      this.currentModal = session.modal;
      const isLock = session.modal === 'lock';
      byId('lock-panel').hidden = !isLock;
      byId('document-panel').hidden = isLock;
      byId('dialog-title').textContent = isLock ? '輸入密碼' : `FILE #${QUESTION.id}`;
      byId('dialog-label').textContent = isLock ? 'ACCESS CONTROL / LOCKED' : 'RECOVERED DOCUMENT';
      byId('lock-error').textContent = '';
      byId('door-code').value = '';
      this.keyboard.resetKeys();
      this.keyboard.enabled = false;
      this.dialog.showModal();
      if (isLock) byId('door-code').focus();
      else byId('answers').querySelector('button').focus();
    }
  }
}

const ui = new GameUI();
const audio = createThreatAudio(byId('sound-toggle'));

// Append a K2 reasoning event to the side panel.
function appendReasoning(evt) {
  const panel = byId('reasoning');
  if (!panel) return;
  const line = document.createElement('div');
  line.className = `reason-line reason-${evt.type}`;
  if (evt.type === 'decision') {
    line.innerHTML = `<b>→ ${evt.intent}</b>${evt.answerId ? ` (${evt.answerId})` : ''}<br>${evt.reasoning ?? ''}`;
  } else if (evt.type === 'agent_thinking') {
    line.textContent = `${evt.agent}：${evt.message}`;
  } else if (evt.type === 'agent_result') {
    line.innerHTML = `<b>${evt.agent}</b>：${evt.content}`;
  } else {
    line.textContent = evt.message ?? '';
  }
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
  // Keep the panel from growing unbounded.
  while (panel.children.length > 40) panel.removeChild(panel.firstChild);
}

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
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SHIFT,R,K');
    ui.bind(this.session, this.input.keyboard);

    // K2 auto-play driver. Toggle via K key or the #k2-toggle button.
    this.k2 = new K2Driver((evt) => appendReasoning(evt));
    this.k2.setQuestion(QUESTION);
    const k2btn = byId('k2-toggle');
    if (k2btn) {
      k2btn.onclick = () => {
        this.k2.enabled = !this.k2.enabled;
        k2btn.setAttribute('aria-pressed', String(this.k2.enabled));
        k2btn.textContent = this.k2.enabled ? 'K2 自動遊玩：開' : 'K2 自動遊玩：關';
        appendReasoning({ type: 'status', message: this.k2.enabled ? 'K2 自動遊玩：開啟' : 'K2 自動遊玩：關閉' });
      };
    }
    this.events.once('shutdown', () => ui.close());

    MAP.forEach((row, y) => [...row].forEach((cell, x) => {
      const px = x * TILE + TILE / 2, py = y * TILE + TILE / 2;
      if (cell === '#') {
        this.add.rectangle(px, py, TILE, TILE, 0x8d8249).setStrokeStyle(2, 0x645b31);
        this.add.rectangle(px, py + 17, TILE - 4, 8, 0x716739);
        return;
      }
      this.add.rectangle(px, py, TILE, TILE, (x + y) % 2 ? 0x655d36 : 0x6b6239).setStrokeStyle(1, 0x595132);
      if (cell === 'K') {
        this.keyMarker = this.add.container(px, py, [
          this.add.circle(-4, -3, 7, 0xebcf63).setStrokeStyle(2, 0xf9e9a8),
          this.add.rectangle(5, 5, 5, 20, 0xebcf63).setRotation(-0.65),
          this.add.rectangle(10, 8, 8, 4, 0xebcf63),
        ]);
      }
      if (cell === 'L' || cell === 'G') {
        const block = this.add.rectangle(px, py, TILE - 4, TILE - 4, cell === 'L' ? 0x413e2b : 0x404637)
          .setStrokeStyle(2, cell === 'L' ? 0xe0bd69 : 0xacae83);
        const label = this.label(px, py, cell === 'L' ? 'LOCK' : 'GATE', '#e1d299', 10);
        this[cell === 'L' ? 'lockDoor' : 'questionGate'] = { block, label };
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

    // 圓形漸層視野；此版本尚未實作牆壁遮光。
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
    for (const [door, open] of [[this.lockDoor, state.lockOpen], [this.questionGate, state.gateOpen]]) {
      door.block.setAlpha(open ? 0.15 : 1);
      door.label.setText(open ? 'OPEN' : door === this.lockDoor ? 'LOCK' : 'GATE');
    }
    if (state.respawns !== this.lastRespawns) {
      this.lastRespawns = state.respawns;
      this.cameras.main.flash(180, 116, 41, 20);
    }
    if (state.won && !this.finished) {
      this.finished = true;
      this.add.text(480, 288, 'LEVEL 0 COMPLETE\n\n按 R 重新開始', {
        fontFamily: 'monospace', fontSize: '26px', align: 'center', color: '#eee6ba',
        backgroundColor: '#171710', padding: { x: 28, y: 24 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
    }
    ui.sync();
    audio.update(state);
  }

  update(_time, delta) {
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      this.input.keyboard.resetKeys();
      this.scene.restart();
      return;
    }
    // Toggle K2 auto-play with the K key.
    if (Phaser.Input.Keyboard.JustDown(this.keys.K)) {
      this.k2.enabled = !this.k2.enabled;
      appendReasoning({ type: 'status', message: this.k2.enabled ? 'K2 自動遊玩：開啟' : 'K2 自動遊玩：關閉' });
    }

    if (this.k2.enabled) {
      // K2 drives — it can also resolve modals (lock/document), so run before the modal guard.
      const input = this.k2.step(this.session, delta);
      if (!this.session.modal) this.session.update(delta, input);
      this.renderState();
      return;
    }

    if (this.session.modal) return;
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
