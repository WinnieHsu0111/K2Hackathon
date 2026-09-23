import Phaser from 'phaser';
import { GameSession, MAP, TILE, MONSTER_STATE, LIGHTS, LIGHT_COLORS } from './level.js';
import { createThreatAudio } from './audio.js';
import './style.css';
import { getObservation } from './observation.js';
import { SYMBOLS } from './puzzles.js';
import { createAgentPanel } from './agent-panel.js';
import { createComparePanel } from './compare-panel.js';
import { createMinimap } from './minimap.js';
import { createScene3D } from './scene3d.js';
import { createMission } from './mission.js';

const byId = (id) => document.getElementById(id);
const updateText = (element, value) => { if (element.textContent !== value) element.textContent = value; };

class GameUI {
  constructor() {
    this.dialog = byId('interaction');
    this.currentModal = null;
    this.lastMessage = '';
    this.lastGateOpen = false;
    this.lastPathSolved = false;
    this.resultTimer = null;
    byId('lock-form').onsubmit = (event) => {
      event.preventDefault(); if (this.isAutonomous?.()) return;
      if (this.session.unlock(byId('door-code').value)) this.close();
      else { byId('lock-error').textContent = 'ACCESS DENIED. Check the four-digit code on your key.'; byId('door-code').select(); }
    };
    byId('close-dialog').onclick = () => { if (this.isAutonomous?.()) return; this.close(); };
    byId('replay-lights').onclick = () => { if (this.isAutonomous?.()) return; this.session.playLightSequence(); };
    this.dialog.oncancel = (event) => { event.preventDefault(); if (this.isAutonomous?.()) return; this.close(); };
    byId('start-game').onclick = () => this.session.start();
    byId('restart-dialog').onclick = () => this.onRestart?.();
    byId('light-input').replaceChildren(...Object.entries(LIGHTS).map(([id, color]) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = `${id} ${color}`;
      button.onclick = () => { if (!this.isAutonomous?.()) this.session.pressLight(Number(id)); };
      return button;
    }));
  }
  bind(session, keyboard) {
    this.close(); this.session = session; this.keyboard = keyboard;
    const question = session.question;
    byId('question-rule').textContent = question.rule;
    byId('question-prompt').textContent = question.prompt;
    byId('answers').replaceChildren(...question.options.map((option) => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = `${option.id}. ${option.value}`;
      button.onclick = () => { if (this.isAutonomous?.()) return; if (session.answer(option.id)) this.close(); };
      return button;
    }));
    byId('memory-answers').replaceChildren(...session.memoryOptions.map((sequence, index) => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = sequence.map((item) => SYMBOLS[item]).join('  ');
      button.setAttribute('aria-label', sequence.join(', '));
      button.onclick = () => { if (!this.isAutonomous?.()) session.answerMemory(index); };
      return button;
    }));
  }
  close() {
    this.session?.dismiss();
    if (this.dialog.open) this.dialog.close();
    this.currentModal = null;
    if (this.keyboard) { this.keyboard.resetKeys(); this.keyboard.enabled = true; }
  }
  sync() {
    const s = this.session;
    const result = byId('stage-result');
    const showResult = (html, failed = false, duration = 1800) => {
      if (!result) return;
      result.innerHTML = html;
      result.classList.toggle('fail', failed);
      result.classList.add('show');
      clearTimeout(this.resultTimer);
      this.resultTimer = setTimeout(() => result.classList.remove('show'), duration);
    };
    if (s.message !== this.lastMessage) {
      if (/AMBUSH|FALSE PATH|caught|monster was released/i.test(s.message)) {
        showResult('FAIL<br><small>CAUGHT BY THE MONSTER · RETURNING TO START</small>', true, 2400);
      } else if (/Path verified|Light puzzle solved|Door A is open/i.test(s.message)) {
        showResult('CORRECT<br><small>ONTO THE NEXT STAGE</small>');
      }
      this.lastMessage = s.message;
    }
    if (!this.lastGateOpen && s.firstGateOpen) showResult('CORRECT<br><small>ONTO THE NEXT STAGE</small>');
    if (!this.lastPathSolved && s.pathSolved) showResult('CORRECT<br><small>ROUTE REMEMBERED · ONTO THE NEXT STAGE</small>');
    this.lastGateOpen = s.firstGateOpen;
    this.lastPathSolved = s.pathSolved;
    updateText(byId('status'), s.message);
    const time = `${(s.timeLeft / 1000).toFixed(1)}s`;
    updateText(byId('timer'), time);
    byId('timer').dataset.urgent = String(s.timeLeft <= 15000);
    byId('start-screen').hidden = true;
    updateText(byId('inventory'), !s.firstGateOpen ? `LIGHT CODE ${s.lightInput.length}/3`
      : !s.memorySolved ? 'MEMORY ROOM' : !s.pathSolved ? 'CHOOSE A PATH' : s.hasKey ? `KEY ✓ / CODE ${s.doorCode}` : 'FIND THE KEY');
    let threat = 'No threats detected';
    if (s.dead) threat = 'YOU DIED';
    else if (s.won) threat = 'YOU ESCAPED';
    else if (s.monsterActive) threat = s.playerInSafeZone ? 'Safe zone · Monster on patrol' : `Monster: ${s.monster.state}`;
    updateText(byId('threat'), threat);
    byId('threat').dataset.active = String(s.monsterActive && !s.playerInSafeZone);
    if (!s.modal && this.currentModal) this.close();
    if (s.modal && this.currentModal !== s.modal) {
      this.currentModal = s.modal;
      for (const name of ['lock', 'light', 'document', 'memory']) byId(`${name}-panel`).hidden = s.modal !== (name === 'light' ? 'lights' : name);
      const titles = { lights: 'Remember three lights', lock: 'Enter the code', document: 'CALCULUS FILE', memory: 'Remember five symbols' };
      byId('dialog-title').textContent = titles[s.modal];
      byId('dialog-label').textContent = 'FIELD INTERACTION';
      byId('lock-error').textContent = ''; byId('door-code').value = '';
      this.keyboard.resetKeys(); this.keyboard.enabled = false;
      // Show inline (non-modal) so the map, minimap, and pipeline stay visible —
      // the interaction panel never blacks out the screen.
      this.dialog.show();
      document.querySelector('.question-rail').scrollTop = 0;
      if (s.modal === 'lock') byId('door-code').focus(); else byId('close-dialog').focus();
    }
    if (s.modal === 'lights') {
      updateText(byId('light-playback-status'), s.lightNotice);
      const observed = s.lightSequence.slice(0, s.lightsShown).map((id) => LIGHTS[id]);
      updateText(byId('light-current'), observed.length ? observed.join(' → ') : '—');
      const slots = [0, 1, 2].map((i) => `${'①②③'[i]} ${s.lightInput[i] ? LIGHTS[s.lightInput[i]] : '___'}`);
      updateText(byId('light-answer-slots'), `${slots.join('   ')}   ·   ${s.lightInput.length}/3`);
      for (const light of document.querySelectorAll('[data-light]')) light.classList.toggle('lit', Number(light.dataset.light) === s.activeLight);
      [...byId('light-input').children].forEach((button, i) => {
        button.disabled = s.lightPhase !== 'input';
        button.classList.toggle('pressed', s.lightFlashRemaining > 0 && s.pressedLight === i + 1);
      });
      byId('replay-lights').disabled = s.lightPhase === 'playback';
    }
    const revealing = s.memoryPhase === 'reveal';
    byId('memory-preview').textContent = revealing ? s.memorySequence.map((item) => SYMBOLS[item]).join('  ') : 'Symbols hidden';
    byId('memory-preview').setAttribute('aria-label', revealing ? s.memorySequence.join(', ') : 'Symbols hidden');
    byId('memory-answers').hidden = revealing;
    byId('memory-notice').textContent = revealing ? `MEMORY TEST · Memorize the complete five-symbol order · ${(s.memoryRemaining/1000).toFixed(1)}s` : 'Choose the option with the exact same five-symbol order. A wrong answer replays the reveal.';
    byId('close-dialog').textContent = 'Return to room · ESC';
  }
}

