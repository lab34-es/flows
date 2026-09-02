import React from 'react';
import { CircleHelp, Globe, Radio, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ContextIndicator from '@/components/shared/ContextIndicator';
import { AgentDot } from '@/components/shared/AgentStatus';
import { agentLabel } from '@/lib/agents';
import { useAppState } from '@/context/AppStateContext';
import { useActiveLocation, useWorkspace } from '@/workspace/WorkspaceContext';

/* The bar over every page. On the left, which folder the app is working in
   and its git state; on the right, the three controls that belong to the whole
   app rather than to any one page: which environment the flows run against,
   the help, and the settings. */
export function TopBar() {
  const { openTab } = useWorkspace();
  const location = useActiveLocation();
  const { environments, environment, setEnvironment, agents, agent, setAgent } = useAppState();

  // The selector only appears once there is somewhere else to run: a broker
  // with at least one agent seen, or an agent picked earlier
  const LOCAL = '__local__';
  const showAgents = agents.length > 0 || Boolean(agent);
  const picked = agents.find((item) => item.agent === agent);

  const onSettings = location.pathname.startsWith('/settings');
  const onHelp = location.pathname.startsWith('/help');

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <ContextIndicator />

      {/* ml-auto is what pushes the group to the right edge of the bar */}
      <div className="ml-auto flex items-center gap-2">
        <Select value={environment || undefined} onValueChange={setEnvironment}>
          <SelectTrigger size="sm" className="w-44" aria-label="Environment">
            <Globe className="size-3.5" />
            <SelectValue placeholder="Select environment" />
          </SelectTrigger>
          <SelectContent align="end">
            {environments.map((env) => (
              <SelectItem key={env} value={env}>{env}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {showAgents && (
          <Select value={agent || LOCAL} onValueChange={(value) => setAgent(value === LOCAL ? '' : value)}>
            <SelectTrigger
              size="sm"
              className="w-48"
              aria-label="Where flows run"
              title={agent ? `Flows run on “${agent}” (${agentLabel(picked)})` : 'Flows run on this machine'}
            >
              <Radio className="size-3.5" />
              <SelectValue placeholder="Run here" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={LOCAL}>This machine</SelectItem>
              {agents.map((item) => (
                <SelectItem key={item.agent} value={item.agent}>
                  <AgentDot agent={item} /> {item.agent}
                </SelectItem>
              ))}
              {agent && !picked && (
                <SelectItem value={agent}>
                  <AgentDot agent={null} /> {agent}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}

        <Button
          variant={onHelp ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => openTab('/help')}
          title="How flows, steps and applications work"
        >
          <CircleHelp /> Help
        </Button>

        <Button
          variant={onSettings ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => openTab('/settings')}
          title="AI, Xray and UI settings"
        >
          <Settings /> Settings
        </Button>
      </div>
    </header>
  );
}

export default TopBar;
