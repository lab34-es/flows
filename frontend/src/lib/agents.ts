/**
 * How a remote agent is doing, in one word. Shared by the top bar's selector
 * and the Remote agents settings, so both say the same thing.
 */

export type AgentState = 'free' | 'busy' | 'offline' | 'unknown';

export const agentState = (agent: any): AgentState => {
  if (!agent) { return 'unknown'; }
  if (!agent.online) { return 'offline'; }
  return agent.busy ? 'busy' : 'free';
};

export const agentLabel = (agent: any): string => {
  switch (agentState(agent)) {
    case 'free': return 'online';
    case 'busy': return `busy${agent.job ? ` with job ${String(agent.job).slice(0, 8)}` : ''}`;
    case 'offline': return 'offline';
    default: return 'never seen';
  }
};