const ui = new GameUI();
const audio = createThreatAudio(byId('sound-toggle'));

class Backrooms extends Phaser.Scene {
  constructor() { super('Backrooms'); }

  label(x, y, text, color = '#d8cc91', size = 14) {
    return this.add.text(x, y, text, { fontFamily: 'monospace', fontSize: `${size}px`, color }).setOrigin(0.5);
  }

  create(data = {}) {
    this.session = new GameSession();
    if (data.autoStart) this.session.start();
    this.lastClock = performance.now();
    this.deathShownAt = null;
    this.memoryMarkers = [];
    this.memoryGates = [];
    this.lastRespawns = 0;
    this.finished = false;
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D,SHIFT,R,F');
    this.lightButtons = {};
    ui.bind(this.session, this.input.keyboard);
    this.agentPanel = createAgentPanel(this.session, () => this.scene.restart({ autoStart: true }), Boolean(data.autoStart));
    if (data.retryMemory) {
      const controller = this.agentPanel.controller;
      controller.evidence.triedPaths = [...data.retryMemory.triedPaths];
      controller.evidence.outcomes = [...data.retryMemory.outcomes];
      controller.trajectory = [...data.retryMemory.trajectory];
      this.session.blockedPath = data.retryMemory.blockedPath;
      this.session.pathAmbushTriggered = Boolean(data.retryMemory.blockedPath);
    }
    createComparePanel(byId('backend-url').value || 'http://127.0.0.1:8000');
    this.minimap = createMinimap();
    this.mission = createMission();
    try {
      this.view3d = createScene3D(byId('scene3d'));
      document.body.classList.add('has-3d');
    } catch (error) {
      console.error('3D renderer unavailable:', error);
      document.body.classList.remove('has-3d');
      byId('scene3d').textContent = '3D unavailable — showing the live 2D view.';
    }
    ui.onRestart = () => this.scene.restart({ autoStart: true });
    ui.isAutonomous = () => this.agentPanel.controller.active;
    byId('backend-url').onfocus = () => { this.input.keyboard.resetKeys(); this.input.keyboard.enabled = false; };
    byId('backend-url').onblur = () => { this.input.keyboard.resetKeys(); this.input.keyboard.enabled = !this.session.modal; };
    this.events.once('shutdown', () => { this.agentPanel.destroy(); this.view3d?.destroy(); this.view3d = null; ui.close(); });

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
      if (cell === 'B') {
        const marker = this.label(px, py, '?', '#b8d8c9', 26);
        this.memoryMarkers.push(marker);
      }
      if (cell === 'R') {
        this.add.rectangle(px, py, 36, 32, 0x253d3a).setStrokeStyle(2, 0x8abcb0);
        this.label(px, py, 'R', '#d8eee4', 18);
        this.label(px, py + 23, 'F · MEMORY', '#b9d7c6', 8);
      }
      if (y === 9 && [4,12,20].includes(x)) {
        this.memoryGates.push(this.add.rectangle(px, py, TILE-4, TILE-4, 0x404637).setStrokeStyle(2, 0x8abcb0));
        this.label(px, py-30, ['LEFT','CENTER','RIGHT'][[4,12,20].indexOf(x)], '#e0d4a0', 10);
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
    const mapW = MAP[0].length * TILE, mapH = MAP.length * TILE;
    // Main camera: teammate's immersive flashlight view — follows the player.
    this.cameras.main.setBounds(0, 0, mapW, mapH);
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
    // Spectator overlay: visualize engine waypoints without exposing them to K2.
    this.observationOverlay = this.add.graphics().setDepth(11);
    this.scanOverlay = this.add.graphics().setDepth(11);
    this.routeOverlay = this.add.graphics().setDepth(12);
    this.routeTarget = this.add.text(0, 0, 'TARGET', {fontFamily:'monospace',fontSize:'12px',color:'#7effe4',backgroundColor:'#111b18',padding:{x:5,y:3}}).setDepth(12).setOrigin(0.5,1).setVisible(false);
    if (!this.textures.exists('static-noise')) {
      const noise = this.textures.createCanvas('static-noise', 160, 96);
      const pixels = noise.context.createImageData(160, 96);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const shade = Math.floor(Math.random() * 256);
        pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = shade;
        pixels.data[i+3] = 180;
      }
      noise.context.putImageData(pixels, 0, 0); noise.refresh();
    }
    this.staticOverlay = this.add.image(480, 288, 'static-noise').setDisplaySize(960, 576).setScrollFactor(0).setDepth(19).setAlpha(0);

    this.renderState();
  }

