import React, { useEffect, useMemo, useRef } from 'react';
import { DockviewReact } from 'dockview-react';
import type { DockviewReadyEvent, DockviewTheme } from 'dockview-react';
import { Workflow } from 'lucide-react';

import 'dockview-react/dist/styles/dockview.css';
import '@/workspace/workspace.css';

import { Button } from '@/components/ui/button';
import RoutePanel from '@/workspace/RoutePanel';
import { useWorkspace } from '@/workspace/WorkspaceContext';
import { useTheme } from '@/context/ThemeContext';

const LAYOUT_STORAGE_KEY = 'lab34-flows:workspace';

// A drag settles in a burst of layout events; one write at the end is enough.
const SAVE_DELAY = 500;

const components = { page: RoutePanel };

/** What an empty workspace shows, once every tab has been closed. */
function Watermark() {
  const { openTab } = useWorkspace();

  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-md">
        <Workflow className="size-6" />
      </div>
      <p>Open a flow, a folder or an application from the sidebar — everything opens as a tab.</p>
      <Button variant="outline" size="sm" onClick={() => openTab('/')}>
        Open home
      </Button>
    </div>
  );
}

/**
 * The tabbed content area: a Dockview dock where every tab is a route of the
 * app. Tabs can be reordered, split into groups by dragging a tab to an
 * edge (VS Code style), and the whole layout — which tabs, in which groups,
 * at which sizes — survives a reload through localStorage.
 */
export function Workspace() {
  const { registerApi, openTab, setActiveRoute } = useWorkspace();
  const { theme } = useTheme();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A pending save belongs to this dock; a dock being torn down (StrictMode
  // remounts, hot reload) must not write its final state over the layout the
  // next dock just restored.
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // One theme, both color schemes: the CSS variables the class points at
  // already flip with the app's .dark class.
  const dockviewTheme = useMemo<DockviewTheme>(
    () => ({
      name: 'flows',
      className: 'dockview-theme-flows',
      colorScheme: theme,
      tabGroupIndicator: 'none',
    }),
    [theme]
  );

  const onReady = (event: DockviewReadyEvent) => {
    const { api } = event;
    registerApi(api);

    let restored = false;
    try {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (saved) {
        api.fromJSON(JSON.parse(saved));
        restored = true;
      }
    } catch {
      // A layout from another version of the app is not worth crashing over.
      try { localStorage.removeItem(LAYOUT_STORAGE_KEY); } catch { /* ignore */ }
    }

    // The address the app was opened on: a deep link opens (or focuses) its
    // tab, a bare "/" only adds the home tab when nothing was restored.
    const initial = window.location.pathname + window.location.search;
    if (initial !== '/') {
      openTab(initial);
    } else if (!restored || api.panels.length === 0) {
      openTab('/');
    }

    // Tabs report their own route when focused; the one case they cannot
    // cover is the last tab closing, when nothing is active anymore.
    api.onDidActivePanelChange(({ panel }) => {
      if (!panel && api.panels.length === 0) {
        setActiveRoute(null);
        window.history.replaceState(null, '', '/');
      }
    });

    api.onDidLayoutChange(() => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
        } catch {
          // Private browsing and friends: tabs still work for this session.
        }
      }, SAVE_DELAY);
    });
  };

  return (
    <div className="h-full w-full">
      <DockviewReact
        components={components}
        watermarkComponent={Watermark}
        theme={dockviewTheme}
        // Hidden tabs keep their DOM: the editor, its undo history and the
        // live run output are all still there when the tab comes back.
        defaultRenderer="always"
        onReady={onReady}
      />
    </div>
  );
}

export default Workspace;
