import React from 'react';

import { cn } from '@/lib/utils';
import { agentState, type AgentState } from '@/lib/agents';

const DOT: Record<AgentState, string> = {
  free: 'bg-emerald-500',
  busy: 'bg-amber-500',
  offline: 'bg-muted-foreground/50',
  unknown: 'border border-muted-foreground/60 bg-transparent',
};

/** The dot next to an agent's name: green free, amber busy, grey offline. */
export function AgentDot({ agent, className }: { agent: any; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT[agentState(agent)], className)}
    />
  );
}

export default AgentDot;
