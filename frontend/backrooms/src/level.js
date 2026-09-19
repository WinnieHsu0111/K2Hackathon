export const MAP = [
  '#########################',
  '#P......................#',
  '#.......................#',
  '#.....K.................#',
  '#.......................#',
  '#..............###......#',
  '#.......................#',
  '############L############',
  '#####...............#####',
  '#####...............#####',
  '#####TTTTTT.TTTTTTTT#####',
  '#####...............#####',
  '#####.......D.......#####',
  '############G############',
  '#....SS.................#',
  '#....SS.....M....SS.....#',
  '#................SS....E#',
  '#..SS...................#',
  '#..SS...................#',
  '#########################',
];

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
  { x: 3, y: 15 }, { x: 11, y: 16 }, { x: 20, y: 15 },
  { x: 15, y: 18 }, { x: 7, y: 17 },
];
export const DOOR_CODE = '042';

// 固定題目先驗證遊戲流程。之後可用 K2 回傳的同一資料格式替換。
// 密碼與答案目前都在前端，適合原型；競賽計分版應由後端判定。
export const QUESTION = {
  id: '042',
  rule: '規則：有效的紀錄值都應是奇數。',
  prompt: 'Which value is the anomaly?',
  options: [
    { id: 'A', value: '21' },
    { id: 'B', value: '23' },
    { id: 'C', value: '84' },
  ],
  correctId: 'C',
  explanation: '84 是唯一的偶數，違反文件中的奇數規則。',
};

export const center = (x, y) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
export const tileAt = (point) => ({ x: Math.floor(point.x / TILE), y: Math.floor(point.y / TILE) });

export function locate(symbol, map = MAP) {
  for (let y = 0; y < map.length; y++) {
    const x = map[y].indexOf(symbol);
    if (x !== -1) return center(x, y);
  }
  throw new Error(`Missing map symbol: ${symbol}`);
}

