import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DockviewApi } from 'dockview-react';

import { parseRoute, tabKeyForRoute, titleForRoute } from '@/workspace/routes';

const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2));

const WorkspaceContext = createContext<any>(null);

/**
 * The tabs of the app. Everything that used to navigate the router now goes
 * through here: openTab either focuses the tab already showing a route or
 * adds a new one, and the sidebar reads activeRoute to know what to
 * highlight. The Dockview api itself is registered by the Workspace once the
 * dock is ready.
 */
export function WorkspaceProvider({ children }) {
  const apiRef = useRef<DockviewApi | null>(null);
  const [activeRoute, setActiveRoute] = useState<string | null>(null);

  // The browser URL mirrors the active tab, so refreshing — or sharing the
  // address — keeps working even though tabs, not the router, own the screen.
  // While no tab has reported yet (during startup) the URL is left alone:
  // it may still hold a deep link the workspace is about to open.
  useEffect(() => {
    if (!activeRoute) { return; }
    const current = window.location.pathname + window.location.search;
    if (current !== activeRoute) {
      window.history.replaceState(null, '', activeRoute);
    }
  }, [activeRoute]);

  const registerApi = useCallback((api: DockviewApi) => {
    apiRef.current = api;
  }, []);

  const openTab = useCallback((route: string) => {
    const api = apiRef.current;
    if (!api) { return; }

    const key = tabKeyForRoute(route);
    const existing = api.panels.find(
      (panel) => panel.params?.route && tabKeyForRoute(panel.params.route) === key
    );

    if (existing) {
      // Same tab, possibly another route inside it (a settings section, the
      // run behind one of its flows): the panel's bridge follows the params.
      if (existing.params?.route !== route) {
        existing.api.updateParameters({ route });
      }
      existing.api.setActive();
      return;
    }

    api.addPanel({
      id: `tab-${uid()}`,
      component: 'page',
      params: { route },
      title: titleForRoute(route),
    });
  }, []);

  // Rename-style updates: every open tab gets the chance to point somewhere
  // new. `map` returns the new route, or nothing to leave the tab alone.
  const retargetTabs = useCallback((map: (route: string) => string | null | undefined) => {
    const api = apiRef.current;
    if (!api) { return; }
    for (const panel of api.panels) {
      const route = panel.params?.route;
      if (!route) { continue; }
      const next = map(route);
      if (next && next !== route) {
        panel.api.updateParameters({ route: next });
      }
    }
  }, []);

  const closeTabs = useCallback((match: (route: string) => boolean) => {
    const api = apiRef.current;
    if (!api) { return; }
    for (const panel of [...api.panels]) {
      const route = panel.params?.route;
      if (route && match(route)) { panel.api.close(); }
    }
  }, []);

  const value = useMemo(
    () => ({ registerApi, openTab, retargetTabs, closeTabs, activeRoute, setActiveRoute }),
    [registerApi, openTab, retargetTabs, closeTabs, activeRoute]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}

/**
 * The active tab's location, in the { pathname, searchParams } shape the
 * sidebar used to read from the router to know which row to highlight.
 */
export function useActiveLocation() {
  const { activeRoute } = useWorkspace();
  return useMemo(() => parseRoute(activeRoute), [activeRoute]);
}
