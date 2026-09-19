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
  // Player counts as "at the document" when close enough to open its modal.
  const atDocument = Math.hypot(
    session.player.x - session.document.x,
    session.player.y - session.document.y,
  ) < TILE;
  return {
    hasKey: session.hasKey,
    lockOpen: session.lockOpen,
    gateOpen: session.gateOpen,
    documentAnswered: session.documentAnswered,
    atDocument,
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

    // Ask backend for a new decision periodically, or immediately when the
    // current intent has clearly been accomplished (so we don't idle 1.5s).
    const now = performance.now();
    const intentDone = this.isIntentDone(session);
    if (!this.busy && (intentDone || now - this.lastDecisionAt > 1500 || !this.intent)) {
      this.lastDecisionAt = now;
      this.requestDecision(session);
    }

    // Always keep a valid path toward the current intent's target.
    // Recompute if we have an intent but no path (e.g. path consumed, or
    // the world changed so the previous target is now reachable/different).
    if (this.intent && !this.path.length) {
      this.recomputePath(session);
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

  // Has the current intent been accomplished? If so, we should re-ask backend.
  isIntentDone(session) {
    switch (this.intent) {
      case 'GO_KEY': return session.hasKey;
      case 'GO_LOCK': return session.lockOpen;
      case 'ANSWER': return session.documentAnswered;
      default: return false;
    }
  }

  recomputePath(session) {
    const target = intentTarget(session, this.intent);
    if (!target) { this.path = []; return; }
    const start = tileAt(session.player);
    // If the target tile itself isn't walkable (e.g. a closed door L/G),
    // path to the nearest walkable neighbour so we stand right next to it.
    let goal = target;
    if (!session.canEnter(target.x, target.y)) {
      const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))
        .filter((t) => session.canEnter(t.x, t.y));
      if (neighbours.length) {
        neighbours.sort((a, b) =>
          (Math.abs(a.x - start.x) + Math.abs(a.y - start.y)) -
          (Math.abs(b.x - start.x) + Math.abs(b.y - start.y)));
        goal = neighbours[0];
      }
    }
    // Avoid trap tiles (T) — they teleport the player back. BFS must route
    // through the single gap in the trap row.
    const safe = (x, y) => session.canEnter(x, y) && session.cell(x, y) !== 'T';
    this.path = findPath(start, goal, safe);
  }

  followPath(session, dtMs) {
    const playerTile = tileAt(session.player);
    // Drop path nodes we've already reached.
    while (this.path.length && this.path[0].x === playerTile.x && this.path[0].y === playerTile.y) {
      this.path.shift();
    }

    // Path finished. If our target is a closed door (L/G), nudge toward it so we
    // get close enough to trigger the interaction modal.
    if (!this.path.length) {
      return this.nudgeToTarget(session);
    }

    const next = center(this.path[0].x, this.path[0].y);
    const dx = next.x - session.player.x;
    const dy = next.y - session.player.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, sprint: session.monsterActive && !session.playerInSafeZone };
  }

  // After reaching the tile next to a door/exit, step toward its exact center
  // so the game's proximity check (which opens the modal) fires.
  nudgeToTarget(session) {
    let point = null;
    if (this.intent === 'GO_LOCK') point = session.lock;
    else if (this.intent === 'GO_DOCUMENT') point = session.document;
    else if (this.intent === 'GO_EXIT') point = session.exit;
    if (!point) return { x: 0, y: 0 };
    const dx = point.x - session.player.x;
    const dy = point.y - session.player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return { x: 0, y: 0 };  // close enough
    const len = dist || 1;
    return { x: dx / len, y: dy / len, sprint: false };
  }
}
