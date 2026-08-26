import React, { useRef, useState } from 'react';
import {
  AppWindow,
  ArrowUpRight,
  FilePlus2,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Upload,
  Workflow,
} from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import FlowTree from '@/components/app-sidebar/FlowTree';
import FlowDialogs from '@/components/app-sidebar/FlowDialogs';
import ApplicationDialogs from '@/components/app-sidebar/ApplicationDialogs';
import StatusDot from '@/components/shared/StatusDot';
import { useAppState } from '@/context/AppStateContext';
import { flowsApi } from '@/services/api';
import { folderUrl } from '@/lib/flows';
import { dotStatus, runLabel, runScore, testRunUrl } from '@/lib/testRuns';
import { useActiveLocation, useWorkspace } from '@/workspace/WorkspaceContext';

// The sidebar shows the freshest runs; the Test runs page has them all
const SIDEBAR_RUNS = 10;

export function AppSidebar() {
  const { openTab } = useWorkspace();
  const location = useActiveLocation();
  const { tree, treeLoading, refreshTree, applications, applicationsLoading, testRuns } = useAppState();

  const [action, setAction] = useState<any>(null);
  const [applicationAction, setApplicationAction] = useState<any>(null);
  const uploadInputRef = useRef<any>(null);
  const uploadTargetRef = useRef('');

  const handleAction = (nextAction) => {
    if (nextAction.type === 'upload') {
      uploadTargetRef.current = nextAction.parentPath || '';
      uploadInputRef.current?.click();
      return;
    }
    setAction(nextAction);
  };

  const handleUploadFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) { return; }

    const parent = uploadTargetRef.current;
    const relativePath = parent ? `${parent}/${file.name}` : file.name;
    const content = await file.text();

    try {
      await flowsApi.saveFile(relativePath, content);
      await refreshTree();
    } catch (ex) {
      if (ex.response?.status === 409) {
        const replace = window.confirm(`“${relativePath}” already exists. Replace it?`);
        if (!replace) { return; }
        try {
          await flowsApi.saveFile(relativePath, content, true);
          await refreshTree();
        } catch (retryEx) {
          window.alert(retryEx.response?.data?.error || retryEx.message);
        }
        return;
      }
      window.alert(ex.response?.data?.error || ex.message);
    }
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => openTab('/')}>
              {/* The tool's own mark: ink panel, bone stroke, brand radius. */}
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-md">
                <Workflow className="size-4" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                {/* The open-source lockup: parent Medium 500, brass slash,
                    project Regular 400, all lowercase. */}
                <span className="truncate font-mono text-sm tracking-[-0.04em]">
                  <span className="font-medium">lab34</span>
                  <span className="text-brass">/</span>
                  <span className="font-normal">flows</span>
                </span>
                <span className="text-muted-foreground truncate text-xs">E2E flow testing</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* Anchors cannot live inside the menu button above (it is itself a
            button), so the two outbound links sit on their own row. */}
        <div className="text-muted-foreground flex items-center gap-2 px-2 text-xs group-data-[collapsible=icon]:hidden">
          <a
            href="https://flows.lab34.es"
            target="_blank"
            rel="noreferrer"
            className="hover:text-sidebar-accent-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            Website
            <ArrowUpRight className="size-3" />
          </a>
          <span aria-hidden="true" className="opacity-40">
            ·
          </span>
          <a
            href="https://lab34.es"
            target="_blank"
            rel="noreferrer"
            className="hover:text-sidebar-accent-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            lab34
            <ArrowUpRight className="size-3" />
          </a>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* ------------------------------ Flows ------------------------------ */}
        <SidebarGroup>
          {/* The label opens the whole flows directory as a table, the same
              way a folder row opens its own subtree */}
          <SidebarGroupLabel
            asChild
            className="hover:text-sidebar-accent-foreground cursor-pointer"
          >
            <button type="button" onClick={() => openTab(folderUrl(''))} title="Open all flows as a table">
              Flows
            </button>
          </SidebarGroupLabel>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarGroupAction title="Add flow, folder or upload">
                <Plus /> <span className="sr-only">Add</span>
              </SidebarGroupAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start">
              <DropdownMenuItem onClick={() => handleAction({ type: 'new-flow', parentPath: '' })}>
                <FilePlus2 /> New flow
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAction({ type: 'new-folder', parentPath: '' })}>
                <FolderPlus /> New folder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAction({ type: 'upload', parentPath: '' })}>
                <Upload /> Upload file
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => refreshTree()}>
                <RefreshCw /> Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SidebarGroupContent>
            {treeLoading ? (
              <div className="space-y-1 px-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-4/5" />
                <Skeleton className="h-6 w-3/5" />
              </div>
            ) : (
              <FlowTree tree={tree} onAction={handleAction} />
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* ---------------------------- Test runs ---------------------------- */}
        <SidebarGroup>
          {/* The label opens the full run history */}
          <SidebarGroupLabel
            asChild
            className="hover:text-sidebar-accent-foreground cursor-pointer"
          >
            <button type="button" onClick={() => openTab('/test-runs')} title="Open all test runs">
              Test runs
            </button>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {testRuns.length === 0 ? (
              <div className="text-muted-foreground px-2 py-1.5 text-xs">
                No runs yet. Run a flow — or “Run all” on a folder — and it
                will be recorded here.
              </div>
            ) : (
              <SidebarMenu>
                {testRuns.slice(0, SIDEBAR_RUNS).map((run) => (
                  <SidebarMenuItem key={run.id}>
                    <SidebarMenuButton
                      isActive={location.pathname.startsWith(testRunUrl(run.id))}
                      onClick={() => openTab(testRunUrl(run.id))}
                      title={`${runLabel(run)} · ${run.environment}${run.view ? ` · ${run.view}` : ''}`}
                    >
                      <StatusDot status={dotStatus(run.status)} />
                      <span>{runLabel(run)}</span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge>{runScore(run)}</SidebarMenuBadge>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* --------------------------- Applications -------------------------- */}
        <SidebarGroup>
          <SidebarGroupLabel>Applications</SidebarGroupLabel>
          <SidebarGroupAction
            title="New application"
            onClick={() => setApplicationAction({ type: 'new-application' })}
          >
            <Plus /> <span className="sr-only">New application</span>
          </SidebarGroupAction>
          <SidebarGroupContent>
            {applicationsLoading ? (
              <div className="space-y-1 px-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            ) : (
              <SidebarMenu>
                {applications.length === 0 && (
                  <div className="text-muted-foreground px-2 py-1.5 text-xs">
                    No applications yet.{' '}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => setApplicationAction({ type: 'new-application' })}
                    >
                      Create one
                    </button>{' '}
                    to get started.
                  </div>
                )}
                {applications.map((app) => {
                  return (
                  <SidebarMenuItem key={app.slug}>
                    <SidebarMenuButton
                      isActive={location.pathname === `/applications/${app.slug}`}
                      onClick={() => openTab(`/applications/${app.slug}`)}
                      title={app.description || app.name}
                    >
                      <AppWindow className="text-muted-foreground" />
                      <span>{app.name}</span>
                    </SidebarMenuButton>

                    {/* The badge and the actions button share the same corner:
                        hide the count while the row is being acted on */}
                    <SidebarMenuBadge className="group-hover/menu-item:hidden group-focus-within/menu-item:hidden group-has-data-[state=open]/menu-item:hidden">
                      {app.methods?.length || 0}
                    </SidebarMenuBadge>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover aria-label={`Actions for application ${app.name}`}>
                          <MoreHorizontal />
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start">
                        <DropdownMenuItem
                          onClick={() => setApplicationAction({ type: 'rename-application', slug: app.slug })}
                        >
                          <Pencil /> Rename application
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />

      {/* Hidden input backing the "Upload file" actions */}
      <input
        ref={uploadInputRef}
        type="file"
        accept=".md,.markdown"
        className="hidden"
        onChange={handleUploadFile}
      />

      <FlowDialogs action={action} onClose={() => setAction(null)} />
      <ApplicationDialogs
        action={applicationAction}
        onClose={() => setApplicationAction(null)}
      />
    </Sidebar>
  );
}

export default AppSidebar;
