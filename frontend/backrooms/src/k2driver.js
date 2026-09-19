// K2 driver: lets the backend K2 agent play the game instead of the keyboard.
// It reads the GameSession state, asks the backend for a high-level intent,
// then walks the player toward the intent target using BFS pathfinding.

import { MAP, TILE, DOOR_CODE, findPath, tileAt, center, locate } from './level.js';

const BACKEND = 'http://127.0.0.1:8000';

// Map an intent to a target tile on the map.
function intentTarget(session, intent) {
  const at = (sym) => tileAt(locate(sym));
  switch (intent) {
    case 'GO_KEY': return at('K');
    case 'GO_LOCK': return at('L');
    case 'GO_DOCUMENT': return at('D');
    case 'GO_EXIT': return at('E');
    case 'GO_SAFE': return nearestSafe(session);
    default: return null;
  }
}

// Find the nearest safe-zone tile (S) to the player.
function nearestSafe(session) {
  const player = tileAt(session.player);
  let best = null, bestDist = Infinity;
  for (let y = 0; y < MAP.length; y++) {
    for (let x = 0; x < MAP[y].length; x++) {
      if (MAP[y][x] === 'S') {
        const d = Math.abs(x - player.x) + Math.abs(y - player.y);
        if (d < bestDist) { bestDist = d; best = { x, y }; }
      }
    }
  }
  return best;
}

// Build the game-state payload the backend expects.
function snapshot(session, question) {
  return {
    hasKey: session.hasKey,
    lockOpen: session.lockOpen,
    gateOpen: session.gateOpen,
    documentAnswered: session.documentAnswered,
    monsterActive: session.monsterActive,
    playerInSafeZone: session.playerInSafeZone,
    monsterState: session.monster.state,
    playerTile: tileAt(session.player),
    monsterTile: tileAt(session.monster),
    question: question ?? null,
  };
}

// Ask the backend for the next intent. Streams SSE; we surface reasoning
// via onReasoning and return the final decision.
async function askDecision(session, question, onReasoning) {
  const res = await fetch(`${BACKEND}/agent/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot(session, question)),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', decision = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();
    for (const part of parts) {
      const line = part.replace(/^data: /, '').trim();
      if (!line) continue;
      const evt = JSON.parse(line);
      if (evt.type === 'agent_thinking' || evt.type === 'agent_result') onReasoning?.(evt);
      if (evt.type === 'decision') decision = evt;
    }
  }
  return decision;
}

export class K2Driver {
  constructor(onReasoning) {
    this.onReasoning = onReasoning;
    this.enabled = false;
    this.intent = null;
    this.answerId = null;
    this.busy = false;
    this.path = [];
    this.question = null;
    this.lastDecisionAt = 0;
  }

  setQuestion(q) { this.question = q; }

  // Called each frame. Returns a movement input {x, y, sprint} for session.update().
  step(session, dtMs) {
    if (!this.enabled || session.won) return { x: 0, y: 0 };

    // Handle a pending modal (lock or document) using the last decision.
    if (session.modal === 'lock') {
      session.unlock(DOOR_CODE);
      return { x: 0, y: 0 };
    }
    if (session.modal === 'document') {
      const id = this.answerId ?? this.question?.correctId ?? 'A';
      session.answer(id);
      return { x: 0, y: 0 };
    }

    // Ask backend for a new decision periodically (not every frame).
    const now = performance.now();
    if (!this.busy && (now - this.lastDecisionAt > 1500 || !this.intent)) {
      this.lastDecisionAt = now;
      this.requestDecision(session);
    }

    // Walk along the current path toward the intent target.
    return this.followPath(session, dtMs);
  }

  async requestDecision(session) {
    this.busy = true;
    try {
      const decision = await askDecision(session, this.question, this.onReasoning);
      if (decision) {
        this.intent = decision.intent;
        this.answerId = decision.answerId;
        this.onReasoning?.({ type: 'decision', ...decision });
        this.recomputePath(session);
      }
    } catch (e) {
      this.onReasoning?.({ type: 'error', message: String(e) });
    } finally {
      this.busy = false;
    }
  }

  recomputePath(session) {
    const target = intentTarget(session, this.intent);
    if (!target) { this.path = []; return; }
    const start = tileAt(session.player);
    this.path = findPath(start, target, (x, y) => session.canEnter(x, y));
  }

  followPath(session, dtMs) {
    if (!this.path.length) return { x: 0, y: 0 };
    const playerTile = tileAt(session.player);
    // Drop path nodes we've already reached.
    while (this.path.length && this.path[0].x === playerTile.x && this.path[0].y === playerTile.y) {
      this.path.shift();
    }
    if (!this.path.length) return { x: 0, y: 0 };
    const next = center(this.path[0].x, this.path[0].y);
    const dx = next.x - session.player.x;
    const dy = next.y - session.player.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, sprint: session.monsterActive && !session.playerInSafeZone };
  }
}
