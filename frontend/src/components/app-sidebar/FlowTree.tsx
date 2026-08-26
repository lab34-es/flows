import React from 'react';
import {
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  FilePlus2,
  Pencil,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react';

import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuSub,
} from '@/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import StatusDot from '@/components/shared/StatusDot';
import { useExecutions } from '@/context/ExecutionContext';
import { flowUrl, folderUrl } from '@/lib/flows';
import { useActiveLocation, useWorkspace } from '@/workspace/WorkspaceContext';
import { cn } from '@/lib/utils';

function FolderNode({ node, onAction, children }) {
  const { openTab } = useWorkspace();
  const location = useActiveLocation();
  // folders start collapsed: the tree opens as a short list of top-level
  // folders instead of every flow in the repository at once
  const [open, setOpen] = React.useState(false);

  const isActive = location.pathname === '/flows/folder' &&
    location.searchParams.get('path') === node.relativePath;

  return (
    <SidebarMenuItem>
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* The chevron expands the folder in place; the name opens it as a
            table. Two separate buttons, so neither steals the other's click */}
        <div className="flex items-center">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="hover:bg-sidebar-accent flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm"
              aria-label={`${open ? 'Collapse' : 'Expand'} folder ${node.name}`}
            >
              <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
            </button>
          </CollapsibleTrigger>

          <SidebarMenuButton
            isActive={isActive}
            onClick={() => openTab(folderUrl(node.relativePath))}
            title={`Open ${node.relativePath} as a table`}
          >
            <Folder className="text-muted-foreground" />
            <span>{node.name}</span>
          </SidebarMenuButton>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover aria-label={`Actions for folder ${node.name}`}>
              <MoreHorizontal />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem onClick={() => openTab(folderUrl(node.relativePath))}>
              <Table2 /> Open as table
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAction({ type: 'new-flow', parentPath: node.relativePath })}>
              <FilePlus2 /> New flow
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction({ type: 'new-folder', parentPath: node.relativePath })}>
              <FolderPlus /> New folder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction({ type: 'upload', parentPath: node.relativePath })}>
              <Upload /> Upload file
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAction({ type: 'rename', targetPath: node.relativePath, isFolder: true })}>
              <Pencil /> Rename folder
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onAction({ type: 'delete', targetPath: node.relativePath, isFolder: true })}
            >
              <Trash2 /> Delete folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <CollapsibleContent>
          <SidebarMenuSub className="mr-0 pr-0">{children}</SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

function FlowNode({ node, onAction }) {
  const { openTab } = useWorkspace();
  const location = useActiveLocation();
  const { statusFor } = useExecutions();

  const url = flowUrl(node);
  const isActive = location.pathname === '/flows/view' &&
    location.searchParams.get('path') === node.path;

  const status = statusFor(node.path);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={() => openTab(url)}
        title={node.relativePath}
      >
        <StatusDot status={status} />
        <FileText className="text-muted-foreground" />
        <span>{node.title || node.name}</span>
      </SidebarMenuButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label={`Actions for flow ${node.name}`}>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem
            onClick={() => onAction({ type: 'rename', targetPath: node.relativePath, isFolder: false })}
          >
            <Pencil /> Rename flow
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onAction({ type: 'delete', targetPath: node.relativePath, isFolder: false })}
          >
            <Trash2 /> Delete flow
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function TreeNodes({ nodes, onAction }) {
  return nodes.map((node) => {
    if (node.type === 'folder') {
      return (
        <FolderNode key={node.relativePath} node={node} onAction={onAction}>
          <TreeNodes nodes={node.children || []} onAction={onAction} />
        </FolderNode>
      );
    }
    return <FlowNode key={node.relativePath} node={node} onAction={onAction} />;
  });
}

export function FlowTree({ tree, onAction }) {
  if (!tree.length) {
    return (
      <div className="text-muted-foreground px-2 py-1.5 text-xs">
        No flows yet. Create one with the + button.
      </div>
    );
  }

  return (
    <SidebarMenu>
      <TreeNodes nodes={tree} onAction={onAction} />
    </SidebarMenu>
  );
}

export default FlowTree;
