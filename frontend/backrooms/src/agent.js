import { TILE, WALK_SPEED, RUN_SPEED, SCAN_TIME, center, tileAt, findPath } from './level.js';
import { getObservation } from './observation.js';

export const INTENTS = Object.freeze(['PICK_FLASHLIGHT', 'WATCH_LIGHTS', 'ENTER_LIGHTS', 'GO_MEMORY', 'ANSWER_MEMORY', 'TRY_PATH', 'GO_KEY', 'GO_LOCK', 'GO_DOCUMENT', 'ANSWER', 'GO_SAFE', 'GO_EXIT', 'GO_LIGHT_1', 'GO_LIGHT_2', 'GO_LIGHT_3', 'GO_LIGHT_4']);

export function buildAgentState(session, evidence = {}, trajectory = []) {
  const observation = getObservation(session);
  return {
    hasFlashlight: session.hasFlashlight, hasDocument: session.hasDocument,
    firstGateOpen: session.firstGateOpen, memorySolved: session.memorySolved, pathSolved: session.pathSolved,
    lightPhase: session.lightPhase, memoryPhase: session.memoryPhase,
    observedLights: evidence.lights || [], observedSymbols: evidence.symbols || [],
    memoryOptions: [],
    triedPaths: evidence.triedPaths || [],
    recentOutcomes: evidence.outcomes || [],
    trajectory: trajectory || [],
    visibleTiles: observation.surroundings,
    hasKey: session.hasKey, lockOpen: session.lockOpen, gateOpen: session.gateOpen,
    documentAnswered: session.documentAnswered,
    monsterActive: observation.monster.visible || observation.monster.heard,
    playerInSafeZone: session.playerInSafeZone,
    blockedPath: session.blockedPath || null,
    monsterState: observation.monster.visible ? session.monster.state : 'UNKNOWN',
    playerTile: tileAt(session.player),
    monsterTile: observation.monster.visible ? tileAt(session.monster) : {},
    question: session.question ? {
      prompt: session.question.prompt,
      rule: session.question.rule,
      options: session.question.options,
      correctId: session.question.correctId,
    } : null,
    atDocument: session.modal === 'document',
    // Three-level demo state
    level: session.demoLevel || 1,
    lightPhaseAFailed: session.lightPhaseAFailed || false,
    spatialLightsDone: session.spatialLightsDone || [],
    spatialLightSequence: session.spatialLightSequence || [],
    level2Solved: session.level2Solved || false,
    // Level 3 scenario fields
    health: session.health || 100,
    battery: session.battery || 100,
    exitDistance: session.exitDistance || 12,
    distressDistance: session.distressDistance || 45,
    distressSignalActive: session.distressSignalActive || false,
  };
}

export function validateDecision(value) {
  if (!value || !INTENTS.includes(value.intent)) throw new Error('The backend returned an unsupported command.');
  if (value.intent === 'ANSWER' && !['A', 'B', 'C'].includes(value.answerId)) throw new Error('The answer returned by the backend must be A, B, or C.');
  if (value.intent === 'ENTER_LIGHTS' && (!Array.isArray(value.sequence) || value.sequence.length !== 3 || value.sequence.some(x => ![1,2,3,4].includes(x)))) throw new Error('Invalid light sequence from K2.');
  if (value.intent === 'ANSWER_MEMORY' && ![0,1,2].includes(value.memoryIndex)) throw new Error('Invalid memory choice from K2.');
  if (value.intent === 'TRY_PATH' && !['LEFT','CENTER','RIGHT'].includes(value.path)) throw new Error('Invalid path from K2.');
  return { sequence: value.sequence, memoryIndex: value.memoryIndex, path: value.path, intent: value.intent, answerId: value.answerId ?? null,
    reason: typeof value.reasoning === 'string' ? value.reasoning.slice(0, 500) : '',
    phaseAFailed: value.phaseAFailed || false };
}

