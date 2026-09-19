import { AgentController } from './agent.js';
import { tileAt } from './level.js';

export function createAgentPanel(session, restart, autoStart = false) {
  const el = (id) => document.getElementById(id);
  let controller;
  const log = el('agent-log');
  log.replaceChildren();
  const dialogLog = el('dialog-agent-log');
  dialogLog.replaceChildren();
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
    dialogLog.append(item.cloneNode(true));
    while (dialogLog.children.length > 8) dialogLog.firstElementChild.remove();
    dialogLog.scrollTop = dialogLog.scrollHeight;
    log.append(item);
    while (log.children.length > 60) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  };
  const notify = ({ status, entry, agentEvent }) => {
    if (status !== undefined) el('agent-status').textContent = status;
    if (agentEvent) {
      const done = agentEvent.type === 'agent_result';
      addCard(agentEvent.agent, done ? 'Report' : 'Working',
        done ? agentEvent.content : agentEvent.message, done ? 'report' : 'working');
    }
    if (entry) addCard('Supervisor', `Turn ${entry.turn}: ${entry.intent}${entry.answerId ? ` (${entry.answerId})` : ''}`, entry.reason, 'decision');
    if (entry && controller.route.length) {
      const points = [entry.state.playerTile, ...controller.route.map(tileAt)];
      const corners = points.filter((p, i) => i === 0 || i === points.length - 1 ||
        (p.x - points[i-1].x !== points[i+1].x - p.x || p.y - points[i-1].y !== points[i+1].y - p.y));
      addCard('Game engine', 'Movement route', corners.map(p => `(${p.x}, ${p.y})`).join(' → '), 'report');
    }
  };
  const baseUrl = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';
  el('backend-url').value = baseUrl;
  controller = new AgentController(session, notify, baseUrl);
  const configure = () => {
    try {
      const url = new URL(el('backend-url').value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
      controller.baseUrl = url.href.replace(/\/$/, '');
      return true;
    } catch { notify({ status: 'Enter a valid http or https backend URL.' }); return false; }
  };
  const step = () => { if (configure()) void controller.step(); };
  el('ai-step').onclick = step;
  el('dialog-ai-step').onclick = step;
  el('ai-auto').onclick = () => { if (configure()) controller.start(); };
  el('ai-pause').onclick = () => controller.pause();
  el('dialog-ai-pause').onclick = () => controller.pause();
  el('ai-reset').onclick = () => { controller.pause(); restart(); };
  el('start-k2-run').onclick = () => {
    if (!session.started) { if (configure()) controller.start(); }
    else { controller.pause(); restart(); }
  };
  notify({ status: 'Ready. Press Start K2. Thinking time counts toward the 180-second limit.' });
  if (autoStart && configure()) controller.start();
  return {
    controller,
    sync() {
      const visible = controller.lastObservation;
      const names = {C:'Light console',R:'Memory console',A:'First gate',B:'Symbols',K:'Key',L:'Code door',D:'Document',G:'Exit gate',S:'Shelter',E:'Exit','1':'Red light','2':'Blue light','3':'Green light','4':'Yellow light'};
      if (visible) {
        const objects = visible.filter(t => names[t.tile]);
        el('observation-status').textContent = `LAST OBSERVATION SENT TO K2 · ${visible.length} visible cells · ${objects.length ? objects.map(t => `${names[t.tile]} (${t.x}, ${t.y})`).join(' · ') : 'Only walls and floor; no visible interactable object'}`;
      }
      const position = tileAt(session.player);
      const activity = controller.busy ? `Scanning nearby cells · waiting ${(Math.max(0,performance.now() - controller.thinkingSince)/1000).toFixed(1)}s · ` +
        ['Explorer','Survival','Navigator','Supervisor'].map(name => `${name}: ${controller.agentStages?.[name] || 'pending'}`).join(' / ')
        : controller.active ? 'Executing the selected action' : 'Ready';
      el('scan-status').textContent = activity;
      el('dialog-scan-status').textContent = activity;
      const targets = {WATCH_LIGHTS:'Light console C',GO_MEMORY:'Memory console R',TRY_PATH:`${controller.selectedPath || ''} corridor`,GO_KEY:'Key K',GO_LOCK:'Code door L',GO_DOCUMENT:'Document D',GO_SAFE:'Safe zone S',GO_EXIT:'Exit E'};
      const name = targets[controller.intent] || controller.intent || 'next goal';
      if (controller.route.length) {
        const next = tileAt(controller.route[0]);
        const goal = tileAt(controller.route.at(-1));
        el('movement-status').textContent = `MOVING → ${name} | Now (${position.x}, ${position.y}) → Next (${next.x}, ${next.y}) → Target (${goal.x}, ${goal.y}) | ${controller.route.length} waypoints left`;
      } else {
        el('movement-status').textContent = session.gameOver ? 'Run ended.' : controller.busy
          ? `THINKING at (${position.x}, ${position.y}) — waiting for the next destination`
          : session.modal ? `INTERACTING at (${position.x}, ${position.y}) — ${session.modal}`
          : 'Route appears when K2 chooses a destination.';
      }
      el('run-status').textContent = !session.started ? 'Ready — press Start K2'
        : session.gameOver ? (session.won ? 'Escaped' : 'Run ended — press Start K2 to retry')
        : controller.busy && controller.route.length ? 'Running · moving + K2 thinking'
        : controller.busy ? 'Running · K2 thinking · timer active'
        : controller.active ? 'Running · K2 executing' : 'Manual control · timer active';
      el('start-k2-run').textContent = session.started ? '↻ Restart K2' : '▶ Start K2';
      el('dialog-agent-status').textContent = controller.active
        ? `K2 is playing automatically — no input needed. ${el('agent-status').textContent}`
        : 'K2 is paused. Press Let K2 Play to resume.';
      const disabled = controller.busy || controller.route.length > 0 || session.gameOver;
      el('ai-step').disabled = disabled || controller.running;
      el('dialog-ai-step').disabled = disabled || controller.running;
      el('ai-auto').disabled = disabled || controller.running;
      el('backend-url').disabled = controller.active;
    },
    destroy() { controller.pause(); },
  };
}
