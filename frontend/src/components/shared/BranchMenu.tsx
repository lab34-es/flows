import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Cloud,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppState } from '@/context/AppStateContext';
import { contextApi } from '@/services/api';
import { trackingLabel } from '@/lib/git';
import { cn } from '@/lib/utils';

/**
 * The branch the context directory is on, and the way to be on another one.
 *
 * Flows and applications are files in a repository, so which branch is
 * checked out decides which flows exist -- switching is a normal part of
 * working here, not a detour to a terminal. The menu lists the local
 * branches; the ones a fetch has found on a remote but nobody has checked
 * out yet come after them, and picking one creates the local branch that
 * tracks it.
 */
export function BranchMenu() {
  const { contextInfo, refreshContext, refreshTree, refreshApplications } = useAppState();
  const git = contextInfo?.git;

  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  /** What is running: a branch name, 'fetch', or '' */
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<any>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  // A menu that closes takes focus back with it, and it does so after the
  // dialog it opened has mounted -- which leaves the name field unfocused and
  // Enter doing nothing. So the dialog waits for the menu to have finished
  // closing, and only then opens.
  const opensDialog = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await contextApi.branches();
      setBranches(response.data || null);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // The list is only ever read while the menu is open, and it goes stale the
  // moment anyone commits or fetches -- so it is read when the menu opens
  useEffect(() => {
    if (!open) { return; }
    setError(null);
    load();
  }, [open, load]);

  /**
   * Everything a checkout can move: the files on disk, and therefore the
   * flows tree, the applications and the git status the rest of the UI draws.
   */
  const refreshEverything = () =>
    Promise.all([refreshContext(), refreshTree(), refreshApplications()]);

  const switchTo = async (branch) => {
    setBusy(branch);
    setError(null);
    try {
      await contextApi.checkout(branch);
      await refreshEverything();
      setOpen(false);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
      await load();
    } finally {
      setBusy('');
    }
  };

  const fetchAll = async () => {
    setBusy('fetch');
    setError(null);
    try {
      await contextApi.fetch();
      await Promise.all([load(), refreshContext()]);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    } finally {
      setBusy('');
    }
  };

  const create = async () => {
    const branch = name.trim();
    if (!branch) { return; }

    setBusy('create');
    setError(null);
    try {
      await contextApi.checkout(branch, { create: true });
      await refreshEverything();
      setCreating(false);
      setName('');
      setOpen(false);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    } finally {
      setBusy('');
    }
  };

  if (!git) { return null; }

  const local = branches?.local || [];
  const remote = branches?.remote || [];
  const current = branches?.current ?? git.branch;

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hidden min-w-0 gap-1 px-1.5 font-mono text-xs font-normal sm:inline-flex"
            title={trackingLabel(git)}
          >
            <GitBranch className="size-3" />
            <span className="max-w-40 truncate">{git.branch}</span>
            {git.behind > 0 && (
              <span className="text-info inline-flex items-center">
                <ArrowDown className="size-3" />{git.behind}
              </span>
            )}
            {git.ahead > 0 && (
              <span className="text-warning inline-flex items-center">
                <ArrowUp className="size-3" />{git.ahead}
              </span>
            )}
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="max-h-96 w-72"
          onCloseAutoFocus={(event) => {
            if (!opensDialog.current) { return; }
            opensDialog.current = false;
            event.preventDefault();
            setCreating(true);
          }}
        >
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span>Branches</span>
            {loading && <Loader2 className="text-muted-foreground size-3 animate-spin" />}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {git.detached && (
            <div className="text-muted-foreground px-2 py-1.5 text-xs">
              HEAD is detached at {git.branch}. Pick a branch to get back on one.
            </div>
          )}

          {local.map((branch) => (
            <DropdownMenuItem
              key={branch.name}
              onSelect={(event) => {
                event.preventDefault();
                if (branch.name !== current) { switchTo(branch.name); }
              }}
              disabled={Boolean(busy)}
            >
              {busy === branch.name
                ? <Loader2 className="size-3.5 animate-spin" />
                : <Check className={cn('size-3.5', branch.name === current ? '' : 'opacity-0')} />}
              <span className="truncate font-mono text-xs">{branch.name}</span>
              {branch.upstream && (
                <span
                  className="text-muted-foreground ml-auto truncate text-[10px]"
                  title={`Tracks ${branch.upstream}`}
                >
                  {branch.upstream}
                </span>
              )}
            </DropdownMenuItem>
          ))}

          {!loading && !local.length && (
            <div className="text-muted-foreground px-2 py-1.5 text-xs">
              No branches yet -- this repository has no commits.
            </div>
          )}

          {remote.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-[10px] font-normal uppercase">
                On remotes only
              </DropdownMenuLabel>
              {remote.map((branch) => (
                <DropdownMenuItem
                  key={branch.name}
                  onSelect={(event) => {
                    event.preventDefault();
                    switchTo(branch.name);
                  }}
                  disabled={Boolean(busy)}
                  title={`Check out ${branch.local}, tracking ${branch.name}`}
                >
                  {busy === branch.name
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <Cloud className="size-3.5" />}
                  <span className="truncate font-mono text-xs">{branch.local}</span>
                  <span className="text-muted-foreground ml-auto truncate text-[10px]">
                    {branch.remote}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              opensDialog.current = true;
              setName('');
              setError(null);
              setOpen(false);
            }}
            disabled={Boolean(busy)}
          >
            <Plus className="size-3.5" />
            <span className="text-xs">Create branch...</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              fetchAll();
            }}
            disabled={Boolean(busy) || !git.remote}
            title={git.remote
              ? 'git fetch --all'
              : 'This repository has no remote to fetch from'}
          >
            {busy === 'fetch'
              ? <Loader2 className="size-3.5 animate-spin" />
              : <RefreshCw className="size-3.5" />}
            <span className="text-xs">Fetch all</span>
          </DropdownMenuItem>

          {error && (
            <p className="text-destructive px-2 py-1.5 text-xs break-words">{error}</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* --------------------- Create branch --------------------- */}
      <Dialog open={creating} onOpenChange={(value) => !busy && setCreating(value)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create branch</DialogTitle>
            <DialogDescription>
              Starts from <span className="font-mono">{current || 'HEAD'}</span> and switches
              to the new branch. Nothing is pushed until you do.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="branch-name">Branch name</Label>
            <Input
              id="branch-name"
              placeholder="feature/checkout-tests"
              value={name}
              autoFocus
              className="font-mono"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && create()}
            />
            {error && <p className="text-destructive text-xs break-words">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={Boolean(busy)}>
              Cancel
            </Button>
            <Button onClick={create} disabled={Boolean(busy) || !name.trim()}>
              {busy === 'create' ? <Loader2 className="animate-spin" /> : <GitBranch />}
              Create branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default BranchMenu;
