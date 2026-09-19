import { generatePuzzles } from './puzzles.js';

export const MAP = ['#########################',
  '#P....1...2...3...4.....#',
  '#.......................#',
  '#...........C...........#',
  '############A############',
  '#.......................#',
  '#...B...B...B...B...B...#',
  '#.......................#',
  '#...........R...........#',
  '####.#######.#######.####',
  '#.......#.......#.......#',
  '#.......#.......#.......#',
  '#.......#.......#.......#',
  '####.#######.#######.####',
  '#........K..............#',
  '#.......................#',
  '############L############',
  '#####...............#####',
  '#####TTTTTT.TTTTTTTT#####',
  '#####...............#####',
  '#####.......D.......#####',
  '############G############',
  '#....SS.................#',
  '#....SS.....M.....SS....#',
  '#.................SS...E#',
  '#..SS...................#',
  '#..SS...................#',
  '#########################'];

export const TILE = 48;
export const WALK_SPEED = 145;
export const RUN_SPEED = 220;
export const MONSTER_SPEED = 175;
export const PLAYER_RADIUS = 9;
export const MONSTER_RADIUS = 12;
export const VISION_RANGE = 7 * TILE;
export const SEARCH_TIME = 3000;
export const WAKE_TIME = 1200;
export const MONSTER_STATE = { CHASE: 'CHASE', PATROL: 'PATROL', SEARCH: 'SEARCH' };
export const PATROL_POINTS = [
  { x: 3, y: 23 }, { x: 11, y: 24 }, { x: 20, y: 23 },
  { x: 15, y: 26 }, { x: 7, y: 25 },
];
export const LIGHTS = { 1: 'RED', 2: 'BLUE', 3: 'GREEN', 4: 'YELLOW' };
export const LIGHT_COLORS = { 1: 0xe87f72, 2: 0x76a6ee, 3: 0x8dce8a, 4: 0xe8cc70 };
export const LIGHT_LEAD_IN = 400;
export const LIGHT_ON_TIME = 600;
export const LIGHT_STEP_TIME = 900;

export function checkLightCode(playerInput, sequence) {
  return Array.isArray(playerInput) && playerInput.length === sequence.length
    && sequence.every((expected, index) => playerInput[index] === expected);
}

export const center = (x, y) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
export const tileAt = (point) => ({ x: Math.floor(point.x / TILE), y: Math.floor(point.y / TILE) });

export function locate(symbol, map = MAP) {
  for (let y = 0; y < map.length; y++) {
    const x = map[y].indexOf(symbol);
    if (x !== -1) return center(x, y);
  }
  throw new Error(`Missing map symbol: ${symbol}`);
}

// Four-direction BFS; if the target is unreachable, return the closest reachable position.
export function findPath(start, goal, canEnter) {
  const queue = [{ ...start, parent: -1 }];
  const seen = new Set([`${start.x},${start.y}`]);
  let best = 0;
  let distance = Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y);
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    const d = Math.abs(node.x - goal.x) + Math.abs(node.y - goal.y);
    if (d < distance) { distance = d; best = i; }
    if (d === 0) { best = i; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = node.x + dx, y = node.y + dy, key = `${x},${y}`;
      if (!seen.has(key) && canEnter(x, y)) {
        seen.add(key);
        queue.push({ x, y, parent: i });
      }
    }
  }
  const path = [];
  for (let i = best; i !== -1; i = queue[i].parent) {
    path.push({ x: queue[i].x, y: queue[i].y });
  }
  return path.reverse();
}

