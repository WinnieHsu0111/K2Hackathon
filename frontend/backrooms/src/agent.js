import { TILE, WALK_SPEED, RUN_SPEED, center, tileAt, findPath, DOOR_CODE } from './level.js';
import { getObservation } from './observation.js';

export const INTENTS = Object.freeze(['GO_KEY', 'GO_LOCK', 'GO_DOCUMENT', 'ANSWER', 'GO_SAFE', 'GO_EXIT']);

export function buildAgentState(session) {
  const observation = getObservation(session);
  return {
    hasKey: session.hasKey, lockOpen: session.lockOpen, gateOpen: session.gateOpen,
    documentAnswered: session.documentAnswered,
    monsterActive: observation.monster.visible || observation.monster.heard,
    playerInSafeZone: session.playerInSafeZone,
    monsterState: observation.monster.visible ? session.monster.state : 'UNKNOWN',
    playerTile: tileAt(session.player),
    monsterTile: observation.monster.visible ? tileAt(session.monster) : {},
    question: observation.interaction.document ?? null,
  };
}

export function validateDecision(value) {
  if (!value || !INTENTS.includes(value.intent)) throw new Error('後端回傳了不支援的指令。');
  if (value.intent === 'ANSWER' && !['A', 'B', 'C'].includes(value.answerId)) throw new Error('後端回傳的答案必須是 A、B 或 C。');
  return { intent: value.intent, answerId: value.answerId ?? null,
    reason: typeof value.reasoning === 'string' ? value.reasoning.slice(0, 500) : '' };
}

