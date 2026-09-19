import { AgentController } from './agent.js';

export function createAgentPanel(session, restart) {
  const el = (id) => document.getElementById(id);
  let controller;
  const log = el('agent-log');
  log.replaceChildren();
  const englishText = (value, fallback) => typeof value === 'string' && !/\p{Script=Han}/u.test(value) ? value : fallback;
  const notify = ({ status, entry }) => {
    el('agent-status').textContent = englishText(status, 'K2 paused. Check the backend connection and try again.');
    if (entry) {
      const item = document.createElement('li');
      const position = entry.state.playerTile;
      item.textContent = `#${entry.turn} · (${position.x}, ${position.y}) · ${entry.intent}${entry.answerId ? ` ${entry.answerId}` : ''}\n${englishText(entry.reason, 'The backend returned a non-English explanation.')}`;
      log.prepend(item);
      while (log.children.length > 15) log.lastElementChild.remove();
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
  notify({ status: 'Solve the light puzzle to open door A before letting K2 take over.' });
  return {
    controller,
    sync() {
      const disabled = controller.busy || controller.route.length > 0 || session.won || !session.firstGateOpen;
      el('ai-step').disabled = disabled || controller.running;
      el('dialog-ai-step').disabled = disabled || controller.running;
      el('ai-auto').disabled = disabled || controller.running;
      el('backend-url').disabled = controller.active;
    },
    destroy() { controller.pause(); },
  };
}