export class GameSession {
  constructor({ rng = Math.random } = {}) {
    Object.assign(this, generatePuzzles(rng));
    this.started = false;
    this.timeLeft = 180000;
    this.dead = false;
    this.deathReason = null;
    this.memorySolved = false;
    this.memorySeen = false;
    this.memoryPhase = 'idle';
    this.memoryRemaining = 0;
    this.memoryConsole = locate('R');
    this.pathSolved = false;
    this.wrongPathRespawn = center(12, 8);
    if (MAP.some((row) => row.length !== MAP[0].length)) throw new Error('Unequal map rows');
    this.player = locate('P');
    this.lightConsole = locate('C');
    this.firstGateOpen = false;
    this.lightInput = [];
    this.lightPhase = 'idle';
    this.lightElapsed = 0;
    this.lightNotice = 'Press Play and memorize the sequence of five lights.';
    this.pressedLight = null;
    this.lightFlashRemaining = 0;
    this.key = locate('K');
    this.lock = locate('L');
    this.document = locate('D');
    this.exit = locate('E');
    this.monster = { ...locate('M'), target: null, state: MONSTER_STATE.PATROL };
    // One tile above the doorway outside; one tile above the document.
    this.trapRoomRespawn = { x: this.lock.x, y: this.lock.y - TILE };
    this.documentRespawn = { x: this.document.x, y: this.document.y - TILE };
    this.hasKey = false;
    this.lockOpen = false;
    this.gateOpen = false;
    this.documentAnswered = false;
    this.monsterActive = false;
    this.patrolGoal = null;
    this.patrolAvoid = null;
    this.lastSeen = null;
    this.searchRemaining = 0;
    this.wakeRemaining = 0;
    this.modal = null;
    this.lockArmed = true;
    this.documentArmed = true;
    this.won = false;
    this.respawns = 0;
    this.message = 'The first gate requires a light sequence. Approach console C and press F to play it.';
  }

  start() { if (!this.dead && !this.won) this.started = true; }

  get gameOver() { return this.dead || this.won; }
  get aiReady() { return this.started && this.firstGateOpen && this.memorySolved && this.pathSolved && !this.gameOver; }

  die(reason) {
    if (this.gameOver) return;
    this.dead = true;
    this.deathReason = reason;
    this.monsterActive = false;
    this.modal = null;
    this.message = `YOU DIED · ${reason}. Press Start K2 to retry.`;
  }

  // Called once per rendered frame with real elapsed time, outside movement / AI code.
  advanceTime(delta) {
    if (!this.started || this.gameOver) return;
    const ms = Math.max(0, Number.isFinite(delta) ? delta : 0);
    this.timeLeft = Math.max(0, this.timeLeft - ms);
    if (this.timeLeft === 0) { this.die('TIME OUT'); return; }
    this.updateLights(ms);
    if (this.memoryPhase === 'reveal') {
      this.memoryRemaining = Math.max(0, this.memoryRemaining - ms);
      if (!this.memoryRemaining) {
        this.memoryPhase = 'input';
        if (Math.hypot(this.player.x-this.memoryConsole.x, this.player.y-this.memoryConsole.y) >= TILE*1.15) this.modal = null;
        this.message = 'Symbols hidden. Approach R and press F to select the order.';
      }
    }
  }

  revealMemory() {
    if (this.gameOver || this.memorySolved) return;
    this.memorySeen = true;
    this.memoryPhase = 'reveal';
    this.memoryRemaining = 3000;
    this.modal = 'memory';
    this.message = 'Memorize all five symbols. You have three seconds.';
  }

  answerMemory(index) {
    if (this.gameOver || this.modal !== 'memory' || this.memoryPhase !== 'input') return false;
    if (index !== this.memoryAnswer) {
      this.revealMemory();
      this.message = 'MEMORY RESET · Watch the symbols again. The clock is still running.';
      return false;
    }
    this.memorySolved = true;
    this.modal = null;
    this.message = 'Memory verified. Choose LEFT, CENTER, or RIGHT. Fake paths return you here.';
    return true;
  }

  cell(x, y) {
    if (y === 13 && [4,12,20].includes(x) && ['LEFT','CENTER','RIGHT'][[4,12,20].indexOf(x)] !== this.correctPath) return 'X';
    return MAP[y]?.[x] ?? '#';
  }

  canEnter(x, y, monster = false) {
    const cell = this.cell(x, y);
    return cell !== '#' && !(y === 9 && !this.memorySolved) && !(cell === 'S' && monster)
      && !(cell === 'A' && !this.firstGateOpen)
      && !(cell === 'L' && !this.lockOpen) && !(cell === 'G' && !this.gateOpen);
  }

  get activeLight() {
    if (this.lightPhase === 'playback') {
      const elapsed = this.lightElapsed - LIGHT_LEAD_IN;
      const index = Math.floor(elapsed / LIGHT_STEP_TIME);
      return elapsed >= 0 && elapsed % LIGHT_STEP_TIME < LIGHT_ON_TIME ? this.lightSequence[index] ?? null : null;
    }
    return this.lightFlashRemaining > 0 ? this.pressedLight : null;
  }

