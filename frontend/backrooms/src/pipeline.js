// Live K2 decision pipeline: Observe → Explorer → Survival → Navigator →
// K2 Supervisor → Act. Nodes light up as the Supervisor consults each specialist,
// so viewers SEE the multi-agent orchestration happening in real time. Agents the
// Supervisor chooses not to consult this turn stay dim — that visible difference
// is the point: K2 routes dynamically, it is not a fixed pipeline.

const SHORT = {
  Explorer: 'observing', Survival: 'assessing threat',
  Navigator: 'proposing move', Supervisor: 'coordinating',
};

export function createPipeline() {
  const root = document.getElementById('k2-pipeline');
  if (!root) return { onEvent() {}, onObserve() {}, onDecision() {}, reset() {} };
  const node = (name) => root.querySelector(`.pipe-node[data-node="${name}"]`);
  const setState = (name, state) => { const n = node(name); if (n) n.dataset.state = state; };
  const setMsg = (name, msg) => { const n = node(name); if (n) n.querySelector('.pipe-msg').textContent = msg || ''; };

  const reset = () => {
    for (const name of ['observe', 'Explorer', 'Survival', 'Navigator', 'Supervisor', 'act']) {
      setState(name, 'idle'); setMsg(name, '');
    }
  };

  return {
    reset,
    // Called when a fresh K2 turn starts.
    onObserve() {
      reset();
      setState('observe', 'active');
      setMsg('observe', 'reading state + history');
      // Do not light Supervisor until the backend actually emits a
      // supervisor event. Deterministic opening rules may finish without it.
    },
    // Called for each agent_thinking / agent_result event from the backend.
    onEvent(ev) {
      const name = ev.agent;
      if (!['Explorer', 'Survival', 'Navigator', 'Supervisor'].includes(name)) return;
      setState('observe', 'done');
      if (ev.type === 'agent_thinking') {
        setState(name, 'active');
        setMsg(name, SHORT[name] || 'working');
      } else if (ev.type === 'agent_result') {
        setState(name, 'done');
        // Show a very short snippet of what the agent concluded.
        const text = (ev.content || '').replace(/\s+/g, ' ').trim();
        setMsg(name, text.slice(0, 48) + (text.length > 48 ? '…' : ''));
      }
    },
    // Called with the final decision. Marks Supervisor done + Act firing.
    onDecision(intent, reason) {
      setState('Supervisor', 'done');
      setMsg('Supervisor', (reason || '').replace(/\s+/g, ' ').slice(0, 56));
      setState('act', 'active');
      setMsg('act', intent);
    },
  };
}
