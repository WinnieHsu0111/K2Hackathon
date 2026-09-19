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
  if (!value || !INTENTS.includes(value.intent)) throw new Error('The backend returned an unsupported command.');
  if (value.intent === 'ANSWER' && !['A', 'B', 'C'].includes(value.answerId)) throw new Error('The answer returned by the backend must be A, B, or C.');
  return { intent: value.intent, answerId: value.answerId ?? null,
    reason: typeof value.reasoning === 'string' ? value.reasoning.slice(0, 500) : '' };
}

// fetch is required: this endpoint uses POST, which EventSource cannot send.
export async function requestDecision(baseUrl, state, signal, fetcher = fetch) {
  const response = await fetcher(`${baseUrl.replace(/\/$/, '')}/agent/decide`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(state), signal,
  });
  if (!response.ok) throw new Error(`Backend HTTP ${response.status}; check that the updated service and /agent/decide endpoint are available.`);
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    throw new Error('The backend did not return the expected SSE stream.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  function event(frame) {
    const data = frame.split('\n').filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return null;
    let payload;
    try { payload = JSON.parse(data); } catch { throw new Error('The backend SSE data is not valid JSON.'); }
    if (payload.type === 'error') throw new Error('The backend model request failed. Check the backend logs.');
    if (payload.type === 'decision') return validateDecision(payload);
    return null; // Do not display raw model thinking events.
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > 128 * 1024) throw new Error('The backend response exceeded the size limit.');
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
        throw new Error('The stream ended without a decision.');
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function planIntent(session, decision) {
  const { intent, answerId } = decision;
  if (!session.firstGateOpen) throw new Error('Complete the light puzzle manually before handing control to K2.');
  if (intent === 'ANSWER') {
    if (!session.answer(answerId)) throw new Error('There is no document available to answer right now.');
    return [];
  }
  if (intent === 'GO_LOCK' && session.modal === 'lock') {
    if (!session.unlock(DOOR_CODE)) throw new Error('You have not collected the key yet.');
    return [];
  }
  if (session.modal) throw new Error('Complete or close the current interaction dialog first.');
  if (intent === 'GO_KEY' && session.hasKey) throw new Error('You already have the key. Let K2 decide again.');
  if (intent === 'GO_LOCK' && (!session.hasKey || session.lockOpen)) throw new Error('The unlock command does not match the current key or door state.');
  if (intent === 'GO_DOCUMENT' && (!session.lockOpen || session.documentAnswered)) throw new Error('You cannot reach an unanswered document right now.');
  if (intent === 'GO_EXIT' && !session.gateOpen) throw new Error('The gate before the exit is not open yet.');
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
    if (!target) throw new Error('No actionable target is available.');
    const tile = tileAt(target);
    goals = intent === 'GO_LOCK' ? [{ x: tile.x, y: tile.y - 1 }] : [tile];
  }
  const paths = goals.map((goal) => findPath(start, goal,
    (x, y) => session.canEnter(x, y) && session.cell(x, y) !== 'T'))
    .filter((path) => goals.some((g) => path.at(-1).x === g.x && path.at(-1).y === g.y));
  if (!paths.length) throw new Error('The target is currently unreachable. AI stopped.');
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
  pause(message = 'K2 paused. Manual control is available.') {
    this.generation++; this.abort?.abort(); this.abort = null;
    this.busy = false; this.running = false; this.route = []; this.intent = null;
    this.notify({ status: message });
  }
  async step() {
    if (this.busy || this.route.length || this.session.won) return;
    if (!this.session.firstGateOpen) { this.pause('Solve the light puzzle to open door A manually before enabling K2.'); return; }
    const generation = this.generation;
    this.busy = true; this.abort = new AbortController();
    const abort = this.abort;
    const timer = setTimeout(() => abort.abort(), 30000);
    const state = buildAgentState(this.session);
    this.notify({ status: 'K2 is deciding the next move…' });
    try {
      const decision = await requestDecision(this.baseUrl, state, this.abort.signal, this.fetcher);
      if (generation !== this.generation) return;
      this.intent = decision.intent;
      this.route = planIntent(this.session, decision);
      this.turn++;
      this.notify({ status: `Executing ${decision.intent}`, entry: { turn: this.turn, state, ...decision } });
      this.cooldown = 1200;
    } catch (error) {
      if (generation === this.generation) this.pause(error.name === 'AbortError'
        ? 'K2 request timed out. Paused.' : `${error.message} Make sure the backend is running.`);
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) { this.busy = false; this.abort = null; }
    }
  }
  start() { if (this.active) return; this.running = true; void this.step(); }
  tick(delta) {
    if (!this.active) return false;
    const s = this.session;
    if (s.won) { this.pause('K2 has reached the exit.'); return true; }
    // Freeze simulation during network latency; human input cancels this request.
    if (this.busy) return true;
    if (s.modal) {
      this.route = [];
      if (s.modal === 'lock' && this.intent === 'GO_LOCK') s.unlock(DOOR_CODE);
      else if (s.modal !== 'document') { this.pause('Complete the current interaction first.'); return true; }
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
        if (s.respawns !== respawns) { this.pause('The player has respawned. Restart K2.'); return true; }
        if (s.player.x === before.x && s.player.y === before.y && !s.modal) this.pause('Movement blocked. Paused.');
      }
      return true;
    }
    if (this.running) {
      this.cooldown -= delta;
      // Keep the world paused between decisions, including the document dialog.
      if (this.cooldown <= 0) void this.step();
      return true;
    }
    this.notify({ status: 'Step complete. Use K2 Step again or take manual control.' });
    return false;
  }
}