  playLightSequence(denied = false) {
    if (this.firstGateOpen || this.modal !== 'lights') return false;
    this.lightInput = [];
    this.lightPhase = 'playback';
    this.lightElapsed = 0;
    this.pressedLight = null;
    this.lightFlashRemaining = 0;
    this.lightNotice = denied ? 'ACCESS DENIED · Incorrect sequence. Playing again.' : 'Watch the flashing light sequence. Input is disabled during playback.';
    return true;
  }

  pressLight(id) {
    if (this.gameOver || this.modal !== 'lights' || this.firstGateOpen || this.lightPhase !== 'input' || !Object.hasOwn(LIGHTS, id)) return false;
    this.pressedLight = Number(id);
    this.lightFlashRemaining = 300;
    this.lightInput.push(Number(id));
    this.message = `Pressed ${id} ${LIGHTS[id]} · ${this.lightInput.length}/5. Enter the five-light sequence from memory.`;
    if (this.lightInput.length === this.lightSequence.length) {
      if (checkLightCode(this.lightInput, this.lightSequence)) {
        this.firstGateOpen = true;
        this.lightPhase = 'solved';
        this.modal = null;
        this.message = 'ACCESS GRANTED · The first gate is open. Go through door A to the memory room.';
      } else {
        this.modal = 'lights';
        this.playLightSequence(true);
        this.message = 'ACCESS DENIED · The first gate is still closed. Memorize the light sequence again.';
      }
    }
    return true;
  }

  interact() {
    if (!this.started || this.modal || this.gameOver) return false;
    if (Math.hypot(this.player.x - this.lightConsole.x, this.player.y - this.lightConsole.y) < TILE * 1.15) {
      if (this.firstGateOpen) { this.message = 'Light puzzle solved. Door A is open.'; return false; }
      this.modal = 'lights';
      this.playLightSequence();
      return true;
    }
    if (this.firstGateOpen && !this.memorySolved && Math.hypot(this.player.x-this.memoryConsole.x, this.player.y-this.memoryConsole.y) < TILE*1.15) {
      this.modal = 'memory';
      if (!this.memorySeen) this.revealMemory();
      return true;
    }
    return false;
  }

  updateLights(ms) {
    this.lightFlashRemaining = Math.max(0, this.lightFlashRemaining - ms);
    if (this.lightPhase !== 'playback' || this.modal !== 'lights') return;
    this.lightElapsed += ms;
    if (this.lightElapsed >= LIGHT_LEAD_IN + this.lightSequence.length * LIGHT_STEP_TIME) {
      this.lightPhase = 'input';
      this.lightNotice = 'Playback complete. Enter all five lights using the buttons below.';
      this.message = 'Enter the five-light sequence at console C. Repeated colors are allowed.';
    }
  }

  occupied(point, radius = PLAYER_RADIUS) {
    const cells = [];
    for (let y = Math.floor((point.y - radius) / TILE); y <= Math.floor((point.y + radius - 0.001) / TILE); y++) {
      for (let x = Math.floor((point.x - radius) / TILE); x <= Math.floor((point.x + radius - 0.001) / TILE); x++) cells.push({ x, y });
    }
    return cells;
  }

  get playerInSafeZone() {
    return this.occupied(this.player).every(({ x, y }) => this.cell(x, y) === 'S');
  }

  movePlayer(dx, dy) {
    if (!this.started || this.gameOver || this.modal) return false;
    // Split movement into short steps to prevent clipping through walls or skipping traps while running or dropping frames.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6));
    for (let step = 0; step < steps; step++) {
      for (const [axis, amount] of [['x', dx / steps], ['y', dy / steps]]) {
        const next = { ...this.player, [axis]: this.player[axis] + amount };
        if (this.occupied(next).every(({ x, y }) => this.canEnter(x, y))) this.player = next;
      }
      const current = tileAt(this.player);
      if (this.cell(current.x, current.y) === 'X') {
        this.player = { ...this.wrongPathRespawn };
        this.respawns++;
        this.message = 'FALSE PATH · Returned to the entrance. Try a different corridor.';
        return true;
      }
      if (current.y === 14 && !this.pathSolved) {
        this.pathSolved = true;
        this.message = 'Path verified. Find the key and read its code.';
      }
      if (this.occupied(this.player).some(({ x, y }) => this.cell(x, y) === 'T')) {
        this.player = { ...this.trapRoomRespawn };
        this.respawns++;
        this.message = 'You stepped on a trap! Returned to the outside of the code-locked door. Find the only gap in the row of traps.';
        return true;
      }
    }
    return false;
  }

