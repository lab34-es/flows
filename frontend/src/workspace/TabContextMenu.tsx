import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DockviewDefaultTab } from 'dockview-react';
import type { DockviewPanelApi, IDockviewPanelHeaderProps } from 'dockview-react';
import { ArrowRightToLine, CopyX, X } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The right-click menu of a tab: close it, close its group's other tabs, or
 * close everything to its right — VS Code's classics. Dockview's own tab
 * context menu lives in its enterprise package, so this one is built from
 * the app's dropdown pieces: the tab renderer below reports the click, and
 * the provider shows the menu at the pointer through an invisible anchor.
 */

interface TabMenuState {
  x: number;
  y: number;
  api: DockviewPanelApi;
}

const TabMenuContext = createContext<((event: React.MouseEvent, api: DockviewPanelApi) => void) | null>(null);

/** The tab renderer for every panel: the default tab, plus the right-click. */
export function WorkspaceTab(props: IDockviewPanelHeaderProps) {
  const openMenu = useContext(TabMenuContext);

  return (
    <DockviewDefaultTab
      {...props}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openMenu?.(event, props.api);
      }}
    />
  );
}

export function TabMenuProvider({ children }) {
  const [menu, setMenu] = useState<TabMenuState | null>(null);

  const openMenu = useCallback((event: React.MouseEvent, api: DockviewPanelApi) => {
    setMenu({ x: event.clientX, y: event.clientY, api });
  }, []);

  // What the actions will work on. Group membership can change while the
  // menu is open (another tab closing, a drag), so the panel list is read
  // when an action runs, not when the menu opens.
  const groupPanels = (api: DockviewPanelApi) => api.group.panels;

  const closeTab = () => menu?.api.close();

  const closeOthers = () => {
    if (!menu) { return; }
    for (const panel of [...groupPanels(menu.api)]) {
      if (panel.id !== menu.api.id) { panel.api.close(); }
    }
  };

  const closeToTheRight = () => {
    if (!menu) { return; }
    const panels = groupPanels(menu.api);
    const index = panels.findIndex((panel) => panel.id === menu.api.id);
    if (index === -1) { return; }
    for (const panel of [...panels.slice(index + 1)]) {
      panel.api.close();
    }
  };

  // Disabled entries beat disappearing ones: the menu keeps its shape.
  const { hasOthers, hasRight } = useMemo(() => {
    if (!menu) { return { hasOthers: false, hasRight: false }; }
    const panels = groupPanels(menu.api);
    const index = panels.findIndex((panel) => panel.id === menu.api.id);
    return {
      hasOthers: panels.length > 1,
      hasRight: index !== -1 && index < panels.length - 1,
    };
  }, [menu]);

  return (
    <TabMenuContext.Provider value={openMenu}>
      {children}

      <DropdownMenu open={Boolean(menu)} onOpenChange={(open) => !open && setMenu(null)}>
        {/* A 1px anchor parked under the pointer: Radix positions the menu
            against its trigger, and this is the trigger. */}
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            style={{ position: 'fixed', left: menu?.x ?? 0, top: menu?.y ?? 0, width: 1, height: 1 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" sideOffset={2}>
          <DropdownMenuItem onClick={closeTab}>
            <X /> Close tab
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasOthers} onClick={closeOthers}>
            <CopyX /> Close other tabs
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasRight} onClick={closeToTheRight}>
            <ArrowRightToLine /> Close tabs to the right
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TabMenuContext.Provider>
  );
}
