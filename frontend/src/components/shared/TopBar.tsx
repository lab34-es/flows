import React from 'react';
import { CircleHelp, Globe, Settings } from 'lucide-react';

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
import { useAppState } from '@/context/AppStateContext';
import { useActiveLocation, useWorkspace } from '@/workspace/WorkspaceContext';

/* The bar over every page. On the left, which folder the app is working in
   and its git state; on the right, the three controls that belong to the whole
   app rather than to any one page: which environment the flows run against,
   the help, and the settings. */
export function TopBar() {
  const { openTab } = useWorkspace();
  const location = useActiveLocation();
  const { environments, environment, setEnvironment } = useAppState();

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