  unlock(code) {
    if (this.gameOver || this.modal !== 'lock' || !this.hasKey || String(code).trim() !== this.doorCode) return false;
    this.lockOpen = true;
    this.modal = null;
    this.message = 'Correct code. Enter the trap room and find the only safe passage.';
    return true;
  }

  answer(id) {
    if (this.gameOver || this.modal !== 'document' || this.documentAnswered || !this.question.options.some((option) => option.id === id)) return false;
    this.documentAnswered = true;
    this.gateOpen = true;
    this.modal = null;
    this.monsterActive = id !== this.question.correctId;
    this.monster = { ...locate('M'), target: null, state: MONSTER_STATE.CHASE };
    this.lastSeen = tileAt(this.player);
    this.patrolGoal = null;
    this.searchRemaining = SEARCH_TIME;
    // M faces G directly. A brief awakening delay gives the player time to cross the gate and turn toward the safe zone.
    this.wakeRemaining = this.monsterActive ? WAKE_TIME : 0;
    this.message = this.monsterActive
      ? 'Incorrect answer. The gate is open, and the anomaly is awakening! Enter the teal safe zone and wait for it to patrol away.'
      : `Correct answer: ${this.question.explanation} The gate is open. Find the final exit.`;
    return true;
  }

  dismiss() {
    if (this.modal === 'lights' && this.lightPhase === 'playback') {
      this.lightPhase = 'idle';
      this.lightInput = [];
      this.message = 'Playback canceled. Return to console C and press F to watch the full sequence before entering it.';
    }
    this.modal = null;
  }

