import React from 'react';

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import AppSidebar from '@/components/app-sidebar/AppSidebar';
import TopBar from '@/components/shared/TopBar';
import Workspace from '@/workspace/Workspace';
import { WorkspaceProvider } from '@/workspace/WorkspaceContext';
import { AppStateProvider } from '@/context/AppStateContext';
import { ExecutionProvider } from '@/context/ExecutionContext';
import { ThemeProvider } from '@/context/ThemeContext';

/* The content area is a tabbed workspace: whatever the sidebar opens — a
   flow, a folder, a run, an application — lands in a tab, and each tab runs
   the app's routes in a router of its own (see workspace/RoutePanel). */
function Shell() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <TopBar />
        <div className="min-h-0 flex-1">
          <Workspace />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppStateProvider>
        <ExecutionProvider>
          <WorkspaceProvider>
            <Shell />
          </WorkspaceProvider>
        </ExecutionProvider>
      </AppStateProvider>
    </ThemeProvider>
  );
}

export default App;