// 四方向 BFS；若目標不可達，傳回最接近的可達位置。
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
  constructor() {
    if (MAP.some((row) => row.length !== MAP[0].length)) throw new Error('Unequal map rows');
    this.player = locate('P');
    this.key = locate('K');
    this.lock = locate('L');
    this.document = locate('D');
    this.exit = locate('E');
    this.monster = { ...locate('M'), target: null, state: MONSTER_STATE.PATROL };
    // 門外的上方一格；文件前的上方一格。
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
    this.message = '找到鑰匙。留意地板上的金色標記。';
  }

  cell(x, y) { return MAP[y]?.[x] ?? '#'; }

  canEnter(x, y, monster = false) {
    const cell = this.cell(x, y);
    return cell !== '#' && !(cell === 'S' && monster)
      && !(cell === 'L' && !this.lockOpen) && !(cell === 'G' && !this.gateOpen);
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
    // 分成短步進，奔跑或掉幀時仍不會穿牆、跳過陷阱。
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6));
    for (let step = 0; step < steps; step++) {
      for (const [axis, amount] of [['x', dx / steps], ['y', dy / steps]]) {
        const next = { ...this.player, [axis]: this.player[axis] + amount };
        if (this.occupied(next).every(({ x, y }) => this.canEnter(x, y))) this.player = next;
      }
      if (this.occupied(this.player).some(({ x, y }) => this.cell(x, y) === 'T')) {
        this.player = { ...this.trapRoomRespawn };
        this.respawns++;
        this.message = '踩中陷阱！回到密碼門外。找出整排陷阱中的唯一缺口。';
        return true;
      }
    }
    return false;
  }

  unlock(code) {
    if (this.modal !== 'lock' || !this.hasKey || String(code).trim() !== DOOR_CODE) return false;
    this.lockOpen = true;
    this.modal = null;
    this.message = '密碼正確。進入陷阱房，找出唯一安全的通道。';
    return true;
  }

  answer(id) {
    if (this.modal !== 'document' || this.documentAnswered || !QUESTION.options.some((option) => option.id === id)) return false;
    this.documentAnswered = true;
    this.gateOpen = true;
    this.modal = null;
    this.monsterActive = id !== QUESTION.correctId;
    this.monster = { ...locate('M'), target: null, state: MONSTER_STATE.CHASE };
    this.lastSeen = tileAt(this.player);
    this.patrolGoal = null;
    this.searchRemaining = SEARCH_TIME;
    // M 正對 G，短暫甦醒時間讓玩家有機會跨過門、轉向安全區。
    this.wakeRemaining = this.monsterActive ? WAKE_TIME : 0;
    this.message = this.monsterActive
      ? '答案錯誤。門已開啟，異常正在甦醒！進入藍綠色安全區，等它巡邏離開。'
      : `答案正確：${QUESTION.explanation} 門已開啟，找到最終出口。`;
    return true;
  }

  dismiss() { this.modal = null; }

  hasLineOfSight(from, to) {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / (TILE / 8)));
    for (let i = 1; i <= steps; i++) {
      const tile = tileAt({ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps });
      // 安全區也阻隔視線；關閉的 L/G 與牆壁都不能看穿。
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
    // 先回到當前格子中心再轉向，避免改變狀態時斜切牆角。
    const tile = tileAt(this.monster);
    const point = center(tile.x, tile.y);
    this.monster.target = Math.hypot(point.x - this.monster.x, point.y - this.monster.y) > 0.01 ? point : null;
    if (next === MONSTER_STATE.PATROL) this.patrolGoal = null;
    if (next === MONSTER_STATE.SEARCH) this.searchRemaining = SEARCH_TIME;
  }

  choosePatrolGoal() {
    const playerTile = this.patrolAvoid ?? this.lastSeen ?? tileAt(this.monster);
    const monsterTile = tileAt(this.monster);
    // 全部先換成格子座標；優先選離玩家超過 6 格、且不在當前位置的點。
    const candidates = PATROL_POINTS.filter((point) => this.canEnter(point.x, point.y, true)
      && (point.x !== monsterTile.x || point.y !== monsterTile.y));
    const distant = candidates.filter((point) => Math.hypot(point.x - playerTile.x, point.y - playerTile.y) > 6);
    const pool = distant.length ? distant : candidates;
    // 可重現的巡邏選擇。優先選路徑會遠離玩家的位置，避免守在安全區門外。
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

    // 只在格子中心換方向，避免斜切牆角或闖入 S。
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
      this.player = { ...this.documentRespawn };
      this.monsterActive = false;
      this.gateOpen = false;
      this.documentAnswered = false;
      this.documentArmed = true;
      this.wakeRemaining = 0;
      this.searchRemaining = 0;
      this.patrolGoal = null;
      this.respawns++;
      this.message = '被抓到了。你回到文件前，再讀一次規則，重新作答。';
    }
  }

  update(delta, input = {}) {
    if (this.modal || this.won) return;
    const ms = Math.max(0, Math.min(delta, 100));
    const x = input.x || 0, y = input.y || 0;
    const length = Math.hypot(x, y) || 1;
    const step = (input.sprint ? RUN_SPEED : WALK_SPEED) * ms / 1000;
    if (this.movePlayer(x / length * step, y / length * step)) return;

    const near = (target, radius) => Math.hypot(this.player.x - target.x, this.player.y - target.y) < radius;
    if (!this.hasKey && near(this.key, 24)) {
      this.hasKey = true;
      this.message = `取得鑰匙。鑰匙牌刻著 ${DOOR_CODE}；把它帶到南側的密碼門。`;
    }
    if (!near(this.lock, TILE * 1.6)) this.lockArmed = true;
    if (!this.lockOpen && near(this.lock, TILE * 0.95)) {
      if (!this.hasKey) this.message = '密碼門鎖住了。先回到探索區找到鑰匙。';
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
      this.message = '你找到了最終出口。LEVEL 0 COMPLETE。按 R 再玩一次。';
    }
  }
}