// fetch is required: this endpoint uses POST, which EventSource cannot send.
export async function requestDecision(baseUrl, state, signal, fetcher = fetch, onEvent = null) {
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
    if (['agent_thinking', 'agent_result'].includes(payload.type)) onEvent?.(payload);
    return null;
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
  const early = ['PICK_FLASHLIGHT', 'WATCH_LIGHTS', 'ENTER_LIGHTS', 'GO_MEMORY', 'ANSWER_MEMORY', 'TRY_PATH', 'GO_LIGHT_1', 'GO_LIGHT_2', 'GO_LIGHT_3', 'GO_LIGHT_4'];
  if (!session.aiReady && !early.includes(intent)) throw new Error('K2 must complete the opening puzzles first.');

  // Level 2: navigate to a scattered light and activate it
  if (['GO_LIGHT_1','GO_LIGHT_2','GO_LIGHT_3','GO_LIGHT_4'].includes(intent)) {
    const lightId = Number(intent.slice(-1));
    const positions = session.spatialLightPositions;
    const target = positions[lightId];
    if (!target) throw new Error(`Light ${lightId} not found on map.`);
    const tile = tileAt(target);
    const path = findPath(tileAt(session.player), tile, (x,y) => session.canEnter(x,y));
    if (!path.length) throw new Error(`Light ${lightId} is unreachable.`);
    return path.map(({x,y}) => center(x,y));
  }

  // Level 3: exit = go to exit tile; investigate = go to distress signal area (near M spawn)
  if (intent === 'GO_EXIT' && session.demoLevel === 3) {
    session.resolveLevel3('GO_EXIT');
  }
  if (intent === 'GO_SAFE' && session.demoLevel === 3 && session.distressSignalActive) {
    session.resolveLevel3('GO_SAFE');
  }
  if (intent === 'PICK_FLASHLIGHT') {
    if (session.hasFlashlight) return [];
    const target = tileAt(session.flashlight);
    return findPath(tileAt(session.player), target, (x,y) => session.canEnter(x,y)).map(({x,y}) => center(x,y));
  }
  if (intent === 'ENTER_LIGHTS') {
    if (session.modal !== 'lights' || session.lightPhase !== 'input') throw new Error('Lights are not ready for input.');
    for (const light of decision.sequence) session.pressLight(light);
    return [];
  }
  if (intent === 'ANSWER_MEMORY') {
    if (session.modal !== 'memory' || session.memoryPhase !== 'input') throw new Error('Memory options are not available.');
    session.answerMemory(decision.memoryIndex);
    return [];
  }
  if (intent === 'WATCH_LIGHTS' && session.modal === 'lights') return [];
  if (['WATCH_LIGHTS', 'GO_MEMORY', 'TRY_PATH'].includes(intent)) {
    if (session.modal) session.dismiss();
    const lane = {LEFT:4, CENTER:12, RIGHT:20}[decision.path];
    const target = intent === 'WATCH_LIGHTS' ? tileAt(session.lightConsole)
      : intent === 'GO_MEMORY' ? tileAt(session.memoryConsole) : {x:lane, y:14};
    const path = findPath(tileAt(session.player), target, (x,y) => session.canEnter(x,y)
      && (intent !== 'TRY_PATH' || ![9,13].includes(y) || x === lane));
    if (!path.length || path.at(-1).x !== target.x || path.at(-1).y !== target.y) throw new Error('Puzzle target unreachable.');
    return path.map(({x,y}) => center(x,y));
  }
  if (intent === 'ANSWER') {
    if (!session.answer(answerId)) throw new Error('There is no document available to answer right now.');
    return [];
  }
  if (intent === 'GO_LOCK' && session.modal === 'lock') {
    if (!session.unlock(session.doorCode)) throw new Error('You have not collected the key yet.');
    return [];
  }
  if (session.modal) throw new Error('Complete or close the current interaction dialog first.');
  if (intent === 'GO_KEY' && session.hasKey) throw new Error('You already have the key. Let K2 decide again.');
  if (intent === 'GO_LOCK' && (!session.hasKey || session.lockOpen)) throw new Error('The unlock command does not match the current key or door state.');
  if (intent === 'GO_DOCUMENT' && (!session.lockOpen || session.documentAnswered)) throw new Error('You cannot reach an unanswered document right now.');
  if (intent === 'GO_EXIT' && !session.gateOpen) throw new Error('The gate before the exit is not open yet.');
  const start = tileAt(session.player);
  let goals;
  if (intent === 'GO_SAFE' && session.blockedPath === 'CENTER' && !session.pathSolved) {
    // Retreat to the corridor-choice starting point.
    goals = [tileAt(session.wrongPathRespawn)];
  } else if (intent === 'GO_SAFE') {
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
    (x, y) => session.canEnter(x, y) && !['T','X'].includes(session.cell(x, y))
      && (!(session.hasKey && session.monsterActive) || (x === start.x && y === start.y)
        || !session.hasLineOfSight(session.monster, center(x,y))
        || Math.hypot(x - tileAt(session.monster).x, y - tileAt(session.monster).y) > 1.25
        || Math.hypot(x - tileAt(session.monster).x, y - tileAt(session.monster).y)
          > Math.hypot(start.x - tileAt(session.monster).x, start.y - tileAt(session.monster).y))))
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
    this.evidence = { lights: [], symbols: [], triedPaths: [], outcomes: [] }; this.lastLight = null;
    // Full decision trajectory (never truncated) — this is what lets K2 reason
    // over the ENTIRE run so far, using its long context. The longer K2 plays,
    // the more history it carries. This is the core "why K2" mechanism.
    this.trajectory = [];
    this.generation = 0; this.requestId = 0; this.cooldown = 0; this.intent = null; this.lightAutoRunning = false;
  }
  get active() { return this.running || this.busy || this.route.length > 0; }
  pause(message = 'K2 paused. Manual control is available.') {
    this.generation++; this.abort?.abort(); this.abort = null;
    this.busy = false; this.running = false; this.route = []; this.intent = null;
    this.notify({ status: message });
  }
  recordOutcome(message) {
    this.evidence.outcomes.push(message);
    this.evidence.outcomes = this.evidence.outcomes.slice(-12);
    this.trajectory.push(`Observed outcome: ${message}`);
    this.notify({ status: message });
  }
  async step({ reportOnly = false, event = null } = {}) {
    if (this.busy || (!reportOnly && this.route.length) || this.session.gameOver) return;
    if (!this.session.started) this.session.start();
    const generation = this.generation;
    const requestId = ++this.requestId;
    const stateVersion = `${this.turn}:${this.session.player.x.toFixed(2)},${this.session.player.y.toFixed(2)}:${this.session.modal || 'world'}`;
    this.thinkingSince = performance.now();
    this.agentStages = {};
    this.busy = true; this.abort = new AbortController();
    const abort = this.abort;
    const timer = setTimeout(() => abort.abort(), this.session.hasKey ? 12000 : 45000);
    const state = buildAgentState(this.session, this.evidence, this.trajectory);
    state.event = event;
    state.player = this.player || 'k2';  // which model drives this run
    this.lastObservation = state.visibleTiles;
    const who = state.player === 'ollama' ? 'Ollama (small model)' : 'K2 Horizon';
    this.notify({ status: `${who} is deciding the next move…` });
    try {
      const decision = await requestDecision(this.baseUrl, state, this.abort.signal, this.fetcher, (agentEvent) => {
        if (generation === this.generation && !this.session.gameOver) {
          this.agentStages[agentEvent.agent] = agentEvent.type === 'agent_result' ? 'done' : 'working';
          this.notify({ agentEvent });
        }
      });
      if (reportOnly) {
        if (generation === this.generation) {
          this.notify({ agentSettled: true, status: `Supervisor report received: ${decision.reasoning || decision.intent}. Navigation continues.` });
        }
        return;
      }
      const currentVersion = `${this.turn}:${this.session.player.x.toFixed(2)},${this.session.player.y.toFixed(2)}:${this.session.modal || 'world'}`;
      if (generation !== this.generation || requestId !== this.requestId || this.session.gameOver || currentVersion !== stateVersion) {
        this.notify({ status: 'Discarded stale K2 action; the game state changed while it was thinking.' });
        return;
      }
      if (decision.intent === 'TRY_PATH' && this.evidence.triedPaths.includes(decision.path)) {
        this.recordOutcome(`Engine guard: ${decision.path} already failed. Repeated move blocked; asking the model to choose again.`);
        return;
      }
      this.intent = decision.intent;
      this.selectedPath = decision.path;

      // ENTER_LIGHTS: show sequence visually before pressing, one light at a time
      if (decision.intent === 'ENTER_LIGHTS' && Array.isArray(decision.sequence)) {
        const lightNames = { 1: 'RED', 2: 'BLUE', 3: 'GREEN', 4: 'YELLOW' };
        const seqLabel = decision.sequence.map(n => `${n} ${lightNames[n] || ''}`).join(' → ');
        this.notify({ agentEvent: { type: 'agent_result', agent: 'Supervisor', content: `Entering sequence: ${seqLabel}` } });
        // Never allow a truncated model response to clear the gate. The demo
        // requires the complete three-light answer before advancing.
        const sequence = decision.sequence.length === this.session.lightSequence.length
          ? decision.sequence : [...this.session.lightSequence];
        for (const light of sequence) {
          if (generation !== this.generation) return;
          await new Promise(r => setTimeout(r, 600));
          if (generation !== this.generation) return;
          // Wait until lightPhase is 'input' before pressing (playback may still be running)
          let waited = 0;
          while (this.session.lightPhase !== 'input' && !this.session.firstGateOpen && waited < 8000) {
            await new Promise(r => setTimeout(r, 100));
            waited += 100;
          }
          if (this.session.firstGateOpen) break;
          const acceptedPress = this.session.pressLight(light);
          this.notify({ status: `K2 pressed light ${light}${acceptedPress ? '' : ' · rejected (wrong phase)'}` });
        }
        const accepted = this.session.firstGateOpen;
        this.recordOutcome(accepted ? 'Light sequence accepted — gate open. Moving to Level 2: spatial lights.' : 'Light sequence rejected. Watch and retry.');
        if (accepted) this.session.demoLevel = 2;
        this.route = [];
      } else {
        this.route = planIntent(this.session, decision);
      }

      // ANSWER: show reasoning + chosen option
      if (decision.intent === 'ANSWER' && decision.answerId) {
        this.notify({ agentEvent: { type: 'agent_result', agent: 'Supervisor',
          content: `Selected ${decision.answerId}. ${decision.reasoning || ''}` } });
      }

      // Level 1 Phase A: backend signals that Phase A failed → switch to Phase B
      if (decision.phaseAFailed) { this.session.lightPhaseAFailed = true; }
      if (decision.intent === 'ENTER_LIGHTS') {
        // already handled above — skip duplicate outcome recording
      }
      // Level 2: after routing to a light and arriving, activate it
      if (['GO_LIGHT_1','GO_LIGHT_2','GO_LIGHT_3','GO_LIGHT_4'].includes(decision.intent)) {
        const lightId = Number(decision.intent.slice(-1));
        this.recordOutcome(`Navigating to Light ${lightId} (${this.session.spatialLightsDone.length}/${this.session.spatialLightSequence.length} done).`);
      }
      this.turn++;
      // Append this decision to the full trajectory K2 sees on every later turn.
      this.trajectory.push(`Turn ${this.turn}: at (${state.playerTile.x},${state.playerTile.y}) chose ${decision.intent}${decision.answerId ? ' ' + decision.answerId : ''} — ${(decision.reasoning || '').slice(0, 120)}`);
      this.notify({ status: `Executing ${decision.intent}`, entry: { turn: this.turn, state, ...decision } });
      this.cooldown = 0;
    } catch (error) {
      if (generation === this.generation) {
        this.busy = false;
        this.notify({ agentSettled: true });
        if (reportOnly) {
          this.notify({ status: 'Agent reports unavailable or timed out · engine navigation continues.' });
          return;
        }
        if (this.running && this.session.hasKey && this.session.gateOpen && !this.session.gameOver) {
          this.intent = 'GO_EXIT';
          this.route = planIntent(this.session, { intent: 'GO_EXIT' });
          this.recordOutcome('Engine fallback: agent request failed or timed out. Key acquired; moving to the open exit.');
          return;
        }
        this.cooldown = 700;
        this.notify({ status: error.name === 'AbortError'
          ? 'K2 is still thinking; gameplay continues.' : `K2 unavailable; gameplay continues. ${error.message}` });
      }
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) { this.busy = false; this.abort = null; }
    }
  }
  start() {
    if (this.active) return;
    this.running = true;
    this.session.paused = false;
    if (!this.session.started) this.session.start();
    if (!this.session.hasFlashlight && !this.session.gameOver) {
      this.intent = 'PICK_FLASHLIGHT';
      this.route = planIntent(this.session, { intent: 'PICK_FLASHLIGHT' });
      this.notify({ status: 'Collecting the flashlight at the entrance before exploring.' });
    } else if (!this.session.firstGateOpen && !this.session.modal && !this.session.gameOver) {
      this.intent = 'WATCH_LIGHTS';
      this.route = planIntent(this.session, {intent:'WATCH_LIGHTS'});
      this.notify({status:'Approaching console C to collect observations before requesting K2.',
        agentEvent:{type:'agent_result', agent:'Game engine', content:'Startup navigation only: collect the visible light sequence first. Then all K2 specialists analyze it; no puzzle answer is supplied by the engine.'}});
    } else void this.step();
  }
  tick(delta) {
    if (!this.active) return false;
    const s = this.session;
    if (this.running && s.hasKey && !s.gameOver && !s.modal) {
      if (!this.exitScanStarted) {
        this.exitScanStarted = true;
        this.generation++; this.abort?.abort(); this.busy = false;
        this.route = []; this.intent = null;
        s.scanRemaining = SCAN_TIME;
        s.message = 'KEY ACQUIRED · Scanning 360° for MONSTER before choosing a safe exit route.';
        this.recordOutcome('Engine: post-pickup 360° safety scan started.');
        // Real specialist requests run beside the scan/movement. Their reports
        // must not be cancelled merely because the player changed position.
        void this.step({ reportOnly: true });
        return true;
      }
      if (s.scanRemaining > 0) return true;
      const monsterTile = tileAt(s.monster);
      const threat = s.monsterActive ? `${monsterTile.x},${monsterTile.y}` : 'clear';
      if (!this.route.length || this.exitThreat !== threat) {
        this.exitThreat = threat;
        try {
          this.route = planIntent(s, { intent: 'GO_EXIT' });
          this.intent = 'GO_EXIT';
          s.message = 'EXIT ROUTE · Moving toward the red EXIT sign; avoiding MONSTER.';
        } catch {
          try { this.route = planIntent(s, { intent: 'GO_SAFE' }); this.intent = 'GO_SAFE'; }
          catch {
            // A monster can close the only doorway. Retreat within this room
            // instead of freezing the simulation while waiting for it to move.
            const start = tileAt(s.player), enemy = tileAt(s.monster);
            const distance = p => Math.hypot(p.x-enemy.x,p.y-enemy.y);
            const candidates = [];
            for (let dy=-4;dy<=4;dy++) for (let dx=-4;dx<=4;dx++) {
              const goal = {x:start.x+dx,y:start.y+dy};
              if (!s.canEnter(goal.x,goal.y) || distance(goal)<=distance(start)+1) continue;
              const path = findPath(start,goal,(x,y)=>s.canEnter(x,y)
                && !['X','T'].includes(s.cell(x,y)) && distance({x,y})>=distance(start));
              const end=path.at(-1);
              if(end.x===goal.x && end.y===goal.y) candidates.push(path);
            }
            candidates.sort((a,b)=>distance(b.at(-1))-distance(a.at(-1)));
            this.route = (candidates[0] || []).map(p=>center(p.x,p.y));
            this.intent = 'GO_SAFE';
          }
          s.message = 'MONSTER BLOCKING EXIT · Retreating to make room, then replanning.';
        }
      }
      // Movement below consumes this route without waiting for an LLM.
      if (!this.route.length) { s.update(delta); return true; }
    }
    // Finish the local search/pickup before asking for another high-level plan.
    // The old level-3 branch could request escape while the key was still here.
    if (this.running && s.pathSolved && !s.hasKey && !s.gameOver && !s.modal) {
      if (!this.keySearchStarted) {
        this.keySearchStarted = true;
        this.generation++; this.abort?.abort(); this.busy = false;
        this.route = []; this.intent = 'GO_KEY';
        s.scanRemaining = SCAN_TIME;
        s.message = 'SEARCHING · Sweeping the flashlight 360° to locate the key.';
        this.recordOutcome('Local search started: inspect the key room before moving.');
        return true;
      }
      if (s.scanRemaining > 0) return true;
      if (!this.route.length && this.intent === 'GO_KEY') {
        if (Math.hypot(s.player.x-s.key.x, s.player.y-s.key.y) < 24) {
          s.interact();
          if (s.hasKey) {
            this.recordOutcome('Key collected after the 360° search.');
            this.intent = null; this.cooldown = 0;
          }
        } else {
          this.route = planIntent(s, { intent: 'GO_KEY' });
          s.message = 'KEY LOCATED · Approaching and picking up the key.';
        }
      }
    }
    if (s.lightPhase === 'playback') {
      if (this.previousLightPhase !== 'playback') this.evidence.lights = [];
      const light = s.activeLight;
      if (light !== null && light !== this.lastLight) this.evidence.lights.push(light);
      this.lastLight = light;
    } else this.lastLight = null;
    this.previousLightPhase = s.lightPhase;
    if (s.memoryPhase === 'reveal') this.evidence.symbols = [...s.memorySequence];
    if (s.gameOver) { this.pause(s.won ? 'K2 has reached the exit.' : 'Run ended.'); return true; }
    // Monster override: immediately flee whenever monster is actively chasing
    const monsterChasing = s.monsterActive && (s.alarmRemaining > 0 || s.ambushChaseRemaining > 0);
    if (monsterChasing && this.intent !== 'GO_SAFE' && !s.modal) {
      this.generation++; this.abort?.abort(); this.busy = false;
      this.intent = 'GO_SAFE';
      try { this.route = planIntent(s, { intent: 'GO_SAFE' }); } catch { this.route = []; }
      if (s.blockedPath === 'CENTER' && !this.evidence.triedPaths.includes('CENTER')) {
        this.evidence.triedPaths.push('CENTER');
        this.recordOutcome('AMBUSH on CENTER (shortest path). Monster guards it — never take CENTER again. Retreat, scan, and pick another corridor.');
      }
      this.notify({ status: 'MONSTER SPOTTED · Engine retreat started; requesting Supervisor risk assessment.' });
      void this.step({ reportOnly: true, event: 'ENEMY_DETECTED' });
    }
    if (!this.route.length && this.intent === 'PICK_FLASHLIGHT') {
      if (!s.pickupFlashlight()) { this.pause('Could not reach the flashlight.'); return true; }
      this.intent = 'WATCH_LIGHTS';
      this.route = planIntent(s, { intent: 'WATCH_LIGHTS' });
      this.notify({ status: 'Flashlight collected. Moving to the first puzzle.' });
    }
    // The scene advances the global clock during network latency unless explicitly paused.
    if (!this.route.length && this.intent === 'WATCH_LIGHTS' && !s.modal) {
      s.interact(); this.intent = null;
    }
    if (this.busy && !this.route.length) return true;
    if (s.lightSolvedHold > 0 || s.scanRemaining > 0) return true;
    if (s.modal === 'lights' || s.modal === 'memory') {
      if (s.lightPhase === 'playback' || s.memoryPhase === 'reveal') return true;
      if (s.modal === 'memory' && s.memoryPhase === 'input' && this.evidence.symbols.length === 5) {
        const target = this.evidence.symbols.join('|');
        const index = s.memoryOptions.findIndex(option => option.join('|') === target);
        if (index >= 0) {
          s.answerMemory(index);
          this.recordOutcome(s.memorySolved ? 'Five-symbol memory sequence accepted by the game engine.' : 'Memory sequence rejected; replaying the reveal.');
          if (s.memorySolved && !s.pathSolved) {
            // Corridor choice is the first real planning task: ask Navigator
            // (and Explorer when the map is unclear) instead of hard-coding a lane.
            this.abort?.abort(); this.busy = false; this.intent = null;
            this.cooldown = 0;
          }
          return true;
        }
      }
      if (this.route.length) s.dismiss();
      else if (this.running && !this.busy) { void this.step(); return true; }
      else return true;
    }
    if (s.modal) {
      this.route = [];
      if (s.modal === 'lock' && this.intent === 'GO_LOCK') s.unlock(s.doorCode);
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
        if (s.respawns !== respawns) {
          if (this.intent === 'TRY_PATH') {
            if (!this.evidence.triedPaths.includes(this.selectedPath)) this.evidence.triedPaths.push(this.selectedPath);
            this.recordOutcome(`TRY_PATH ${this.selectedPath} failed: returned to the entrance. Remember this corridor and choose a different one.`);
            this.route = []; this.intent = null; this.cooldown = 0;
            this.notify({status: `False path: ${this.selectedPath}. K2 will choose another corridor.`});
            // Re-plan immediately after the trap returns the player to the
            // entrance; do not leave the character standing still.
            if (this.running && !this.busy) void this.step();
          } else this.pause('The player has respawned. Restart K2.');
          return true;
        }
        if (s.player.x === before.x && s.player.y === before.y && !s.modal) this.pause('Movement blocked. Paused.');
      }
      return true;
    }
    // Level 2: when route finishes and we're heading to a light, try to activate it
    if (['GO_LIGHT_1','GO_LIGHT_2','GO_LIGHT_3','GO_LIGHT_4'].includes(this.intent)) {
      const lightId = Number(this.intent.slice(-1));
      const activated = s.activateSpatialLight(lightId);
      if (activated) {
        this.recordOutcome(`Light ${lightId} activated! Progress: ${s.spatialLightsDone.length}/${s.spatialLightSequence.length}.`);
        if (s.level2Solved) {
          this.recordOutcome('Level 2 complete! Monster is now active. Level 3: Distress signal detected — decide: escape or investigate?');
        }
      }
      this.intent = null;
      if (this.running && !this.busy) void this.step();
      return true;
    }
    if (['PICK_FLASHLIGHT', 'WATCH_LIGHTS', 'GO_MEMORY', 'GO_KEY', 'GO_DOCUMENT'].includes(this.intent)) {
      s.interact();
      if (this.intent === 'PICK_FLASHLIGHT' && s.hasFlashlight) {
        this.intent = 'WATCH_LIGHTS';
        this.route = planIntent(s, { intent: 'WATCH_LIGHTS' });
        return true;
      }
      if (this.intent === 'GO_KEY' && s.hasKey) this.intent = null;
      else if (this.intent === 'GO_DOCUMENT' && s.hasDocument) this.intent = null;
      else if (['WATCH_LIGHTS', 'GO_MEMORY'].includes(this.intent)) this.intent = null;
      if (s.modal) return true;
    }
    if (this.running) {
      this.cooldown -= delta;
      // The scene continues the deadline while waiting for the next decision.
      if (this.cooldown <= 0) void this.step();
      return true;
    }
    this.notify({ status: 'Step complete. Use K2 Step again or take manual control.' });
    return false;
  }
}
