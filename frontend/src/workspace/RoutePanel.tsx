import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type { DockviewPanelApi, IDockviewPanelProps } from 'dockview-react';

import AppRoutes from '@/workspace/AppRoutes';
import { titleForRoute } from '@/workspace/routes';
import { useWorkspace } from '@/workspace/WorkspaceContext';

const PanelApiContext = createContext<DockviewPanelApi | null>(null);

/**
 * Pages with a better name than their URL — a flow's document title, a test
 * run's date — put it on their tab with this. Outside a tab it does nothing.
 */
export function useTabTitle(title?: string | null) {
  const api = useContext(PanelApiContext);
  useEffect(() => {
    if (api && title) { api.setTitle(title); }
  }, [api, title]);
}

/**
 * Keeps a tab's router and its Dockview panel telling the same story, in
 * both directions: navigating inside the tab updates the panel's params
 * (which is what the saved layout remembers) and its title; the workspace
 * updating the params (openTab into this tab, a rename) navigates the tab.
 */
function PanelBridge({ api, paramsRoute }: { api: DockviewPanelApi; paramsRoute: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { setActiveRoute } = useWorkspace();

  const route = location.pathname + location.search;
  const routeRef = useRef(route);

  // The route both sides already agree on: stops the two effects below from
  // answering each other forever.
  const synced = useRef(paramsRoute);

  useEffect(() => {
    routeRef.current = route;
    if (synced.current !== route) {
      synced.current = route;
      api.updateParameters({ route });
    }
    api.setTitle(titleForRoute(route));
    if (api.isActive) { setActiveRoute(route); }
  }, [api, route, setActiveRoute]);

  useEffect(() => {
    if (paramsRoute && paramsRoute !== synced.current) {
      synced.current = paramsRoute;
      navigate(paramsRoute, { replace: true });
    }
  }, [paramsRoute, navigate]);

  // Focus change: the newly active tab tells the workspace what it shows.
  useEffect(() => {
    const disposable = api.onDidActiveChange(({ isActive }) => {
      if (isActive) { setActiveRoute(routeRef.current); }
    });
    return () => disposable.dispose();
  }, [api, setActiveRoute]);

  return null;
}

/**
 * The single Dockview panel type of the workspace: a tab is a route with its
 * own router, so any page of the app can live in any tab, and navigation
 * inside the tab (a run opened from the runs table, a settings section)
 * stays inside the tab.
 */
export function RoutePanel({ api, params }: IDockviewPanelProps<{ route: string }>) {
  const [initialRoute] = useState(params.route || '/');

  return (
    <PanelApiContext.Provider value={api}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <PanelBridge api={api} paramsRoute={params.route} />
        <div className="bg-background flex h-full min-h-0 flex-col overflow-auto">
          <AppRoutes />
        </div>
      </MemoryRouter>
    </PanelApiContext.Provider>
  );
}

export default RoutePanel;
