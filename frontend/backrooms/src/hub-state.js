export const AGENT_NAMES = ['Supervisor', 'Explorer', 'Survival', 'Navigator'];
export const idleAgents = () => Object.fromEntries(AGENT_NAMES.map(name => [name, { state: 'idle', calls: 0 }]));
export function applyAgentEvent(states, event) {
  if (!AGENT_NAMES.includes(event.agent) || !['agent_thinking', 'agent_result'].includes(event.type)) return states;
  const next = Object.fromEntries(Object.entries(states).map(([name, value]) => [name, { ...value }]));
  if (event.type === 'agent_thinking') {
    if (event.agent !== 'Supervisor' && next.Supervisor.state === 'active') next.Supervisor.state = 'waiting';
    next[event.agent] = { state: 'active', calls: next[event.agent].calls + 1 };
  } else next[event.agent].state = 'done';
  return next;
}