  hasLineOfSight(from, to) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / (TILE / 8)));
    for (let i = 1; i <= steps; i++) {
      const tile = tileAt({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps });
      // Safe zones also block line of sight; closed L/G doors and walls cannot be seen through.
      if (!this.canEnter(tile.x, tile.y, true)) return false;
    }
    return true;
  }

  canMonsterSeePlayer() {
    return !this.playerInSafeZone
      && Math.hypot(this.player.x - this.monster.x, this.player.y - this.monster.y) <= VISION_RANGE
      && this.hasLineOfSight(this.monster, this.player);
  }

  changeMonsterState(next) {
    if (this.monster.state === next) return;
    this.monster.state = next;
    // Return to the center of the current tile before turning to avoid cutting diagonally through wall corners when changing state.
    const tile = tileAt(this.monster);
    const point = center(tile.x, tile.y);
    this.monster.target = Math.hypot(point.x - this.monster.x, point.y - this.monster.y) > 0.01 ? point : null;
    if (next === MONSTER_STATE.PATROL) this.patrolGoal = null;
    if (next === MONSTER_STATE.SEARCH) this.searchRemaining = SEARCH_TIME;
  }

  choosePatrolGoal() {
    const playerTile = this.patrolAvoid ?? this.lastSeen ?? tileAt(this.monster);
    const monsterTile = tileAt(this.monster);
    // Convert everything to tile coordinates first; prefer points more than 6 tiles from the player and different from the current position.
    const candidates = PATROL_POINTS.filter((point) => this.canEnter(point.x, point.y, true)
      && (point.x !== monsterTile.x || point.y !== monsterTile.y));
    const distant = candidates.filter((point) => Math.hypot(point.x - playerTile.x, point.y - playerTile.y) > 6);
    const pool = distant.length ? distant : candidates;
    // Deterministic patrol selection. Prefer destinations whose paths lead away from the player to avoid camping outside the safe zone.
    const ranked = pool.map((point) => {
      const path = findPath(monsterTile, point, (x, y) => this.canEnter(x, y, true));
      const end = path.at(-1);
      if (end.x !== point.x || end.y !== point.y) return null;
      const distances = path.slice(1).map((tile) => Math.hypot(tile.x - playerTile.x, tile.y - playerTile.y));
      const score = (distances[0] ?? 0) * 4 + Math.hypot(point.x - playerTile.x, point.y - playerTile.y);
      return { point, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    this.patrolGoal = ranked[0]?.point ?? monsterTile;
  }

  updateMonster(ms) {
    if (!this.monsterActive) return;
    if (this.playerInSafeZone) {
      this.patrolAvoid = tileAt(this.player);
      this.changeMonsterState(MONSTER_STATE.PATROL);
    } else if (this.canMonsterSeePlayer()) {
      this.changeMonsterState(MONSTER_STATE.CHASE);
      this.lastSeen = tileAt(this.player);
      this.patrolAvoid = this.lastSeen;
    } else if (this.monster.state === MONSTER_STATE.CHASE) {
      this.changeMonsterState(MONSTER_STATE.SEARCH);
    } else if (this.monster.state === MONSTER_STATE.SEARCH) {
      this.searchRemaining -= ms;
      if (this.searchRemaining <= 0) this.changeMonsterState(MONSTER_STATE.PATROL);
    }
    if (this.wakeRemaining > 0) { this.wakeRemaining = Math.max(0, this.wakeRemaining - ms); return; }

    // Change direction only at tile centers to avoid cutting diagonally through wall corners or entering S.
    if (!this.monster.target) {
      let goal = this.lastSeen ?? tileAt(this.monster);
      if (this.monster.state === MONSTER_STATE.PATROL) {
        const current = tileAt(this.monster);
        if (!this.patrolGoal || (current.x === this.patrolGoal.x && current.y === this.patrolGoal.y)) this.choosePatrolGoal();
        goal = this.patrolGoal;
      }
      const path = findPath(tileAt(this.monster), goal, (x, y) => this.canEnter(x, y, true));
      if (path[1]) this.monster.target = center(path[1].x, path[1].y);
    }
    const target = this.monster.target;
    if (target) {
      const dx = target.x - this.monster.x, dy = target.y - this.monster.y;
      const distance = Math.hypot(dx, dy);
      const step = Math.min(distance, MONSTER_SPEED * ms / 1000);
      if (distance > 0) {
        this.monster.x += dx / distance * step;
        this.monster.y += dy / distance * step;
      }
      if (distance <= step) this.monster.target = null;
    }
    if (!this.playerInSafeZone && Math.hypot(this.player.x - this.monster.x, this.player.y - this.monster.y) < PLAYER_RADIUS + MONSTER_RADIUS) {
      this.die('CAUGHT BY THE MONSTER');
    }
  }

  update(delta, input = {}) {
    const ms = Math.max(0, Math.min(delta, 100));
    if (!this.started || this.modal || this.gameOver) return;
    const x = input.x || 0, y = input.y || 0;
    const length = Math.hypot(x, y) || 1;
    const step = (input.sprint ? RUN_SPEED : WALK_SPEED) * ms / 1000;
    if (this.movePlayer(x / length * step, y / length * step)) return;

    if (this.firstGateOpen && !this.memorySeen && tileAt(this.player).y >= 5) { this.revealMemory(); return; }
    const near = (target, radius) => Math.hypot(this.player.x - target.x, this.player.y - target.y) < radius;
    if (!this.hasKey && near(this.key, 24)) {
      this.hasKey = true;
      this.message = `Key collected. The key tag reads ${this.doorCode}; take it to the code-locked door to the south.`;
    }
    if (!near(this.lock, TILE * 1.6)) this.lockArmed = true;
    if (!this.lockOpen && near(this.lock, TILE * 0.95)) {
      if (!this.hasKey) this.message = 'The code-locked door is locked. Return to the exploration area and find the key first.';
      else if (this.lockArmed) { this.modal = 'lock'; this.lockArmed = false; }
    }
    if (!near(this.document, TILE)) this.documentArmed = true;
    if (!this.documentAnswered && this.documentArmed && near(this.document, 25)) {
      this.modal = 'document';
      this.documentArmed = false;
    }
    if (this.modal) return;
    this.updateMonster(ms);
    if (this.gateOpen && this.documentAnswered && near(this.exit, 24)) {
      this.won = true;
      this.monsterActive = false;
      this.message = 'You found the final exit. YOU ESCAPED. Press R to play again.';
    }
  }
}
