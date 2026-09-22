import { AGENT_NAMES, idleAgents, applyAgentEvent } from './hub-state.js';

export function createHub() {
  const root = document.getElementById('hub');
  const caption = document.getElementById('hub-caption');
  let states = idleAgents();
  const roles = { Supervisor: 'ORCHESTRATE', Explorer: 'OBSERVE', Survival: 'ASSESS RISK', Navigator: 'PLAN ACTION' };
  const nodes = {};
  root.replaceChildren(...AGENT_NAMES.map((name, i) => {
    const node = document.createElement('div');
    node.className = 'agent-node'; node.dataset.agent = name;
    node.innerHTML = `<span class="agent-led" aria-hidden="true"></span><div><small>${roles[name]}</small><strong>${name}</strong></div><span class="agent-state">Standby</span><span class="agent-calls">00</span>`;
    nodes[name] = node; return node;
  }));
  const paint = () => {
    for (const name of AGENT_NAMES) {
      const value = states[name], node = nodes[name];
      node.dataset.state = value.state;
      const label = { idle: 'Standby', active: 'Calling', waiting: 'Waiting', done: 'Returned' }[value.state];
      node.querySelector('.agent-state').textContent = label;
      node.querySelector('.agent-calls').textContent = String(value.calls).padStart(2, '0');
      node.setAttribute('aria-label', `${name}: ${label}, ${value.calls} calls`);
    }
  };
  paint();
  return {
    onObserve() { for (const value of Object.values(states)) value.state = 'idle'; paint(); caption.textContent = 'Request sent · waiting for agent call events'; },
    onEvent(event) {
      states = applyAgentEvent(states, event); paint();
      if (!AGENT_NAMES.includes(event.agent)) return;
      caption.textContent = event.type === 'agent_result' ? `${event.agent} → report returned` : `${event.agent === 'Supervisor' ? 'Model' : 'Supervisor'} → ${event.agent} · ${event.message || 'Working'}`;
    },
    onDecision(intent) { for (const value of Object.values(states)) if (value.state !== 'idle') value.state = 'done'; paint(); caption.textContent = `Decision received → ${intent}`; },
    onIdle() {
      let changed = false;
      for (const value of Object.values(states)) if (['active', 'waiting'].includes(value.state)) { value.state = 'idle'; changed = true; }
      if (changed) { paint(); caption.textContent = 'Calls stopped · no agent is currently running'; }
    },
  };
}
