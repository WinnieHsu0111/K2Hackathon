import { AgentController } from './agent.js';

export function createAgentPanel(session, restart) {
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
  notify({ status: 'K2 is starting an autonomous run from the first room.' });
  // Start immediately so the clock cannot run before the first model request.
  if (configure()) controller.start();
  return {
    controller,
    sync() {
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
