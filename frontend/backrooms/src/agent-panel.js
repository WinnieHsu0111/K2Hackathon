import { AgentController } from './agent.js';
import { tileAt } from './level.js';
import { createHub } from './hub.js';

// Which model plays, remembered across scene restarts (restart rebuilds the
// panel). Kept on a global holder so it survives HMR and scene teardown safely.
const playerState = (globalThis.__k2PlayerState ||= { current: 'k2' });

export function createAgentPanel(session, restart, autoStart = false) {
  const el = (id) => document.getElementById(id);
  let controller;
  const pipeline = createHub();
  const log = el('agent-log');
  const bubbles = el('agent-bubbles');
  log?.replaceChildren();
  const roles = { Supervisor: 'Coordinator', Explorer: 'Environment', Survival: 'Risk assessment', Navigator: 'Next action' };
  const addCard = (agent, title, body, kind) => {
    const item = document.createElement('li');
    item.className = `workflow-card ${kind}`;
    const heading = document.createElement('strong');
    heading.textContent = `${agent} · ${roles[agent] || 'Agent'} — ${title}`;
    item.append(heading);
    if (body) {
      const detail = document.createElement('div');
      let explanation = body;
      try {
        const parsed = JSON.parse(body.replace(/```json|```/g, '').trim());
        explanation = parsed.reasoning || parsed.message || body;
      } catch { /* Plain-text reports need no parsing. */ }
      detail.textContent = explanation;
      item.append(detail);
    }
    if (log) {
      log.append(item);
      while (log.children.length > 60) log.firstElementChild.remove();
      log.scrollTop = log.scrollHeight;
    }
  };
  const addBubble = (agent, body, kind = 'report') => {
    if (!bubbles || !body) return;
    const bubble = document.createElement('div');
    bubble.className = `agent-bubble bubble-${agent.toLowerCase()} ${kind}`;
    const who = document.createElement('strong'); who.textContent = agent;
    const text = document.createElement('span');
    text.textContent = String(body).replace(/\s+/g, ' ').trim().split(/(?<=[.!?。！？])\s+/)[0];
    bubble.append(who, text); bubbles.append(bubble);
    while (bubbles.children.length > 8) bubbles.firstElementChild.remove();
    bubbles.scrollTop = bubbles.scrollHeight;
  };
  const notify = ({ status, entry, agentEvent }) => {
    const statusEl = el('agent-status');
    if (status !== undefined && statusEl) statusEl.textContent = status;
    // A new decision turn is starting — reset the pipeline and light "Observe".
    if (status && /deciding the next move/i.test(status)) pipeline.onObserve();
    if (agentEvent) {
      pipeline.onEvent(agentEvent);
      const done = agentEvent.type === 'agent_result';
      addCard(agentEvent.agent, done ? 'Report' : 'Working',
        done ? agentEvent.content : agentEvent.message, done ? 'report' : 'working');
      if (done) addBubble(agentEvent.agent, agentEvent.content, agentEvent.agent === 'Supervisor' ? 'decision' : 'report');
    }
    if (entry) {
      pipeline.onDecision(entry.intent, entry.reason);
      addCard('Supervisor', `Turn ${entry.turn}: ${entry.intent}${entry.answerId ? ` (${entry.answerId})` : ''}`, entry.reason, 'decision');
    }
    if (entry && controller.route.length) {
      const points = [entry.state.playerTile, ...controller.route.map(tileAt)];
      const corners = points.filter((p, i) => i === 0 || i === points.length - 1 ||
        (p.x - points[i-1].x !== points[i+1].x - p.x || p.y - points[i-1].y !== points[i+1].y - p.y));
      addCard('Game engine', 'Movement route', corners.map(p => `(${p.x}, ${p.y})`).join(' → '), 'report');
    }
  };
  const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';
  const urlInput = el('backend-url');
  if (urlInput) urlInput.value = baseUrl;
  controller = new AgentController(session, notify, baseUrl);
  const configure = () => {
    try {
      const url = new URL(urlInput ? urlInput.value : baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
      controller.baseUrl = url.href.replace(/\/$/, '');
      return true;
    } catch { notify({ status: 'Enter a valid http or https backend URL.' }); return false; }
  };
  const bind = (id, fn) => { const b = el(id); if (b) b.onclick = fn; };
  // Which model plays: sets controller.player, restarts a clean run, and starts.
  const runWith = (player) => {
    controller.player = player;
    controller.pause();
    restart();
    // restart() rebuilds the scene; the fresh panel auto-starts with this player
    // via playerState below.
    playerState.current = player;
  };
  bind('play-k2', () => runWith('k2'));
  bind('play-ollama', () => runWith('ollama'));
  bind('ai-pause', () => {
    if (session.paused) { session.paused = false; controller.start(); }
    else { controller.pause('Run paused. Resume to continue with the same memory.'); session.paused = true; }
  });
  bind('ai-reset', () => { controller.pause(); restart(); });
  bind('ai-step', () => { if (configure()) void controller.step(); });
  bind('ai-auto', () => { if (configure()) controller.start(); });
  bind('dialog-ai-pause', () => controller.pause());
  bind('start-k2-run', () => { if (!session.started) { if (configure()) controller.start(); } else { controller.pause(); restart(); } });
  notify({ status: 'Press “Run K2 Horizon” or “Run Ollama” to watch a model play the level.' });
  // Carry the chosen model across scene restarts so the correct player resumes.
  controller.player = playerState.current;
  if (autoStart && configure()) controller.start();
  return {
    controller,
    sync() {
      // Every status target is optional now (the demo layout hides most of them),
      // so write through a null-safe setter and never touch a missing element.
      const set = (id, text) => { const n = el(id); if (n) n.textContent = text; };
      const dis = (id, v) => { const n = el(id); if (n) n.disabled = v; };
      if (!controller.active) pipeline.onIdle();
      set('ai-pause', session.paused ? 'Resume' : 'Pause');
      const feed = el('memory-feed');
      const memories = controller.evidence.outcomes;
      if (feed.dataset.content !== JSON.stringify(memories)) {
        feed.dataset.content = JSON.stringify(memories);
        feed.replaceChildren(...memories.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
      }
      set('memory-summary', `${controller.turn} decisions · ${controller.evidence.triedPaths.length} failed corridors remembered${controller.evidence.triedPaths.length ? ': ' + controller.evidence.triedPaths.join(', ') : ''}`);
      const visible = controller.lastObservation;
      const names = {C:'Light console',R:'Memory console',A:'First gate',B:'Symbols',K:'Key',L:'Code door',D:'Document',G:'Exit gate',S:'Shelter',E:'Exit','1':'Red light','2':'Blue light','3':'Green light','4':'Yellow light'};
      if (visible) {
        const objects = visible.filter(t => names[t.tile]);
        set('observation-status', `LAST OBSERVATION SENT TO K2 · ${visible.length} visible cells · ${objects.length ? objects.map(t => `${names[t.tile]} (${t.x}, ${t.y})`).join(' · ') : 'Only walls and floor; no visible interactable object'}`);
      }
      const position = tileAt(session.player);
      const activity = controller.busy ? `Scanning nearby cells · waiting ${(Math.max(0,performance.now() - controller.thinkingSince)/1000).toFixed(1)}s · ` +
        ['Explorer','Survival','Navigator','Supervisor'].map(name => `${name}: ${controller.agentStages?.[name] || 'pending'}`).join(' / ')
        : controller.active ? 'Executing the selected action' : 'Ready';
      set('scan-status', activity);
      set('dialog-scan-status', activity);
      const targets = {WATCH_LIGHTS:'Light console C',GO_MEMORY:'Memory console R',TRY_PATH:`${controller.selectedPath || ''} corridor`,GO_KEY:'Key K',GO_LOCK:'Code door L',GO_DOCUMENT:'Document D',GO_SAFE:'Safe zone S',GO_EXIT:'Exit E'};
      const name = targets[controller.intent] || controller.intent || 'next goal';
      if (controller.route.length) {
        const next = tileAt(controller.route[0]);
        const goal = tileAt(controller.route.at(-1));
        set('movement-status', `MOVING → ${name} | Now (${position.x}, ${position.y}) → Next (${next.x}, ${next.y}) → Target (${goal.x}, ${goal.y}) | ${controller.route.length} waypoints left`);
      } else {
        set('movement-status', session.gameOver ? 'Run ended.' : controller.busy
          ? `THINKING at (${position.x}, ${position.y}) — waiting for the next destination`
          : session.modal ? `INTERACTING at (${position.x}, ${position.y}) — ${session.modal}`
          : 'Route appears when K2 chooses a destination.');
      }
      set('run-status', !session.started ? 'Ready'
        : session.gameOver ? (session.won ? 'Escaped' : 'Run ended')
        : controller.busy && controller.route.length ? 'Running · moving + thinking'
        : controller.busy ? 'Running · thinking'
        : controller.active ? 'Running · executing' : 'Manual control');
      const statusEl = el('agent-status');
      set('dialog-agent-status', controller.active
        ? `Playing automatically — no input needed. ${statusEl ? statusEl.textContent : ''}`
        : session.paused ? 'Paused. Press Resume to continue.' : 'Manual control available.');
      const disabled = controller.busy || controller.route.length > 0 || session.gameOver;
      dis('ai-step', disabled || controller.running);
      dis('dialog-ai-step', disabled || controller.running);
      dis('ai-auto', disabled || controller.running);
      dis('backend-url', controller.active);
    },
    destroy() { controller.pause(); },
  };
}
