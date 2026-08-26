import React, { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { flowsApi, settingsApi } from '@/services/api';
import { newFlowTemplate } from '@/lib/templates';
import { folderUrl } from '@/lib/flows';
import { useAppState } from '@/context/AppStateContext';
import { useWorkspace } from '@/workspace/WorkspaceContext';
import { parseRoute } from '@/workspace/routes';

const joinPath = (parent, name) => (parent ? `${parent}/${name}` : name);

const parentOf = (relativePath) =>
  (relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '');

const baseNameOf = (relativePath) => relativePath.split('/').pop();

const FLOW_EXTENSION = /\.(md|markdown)$/i;

/**
 * Dialogs for the sidebar file actions: new flow, new folder, rename and
 * delete. `action` is
 * { type: 'new-flow' | 'new-folder' | 'rename' | 'delete', parentPath?, targetPath?, isFolder? }.
 *
 * When "Create using AI" is on, the flow file is created first (with the
 * usual template) and a second dialog then asks what it should test: that
 * way the file already exists — and is reachable — whatever happens next.
 */
export function FlowDialogs({ action, onClose }) {
  const { openTab, retargetTabs, closeTabs } = useWorkspace();
  const { refreshTree } = useAppState();
  const [name, setName] = useState('');
  const [error, setError] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const [useAI, setUseAI] = useState(false);
  const [aiSettings, setAiSettings] = useState<any>(null);
  // The flow created by the "new flow" dialog, waiting for its prompt
  const [aiTarget, setAiTarget] = useState<any>(null);
  const [aiPrompt, setAiPrompt] = useState('');

  useEffect(() => {
    // Renaming starts from the current name, so only the part being changed
    // has to be typed
    setName(action?.type === 'rename' ? baseNameOf(action.targetPath) : '');
    setError(null);
    setBusy(false);
    setUseAI(false);
    setAiTarget(null);
    setAiPrompt('');
  }, [action]);

  // Load the AI settings the first time the toggle is switched on, so the
  // dialog can say upfront when no provider is configured yet
  useEffect(() => {
    if (!useAI || aiSettings) { return; }
    let cancelled = false;
    settingsApi.getAI()
      .then((response) => !cancelled && setAiSettings(response.data))
      .catch(() => !cancelled && setAiSettings({ ready: false }));
    return () => { cancelled = true; };
  }, [useAI, aiSettings]);

  if (!action) { return null; }

  const close = () => {
    if (!busy) { onClose(); }
  };

  const openFlow = (path) => {
    onClose();
    openTab(`/flows/view?path=${encodeURIComponent(path)}`);
  };

  const handleCreateFlow = async () => {
    const trimmed = name.trim();
    if (!trimmed) { return; }

    const hasExtension = /\.(md|markdown)$/i.test(trimmed);
    const fileName = hasExtension ? trimmed : `${trimmed}.md`;
    const title = fileName.replace(/\.(md|markdown)$/i, '');
    const relativePath = joinPath(action.parentPath, fileName);

    setBusy(true);
    setError(null);
    try {
      const response = await flowsApi.saveFile(relativePath, newFlowTemplate(title));
      await refreshTree();

      if (useAI) {
        setBusy(false);
        setAiTarget({ relativePath, path: response.data.path });
        return;
      }

      openFlow(response.data.path);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || !aiTarget) { return; }

    setBusy(true);
    setError(null);
    try {
      const generated = await flowsApi.createAI(prompt);
      await flowsApi.saveFile(aiTarget.relativePath, generated.data.flow, true);
      await refreshTree();
      openFlow(aiTarget.path);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
      setBusy(false);
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = name.trim();
    if (!trimmed) { return; }

    setBusy(true);
    setError(null);
    try {
      await flowsApi.createFolder(joinPath(action.parentPath, trimmed));
      await refreshTree();
      onClose();
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
      setBusy(false);
    }
  };

  const handleRename = async () => {
    const trimmed = name.trim();
    if (!trimmed) { return; }

    const from = action.targetPath;
    // Flows keep their extension unless the new name states another one
    const fileName = action.isFolder || FLOW_EXTENSION.test(trimmed)
      ? trimmed
      : `${trimmed}${(from.match(FLOW_EXTENSION) || ['.md'])[0]}`;
    const to = joinPath(parentOf(from), fileName);

    if (to === from) {
      onClose();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await flowsApi.rename(from, to);
      await refreshTree();
      onClose();

      // Follow the rename in every tab showing the flow (or a flow inside
      // the renamed folder, or the folder's own table), so no tab is left
      // pointing at a path that no longer exists
      retargetTabs((route) => {
        const { pathname, searchParams } = parseRoute(route);

        if (pathname === '/flows/view') {
          const openPath = searchParams.get('path') || '';
          if (!action.isFolder && openPath.endsWith(`/${from}`)) {
            return `/flows/view?path=${encodeURIComponent(response.data.path)}`;
          }
          if (action.isFolder && openPath.includes(`/${from}/`)) {
            return `/flows/view?path=${encodeURIComponent(openPath.replace(`/${from}/`, `/${to}/`))}`;
          }
        }

        if (pathname === '/flows/folder' && action.isFolder) {
          const rel = searchParams.get('path') || '';
          if (rel === from || rel.startsWith(`${from}/`)) {
            return folderUrl(`${to}${rel.slice(from.length)}`);
          }
        }

        return null;
      });
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await flowsApi.remove(action.targetPath);
      await refreshTree();
      onClose();

      // Any tab showing the deleted flow — or anything from inside a
      // deleted folder — closes with it
      closeTabs((route) => {
        const { pathname, searchParams } = parseRoute(route);
        const suffix = `/${action.targetPath}`;

        if (pathname === '/flows/view') {
          const openPath = searchParams.get('path') || '';
          return openPath.endsWith(suffix) || openPath.includes(`${suffix}/`);
        }

        if (pathname === '/flows/folder' && action.isFolder) {
          const rel = searchParams.get('path') || '';
          return rel === action.targetPath || rel.startsWith(`${action.targetPath}/`);
        }

        return false;
      });
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
      setBusy(false);
    }
  };

  const inFolder = action.parentPath ? ` in “${action.parentPath}”` : '';
  const aiUnavailable = useAI && aiSettings && aiSettings.ready === false;

  return (
    <>
      {/* New flow */}
      <Dialog
        open={action.type === 'new-flow' && !aiTarget}
        onOpenChange={(open) => !open && close()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New flow</DialogTitle>
            <DialogDescription>
              Create a new Markdown flow{inFolder}. Steps are ```step code blocks.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="flow-name">File name</Label>
              <Input
                id="flow-name"
                placeholder="my-flow.md"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleCreateFlow()}
              />
            </div>

            <div className="flex items-start gap-3 rounded-md border p-3">
              <Switch
                id="flow-use-ai"
                checked={useAI}
                onCheckedChange={setUseAI}
                aria-label="Create using AI"
              />
              <div className="grid gap-1">
                <Label htmlFor="flow-use-ai" className="cursor-pointer">
                  <Sparkles className="size-3.5" /> Create using AI
                </Label>
                <p className="text-muted-foreground text-xs">
                  Describe the scenario after creating the file and the flow will be
                  written for you, using your applications.
                </p>
                {aiUnavailable && (
                  <p className="text-destructive text-xs">
                    No AI provider is configured yet.{' '}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => { onClose(); openTab('/settings'); }}
                    >
                      Open settings
                    </button>
                  </p>
                )}
              </div>
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreateFlow} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              {useAI ? 'Create and describe' : 'Create flow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Describe the flow to generate */}
      <Dialog open={Boolean(aiTarget)} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4" /> What should this flow test?
            </DialogTitle>
            <DialogDescription>
              “{aiTarget?.relativePath}” was created. Describe the scenario in plain
              words — the steps are written against your applications.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="flow-ai-prompt">Prompt</Label>
            <Textarea
              id="flow-ai-prompt"
              rows={6}
              autoFocus
              placeholder="Create a post on jsonplaceholder with a random title, check it comes back with a 201, and then fetch a post that does not exist."
              value={aiPrompt}
              disabled={busy}
              onChange={(event) => setAiPrompt(event.target.value)}
            />
            {busy && (
              <p className="text-muted-foreground text-xs">
                Writing the flow… this can take up to a couple of minutes.
              </p>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => openFlow(aiTarget.path)}
            >
              Skip
            </Button>
            <Button onClick={handleGenerate} disabled={busy || !aiPrompt.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {busy ? 'Generating…' : 'Generate flow'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New folder */}
      <Dialog open={action.type === 'new-folder'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>Create a folder{inFolder} to organize your flows.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              id="folder-name"
              placeholder="my-team"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleCreateFolder()}
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreateFolder} disabled={busy || !name.trim()}>Create folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={action.type === 'rename'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {action.isFolder ? 'folder' : 'flow'}</DialogTitle>
            <DialogDescription>
              “{action.targetPath}” will be renamed
              {action.isFolder ? ', together with everything inside it' : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="rename-name">New name</Label>
            <Input
              id="rename-name"
              value={name}
              autoFocus
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleRename()}
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={handleRename} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={action.type === 'delete'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {action.isFolder ? 'folder' : 'flow'}</DialogTitle>
            <DialogDescription>
              “{action.targetPath}” will be permanently deleted
              {action.isFolder ? ', including everything inside it' : ''}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={busy}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default FlowDialogs;
