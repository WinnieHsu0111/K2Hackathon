import { AGENT_NAMES, idleAgents, applyAgentEvent } from './hub-state.js';

export function createHub() {
  const root = document.getElementById('hub');
  const caption = document.getElementById('hub-caption');
  const bubblesEl = document.getElementById('agent-bubbles');
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
    const chain = document.getElementById('agent-chain');
    if (chain) {
      const names = ['Supervisor', ...AGENT_NAMES.filter(name => name !== 'Supervisor' && states[name].state !== 'idle')];
      chain.replaceChildren(...names.map(name => {
        const chip = document.createElement('span');
        chip.className = `agent-chip agent-${name.toLowerCase()}`;
        chip.dataset.state = states[name].state;
        chip.dataset.agent = name;
        chip.textContent = name === 'Supervisor' ? name : `Supervisor ⇄ ${name}`;
        return chip;
      }));
    }
  };

  const addBubble = (agent, text, isThinking) => {
    if (!bubblesEl || !text) return;
    const div = document.createElement('div');
    div.className = `agent-bubble bubble-${agent.toLowerCase()}${isThinking ? ' bubble-thinking' : ''}`;
    const label = document.createElement('strong'); label.textContent = agent;
    const body = document.createElement('span'); body.textContent = text;
    div.append(label, body);
    bubblesEl.appendChild(div);
    bubblesEl.scrollTop = bubblesEl.scrollHeight;
  };

  paint();
  return {
    onObserve() {
      for (const value of Object.values(states)) value.state = 'idle';
      states = applyAgentEvent(states, { type: 'agent_thinking', agent: 'Supervisor' });
      paint();
      caption.textContent = 'Supervisor · request started; preparing delegation';
      if (bubblesEl) bubblesEl.replaceChildren();
    },
    onEvent(event) {
      // The request-start indicator and the backend's first Supervisor event
      // represent the same call, not two calls.
      if (!(event.agent === 'Supervisor' && event.type === 'agent_thinking' && states.Supervisor.state === 'active')) {
        states = applyAgentEvent(states, event);
      }
      if (event.type === 'agent_result' && event.agent !== 'Supervisor'
          && !AGENT_NAMES.some(name => name !== 'Supervisor' && states[name].state === 'active')) {
        states.Supervisor.state = 'active';
      }
      paint();
      if (!AGENT_NAMES.includes(event.agent)) return;
      if (event.type === 'agent_thinking' && event.message) {
        addBubble(event.agent, event.message, true);
        caption.textContent = `${event.agent === 'Supervisor' ? 'Model' : 'Supervisor'} → ${event.agent} · ${event.message}`;
      } else if (event.type === 'agent_result' && (event.content || event.message)) {
        addBubble(event.agent, event.content || event.message, false);
        caption.textContent = event.agent === 'Supervisor' ? 'Supervisor → final report' : `${event.agent} → Supervisor · report returned`;
      }
    },
    onDecision(intent) { for (const value of Object.values(states)) if (value.state !== 'idle') value.state = 'done'; paint(); caption.textContent = `Decision received → ${intent}`; },
    onIdle() {
      let changed = false;
      for (const value of Object.values(states)) if (['active', 'waiting'].includes(value.state)) { value.state = 'idle'; changed = true; }
      if (changed) { paint(); caption.textContent = 'Calls stopped · no agent is currently running'; }
    },
  };
}