// fetch is required: this endpoint uses POST, which EventSource cannot send.
export async function requestDecision(baseUrl, state, signal, fetcher = fetch) {
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/agent/decide`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(state), signal,
  });
  if (!response.ok) throw new Error(`後端 HTTP ${response.status}；請確認新版服務與 /agent/decide。`);
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    throw new Error('後端未回傳預期的 SSE 串流。');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  function event(frame) {
    const data = frame.split('\n').filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return null;
    let payload;
    try { payload = JSON.parse(data); } catch { throw new Error('後端 SSE 不是有效 JSON。'); }
    if (payload.type === 'error') throw new Error('後端模型請求失敗，請查看後端紀錄。');
    if (payload.type === 'decision') return validateDecision(payload);
    return null; // Do not display raw model thinking events.
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > 128 * 1024) throw new Error('後端回應超過大小限制。');
      buffer += decoder.decode(value, { stream: !done });
      // Normalize only complete CRLF pairs, including pairs split across chunks.
      buffer = buffer.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const result = event(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (result) return result;
      }
      if (done) {
        const result = event(buffer);
        if (result) return result;
        throw new Error('串流結束，但沒有收到 decision。');
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function planIntent(session, decision) {
  const { intent, answerId } = decision;
  if (!session.firstGateOpen) throw new Error('請先手動完成燈光關卡，再交給 K2。');
  if (intent === 'ANSWER') {
    if (!session.answer(answerId)) throw new Error('目前沒有可回答的文件。');
    return [];
  }
  if (intent === 'GO_LOCK' && session.modal === 'lock') {
    if (!session.unlock(DOOR_CODE)) throw new Error('尚未取得鑰匙。');
    return [];
  }
  if (session.modal) throw new Error('請先完成或關閉目前的互動視窗。');
  if (intent === 'GO_KEY' && session.hasKey) throw new Error('已持有鑰匙，請讓 K2 重新決定。');
  if (intent === 'GO_LOCK' && (!session.hasKey || session.lockOpen)) throw new Error('開門指令與目前鑰匙／門狀態不符。');
  if (intent === 'GO_DOCUMENT' && (!session.lockOpen || session.documentAnswered)) throw new Error('目前無法前往未回答的文件。');
  if (intent === 'GO_EXIT' && !session.gateOpen) throw new Error('出口前的門尚未開啟。');
  const start = tileAt(session.player);
  let goals;
  if (intent === 'GO_SAFE') {
    goals = [];
    // Navigation is owned by the game engine; these coordinates never go to K2.
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      if (session.cell(x, y) === 'S') goals.push({ x, y });
    }
  } else {
    const target = { GO_KEY: session.key, GO_LOCK: session.lock, GO_DOCUMENT: session.document, GO_EXIT: session.exit }[intent];
    if (!target) throw new Error('沒有可執行的目標。');
    const tile = tileAt(target);
    goals = intent === 'GO_LOCK' ? [{ x: tile.x, y: tile.y - 1 }] : [tile];
  }
  const paths = goals.map((goal) => findPath(start, goal,
    (x, y) => session.canEnter(x, y) && session.cell(x, y) !== 'T'))
    .filter((path) => goals.some((g) => path.at(-1).x === g.x && path.at(-1).y === g.y));
  if (!paths.length) throw new Error('目標目前不可達，已停止 AI。');
  paths.sort((a, b) => a.length - b.length);
  // Center the current cell first to prevent diagonal corner cutting.
  const route = paths[0].map(({ x, y }) => center(x, y));
  if (intent === 'GO_LOCK') route.push({ x: session.lock.x, y: session.lock.y - TILE * 0.8 });
  return route;
}

export class AgentController {
  constructor(session, notify, baseUrl, fetcher = fetch) {
    this.session = session; this.notify = notify; this.baseUrl = baseUrl; this.fetcher = fetcher;
    this.running = false; this.busy = false; this.route = []; this.turn = 0;
    this.generation = 0; this.cooldown = 0; this.intent = null;
  }
  get active() { return this.running || this.busy || this.route.length > 0; }
  pause(message = 'K2 已暫停，可手動操作。') {
    this.generation++; this.abort?.abort(); this.abort = null;
    this.busy = false; this.running = false; this.route = []; this.intent = null;
    this.notify({ status: message });
  }
  async step() {
    if (this.busy || this.route.length || this.session.won) return;
    if (!this.session.firstGateOpen) { this.pause('請先手動解開燈光 A 門，再啟用 K2。'); return; }
    const generation = this.generation;
    this.busy = true; this.abort = new AbortController();
    const abort = this.abort;
    const timer = setTimeout(() => abort.abort(), 30000);
    const state = buildAgentState(this.session);
    this.notify({ status: 'K2 正在決定下一步…' });
    try {
      const decision = await requestDecision(this.baseUrl, state, this.abort.signal, this.fetcher);
      if (generation !== this.generation) return;
      this.intent = decision.intent;
      this.route = planIntent(this.session, decision);
      this.turn++;
      this.notify({ status: `執行 ${decision.intent}`, entry: { turn: this.turn, state, ...decision } });
      this.cooldown = 1200;
    } catch (error) {
      if (generation === this.generation) this.pause(error.name === 'AbortError'
        ? 'K2 請求逾時，已暫停。' : `${error.message} 請確認後端已啟動。`);
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) { this.busy = false; this.abort = null; }
    }
  }
  start() { if (this.active) return; this.running = true; void this.step(); }
  tick(delta) {
    if (!this.active) return false;
    const s = this.session;
    if (s.won) { this.pause('K2 已抵達出口。'); return true; }
    // Freeze simulation during network latency; human input cancels this request.
    if (this.busy) return true;
    if (s.modal) {
      this.route = [];
      if (s.modal === 'lock' && this.intent === 'GO_LOCK') s.unlock(DOOR_CODE);
      else if (s.modal !== 'document') { this.pause('請先完成目前的互動。'); return true; }
    }
    if (this.route.length) {
      const point = this.route[0], dx = point.x - s.player.x, dy = point.y - s.player.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 0.01) this.route.shift();
      else {
        const sprint = this.intent === 'GO_SAFE';
        const ms = Math.min(Math.max(delta, 0), 100, distance / (sprint ? RUN_SPEED : WALK_SPEED) * 1000);
        const before = { ...s.player }, respawns = s.respawns;
        s.update(ms, { x: dx, y: dy, sprint });
        if (s.respawns !== respawns) { this.pause('角色已重生，請重新啟動 K2。'); return true; }
        if (s.player.x === before.x && s.player.y === before.y && !s.modal) this.pause('移動受阻，已暫停。');
      }
      return true;
    }
    if (this.running) {
      this.cooldown -= delta;
      // Keep the world paused between decisions, including the document dialog.
      if (this.cooldown <= 0) void this.step();
      return true;
    }
    this.notify({ status: '單步完成，可繼續 K2 Step 或手動操作。' });
    return false;
  }
}
