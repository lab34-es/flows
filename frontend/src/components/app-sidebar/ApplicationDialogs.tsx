import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

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
import { applicationsApi } from '@/services/api';
import { useAppState } from '@/context/AppStateContext';
import { useWorkspace } from '@/workspace/WorkspaceContext';
import { parseRoute } from '@/workspace/routes';

/**
 * Dialogs for the application actions of the sidebar.
 * `action` is { type: 'new-application' } or { type: 'rename-application', slug }.
 *
 * Renaming an application renames its folder: steps refer to applications by
 * that name, so the dialog says as much before going ahead. Creating one
 * writes the template — a documented index.ts with example methods, its
 * README and a local environment — and opens it.
 */
export function ApplicationDialogs({ action, onClose }) {
  const { openTab, retargetTabs } = useWorkspace();
  const { refreshApplications, refreshEnvironments } = useAppState();

  const [name, setName] = useState('');
  const [error, setError] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(action?.slug || '');
    setError(null);
    setBusy(false);
  }, [action]);

  if (!action) { return null; }

  const close = () => {
    if (!busy) { onClose(); }
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) { return; }

    setBusy(true);
    setError(null);
    try {
      const response = await applicationsApi.create(trimmed);
      await refreshApplications();
      // The new application brings a local environment with it: the selector
      // must know about it when this is the first application
      await refreshEnvironments();
      onClose();
      openTab(`/applications/${encodeURIComponent(response.data.slug)}`);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
      setBusy(false);
    }
  };

  const handleRename = async () => {
    const trimmed = name.trim();
    if (!trimmed) { return; }

    if (trimmed === action.slug) {
      onClose();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await applicationsApi.rename(action.slug, trimmed);
      await refreshApplications();
      onClose();

      // Any tab on the old slug follows the application to its new one
      retargetTabs((route) => (
        parseRoute(route).pathname === `/applications/${action.slug}`
          ? `/applications/${encodeURIComponent(response.data.slug)}`
          : null
      ));
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
      setBusy(false);
    }
  };

  return (
    <>
      {/* New application */}
      <Dialog open={action.type === 'new-application'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New application</DialogTitle>
            <DialogDescription>
              Creates a folder in your applications directory with a working
              example inside: a <code>helloWorld</code> method, one reading back
              what it left in the flow memory, an HTTP call, plus its README and
              a <code>local</code> environment.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-application-name">Name</Label>
            <Input
              id="new-application-name"
              placeholder="my-api"
              value={name}
              autoFocus
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleCreate()}
            />
            <p className="text-muted-foreground text-xs">
              Flows point at applications by this name, in the
              <code className="mx-1">application:</code> line of a step.
            </p>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
            <Button onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              Create application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename application */}
      <Dialog open={action.type === 'rename-application'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename application</DialogTitle>
            <DialogDescription>
              “{action.slug}” will be renamed, folder included. Steps point at
              applications by name, so update the flows using it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="application-name">New name</Label>
            <Input
              id="application-name"
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
    </>
  );
}

export default ApplicationDialogs;