  renderState() {
    const state = this.session;
    this.minimap?.draw(state);
    this.view3d?.draw(state, this.agentPanel.controller);
    this.mission?.draw(state, this.agentPanel.controller);
    updateText(byId('interaction-prompt'), state.interactionHint);
    byId('interaction-prompt').hidden = !state.interactionHint;
    this.player.setPosition(state.player.x, state.player.y);
    const controller = this.agentPanel.controller;
    const route = controller.route;
    const scanNow = performance.now();
    if (controller.active && (!this.lastScanAt || scanNow - this.lastScanAt > 250)) {
      controller.liveObservation = getObservation(state).surroundings;
      this.lastScanAt = scanNow;
    }
    this.scanOverlay.clear();
    if (controller.busy && !state.gameOver) {
      const angle = scanNow / 650;
      const visible = controller.liveObservation || [];
      for (const cell of visible) {
        const x = (cell.x + 0.5)*TILE, y = (cell.y + 0.5)*TILE;
        const bearing = Math.atan2(y-state.player.y, x-state.player.x);
        const diff = Math.atan2(Math.sin(bearing-angle), Math.cos(bearing-angle));
        if (Math.abs(diff) < 0.45) {
          this.scanOverlay.fillStyle(0xe8cc70, 0.24*(1-Math.abs(diff)/0.45));
          this.scanOverlay.fillRect(cell.x*TILE+3, cell.y*TILE+3, TILE-6, TILE-6);
        }
      }
      this.scanOverlay.lineStyle(2,0xe8cc70,0.9);
      this.scanOverlay.lineBetween(state.player.x,state.player.y,state.player.x+22*Math.cos(angle),state.player.y+22*Math.sin(angle));
      this.scanOverlay.strokeCircle(state.player.x,state.player.y,18);
    }
    this.observationOverlay.clear();
    this.observationOverlay.lineStyle(1, 0xe8cc70, 0.35);
    for (const cell of this.agentPanel.controller.lastObservation || []) {
      this.observationOverlay.strokeRect(cell.x*TILE+2, cell.y*TILE+2, TILE-4, TILE-4);
    }
    this.routeOverlay.clear();
    this.routeTarget.setVisible(route.length > 0 && !state.gameOver);
    if (route.length && !state.gameOver) {
      // Show only where K2 decided to go — a faint destination ring — NOT a
      // step-by-step path line, which wrongly reads as "K2 is being led".
      const target = route.at(-1);
      this.routeOverlay.lineStyle(1.5, 0x7effe4, 0.5);
      this.routeOverlay.strokeCircle(target.x, target.y, 12);
      this.routeTarget.setPosition(target.x, target.y - 17);
    }
    this.darkness.setPosition(state.player.x, state.player.y);
    this.keyMarker.setVisible(!state.hasKey);
    this.paper.setAlpha(state.documentAnswered ? 0.35 : 1);
    // Monster is always rendered so the minimap shows it; the flashlight camera's
    // darkness still hides it in the immersive view until the player is close.
    this.monster.setVisible(true).setPosition(state.monster.x, state.monster.y);
    for (const [door, open] of [[this.firstGate, state.firstGateOpen], [this.lockDoor, state.lockOpen], [this.questionGate, state.gateOpen]]) {
      door.block.setAlpha(open ? 0.15 : 1);
      door.label.setText(open ? 'OPEN' : door.title);
    }
    for (const [id, light] of Object.entries(this.lightButtons)) {
      const active = Number(id) === state.activeLight;
      light.bulb.setAlpha(active ? 1 : 0.5).setScale(active ? 1.15 : 1);
    }
    this.memoryGates.forEach((gate) => gate.setAlpha(state.memorySolved ? 0 : 1));
    this.memoryMarkers.forEach((marker, i) => marker.setText(state.memoryPhase === 'reveal' ? SYMBOLS[state.memorySequence[i]] : '?'));
    if (state.respawns !== this.lastRespawns) {
      this.cameras.main.shake(220, 0.012);
      this.tweens.killTweensOf(this.staticOverlay);
      this.staticOverlay.setAlpha(0.75);
      this.tweens.add({ targets: this.staticOverlay, alpha: 0, duration: 250 });
      this.lastRespawns = state.respawns;
      this.cameras.main.flash(180, 116, 41, 20);
    }
    if (state.gameOver && !this.finished) {
      this.finished = true;
      this.add.text(480, 288, state.dead ? `YOU DIED\n${state.deathReason}\n\nPress Start K2 to retry` : 'YOU ESCAPED\n\nPress R to restart', {
        fontFamily: 'monospace', fontSize: '26px', align: 'center', color: '#eee6ba',
        backgroundColor: '#171710', padding: { x: 28, y: 24 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
    }
    ui.sync();
    this.agentPanel.sync();
    audio.update(state);
  }

  update(_time, delta) {
    const now = performance.now();
    // Benchmark wall-clock time includes model requests.
    this.session.advanceTime(now - this.lastClock);
    this.lastClock = now;
    const agent = this.agentPanel.controller;
    if (this.session.paused) { this.renderState(); return; }
    if (this.session.dead) {
      if (agent.active) agent.pause('FAIL · Returning to start for a fresh 180-second attempt. Route memory retained.');
      this.deathShownAt ??= now;
      this.renderState();
      if (now - this.deathShownAt >= 2200) {
        this.scene.restart({ autoStart: true, retryMemory: {
          triedPaths: agent.evidence.triedPaths, outcomes: [...agent.evidence.outcomes, 'Caught by MONSTER. New 180-second attempt; avoid previously failed corridors.'],
          trajectory: agent.trajectory, blockedPath: this.session.blockedPath,
        } });
      }
      return;
    }
    if (!this.session.started) { this.renderState(); return; }
    const typing = document.activeElement?.matches('input, textarea');
    // Autonomous runs only yield control through the explicit Pause button.
    if (agent.active) this.input.keyboard.resetKeys();
    if (agent.tick(delta)) { this.renderState(); return; }
    if (typing && !this.session.modal) { this.renderState(); return; }
    if (this.session.modal) {
      this.session.update(delta);
      this.renderState();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      this.input.keyboard.resetKeys();
      this.scene.restart({ autoStart: true });
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) this.session.interact();
    const x = Number(this.keys.D.isDown || this.cursors.right.isDown) - Number(this.keys.A.isDown || this.cursors.left.isDown);
    const y = Number(this.keys.S.isDown || this.cursors.down.isDown) - Number(this.keys.W.isDown || this.cursors.up.isDown);
    this.session.update(delta, { x, y, sprint: this.keys.SHIFT.isDown });
    this.renderState();
  }
}

// Single-screen layout for everyone: flashlight game view + minimap + pipeline +
// K2 status + comparison, all visible at once, dialog shown inline (never a
// full-screen modal). No separate demo URL — this is the normal experience.
document.body.classList.add('demo-mode');

const game = new Phaser.Game({
  type: Phaser.CANVAS,
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
