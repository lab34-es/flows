import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, FilePlus2, Layers, Minus, Plus, TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { environmentApi } from '@/services/api';
import { useAppState } from '@/context/AppStateContext';

/** Where a cell's env file is edited: the app's Source view, file selected. */
const envFileUrl = (slug, environment) =>
  `/applications/${encodeURIComponent(slug)}?view=source&file=${encodeURIComponent(`env/${environment}.env`)}`;

/**
 * One cell of the matrix: the state of `application` × `environment`, linking
 * to the env file in the Source view — also when it does not exist yet, so
 * the editor opens ready to create it (prefilled from its template, if any).
 */
function EnvCell({ application, environment }) {
  const cell = application.environments[environment];
  if (!cell) { return null; }

  let icon;
  let label;
  if (cell.exists && cell.missingKeys.length === 0) {
    icon = <Check className="text-success size-4" />;
    label = `${cell.file} exists`;
  } else if (cell.exists) {
    icon = <TriangleAlert className="text-warning size-4" />;
    label = `${cell.file} is missing ${cell.missingKeys.length} variable${cell.missingKeys.length > 1 ? 's' : ''} of its template: ${cell.missingKeys.join(', ')}`;
  } else if (cell.hasTemplate) {
    icon = <FilePlus2 className="text-warning size-4" />;
    label = `${cell.file} is missing — open to create it from ${cell.template}`;
  } else {
    icon = <Minus className="text-muted-foreground size-4" />;
    label = `${cell.file} is missing and has no template — open to create it`;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={envFileUrl(application.slug, environment)}
          aria-label={`${application.name}: ${label}`}
          className="hover:bg-muted inline-flex size-7 items-center justify-center rounded-md"
        >
          {icon}
        </Link>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Home page card summarizing the env files of every application against
 * every known environment. A flow only runs on an environment when each
 * application it uses has its env/<environment>.env — with many applications
 * that is a lot of files to create by hand, so this card shows what is
 * missing and creates it: from the committed .env.example templates, or for
 * a whole new environment at once.
 */
export function EnvironmentsCard() {
  const { refreshEnvironments, refreshApplications } = useAppState();

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [creating, setCreating] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [baseEnv, setBaseEnv] = useState('none');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<any>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await environmentApi.getStatus();
      setStatus(response.data);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Whatever wrote env files also changed the selector and the applications
  const refreshAfterWrite = useCallback(() => {
    fetchStatus();
    refreshEnvironments();
    refreshApplications();
  }, [fetchStatus, refreshEnvironments, refreshApplications]);

  const handleCreateMissing = async () => {
    setCreating(true);
    setError(null);
    try {
      await environmentApi.createMissing();
      refreshAfterWrite();
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    } finally {
      setCreating(false);
    }
  };

  const handleAdd = async (event) => {
    event.preventDefault();
    setAdding(true);
    setAddError(null);
    try {
      await environmentApi.add(newName, baseEnv === 'none' ? undefined : baseEnv);
      setAddOpen(false);
      setNewName('');
      setBaseEnv('none');
      refreshAfterWrite();
    } catch (ex) {
      setAddError(ex.response?.data?.error || ex.message);
    } finally {
      setAdding(false);
    }
  };

  const environments = status?.environments || [];
  const applications = status?.applications || [];
  const summary = status?.summary;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none">
            <CardTitle className="flex items-center gap-2 text-base">
              <ChevronDown className={`text-muted-foreground size-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
              <Layers className="text-muted-foreground size-4" /> Environments
              <Badge variant="secondary">{environments.length}</Badge>
              {summary && summary.missing > 0 && (
                <Badge variant="warning">{summary.missing} file{summary.missing > 1 ? 's' : ''} missing</Badge>
              )}
              {summary && summary.missing === 0 && summary.incomplete > 0 && (
                <Badge variant="warning">{summary.incomplete} incomplete</Badge>
              )}
              {summary && summary.total > 0 && summary.missing === 0 && summary.incomplete === 0 && (
                <Badge variant="success">all set</Badge>
              )}
            </CardTitle>
            <CardDescription className="pl-6">
              A flow runs on an environment only when every application it uses has its{' '}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">env/&lt;environment&gt;.env</code> file.
              Those files hold secrets and stay out of git — commit{' '}
              <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">env/&lt;environment&gt;.env.example</code>{' '}
              templates instead, and create the missing files from them here.
            </CardDescription>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Something went wrong</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {applications.length === 0 ? (
              <p className="text-muted-foreground text-sm">No applications found yet.</p>
            ) : environments.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No environments declared yet. Add one below, or create an{' '}
                <span className="font-mono">env/&lt;name&gt;.env</span> file in any application.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/60 text-left">
                      <th className="px-3 py-2 font-semibold">Application</th>
                      {environments.map((environment) => (
                        <th key={environment} className="px-3 py-2 text-center font-mono text-xs font-semibold">
                          {environment}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {applications.map((application) => (
                      <tr key={application.slug} className="border-t">
                        <td className="px-3 py-1.5">
                          <Link
                            to={`/applications/${encodeURIComponent(application.slug)}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {application.name}
                          </Link>
                        </td>
                        {environments.map((environment) => (
                          <td key={environment} className="px-3 py-1.5 text-center">
                            <EnvCell application={application} environment={environment} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {summary && summary.creatable > 0 && (
                <Button size="sm" onClick={handleCreateMissing} disabled={creating}>
                  <FilePlus2 />
                  {creating
                    ? 'Creating…'
                    : `Create ${summary.creatable} missing file${summary.creatable > 1 ? 's' : ''} from templates`}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus /> Add environment to every application
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      <Dialog open={addOpen} onOpenChange={(value) => { setAddOpen(value); setAddError(null); }}>
        <DialogContent>
          <form onSubmit={handleAdd} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add an environment</DialogTitle>
              <DialogDescription>
                Creates <span className="font-mono">env/&lt;name&gt;.env</span> in every application that
                does not have it yet — from the application's own template when one exists, otherwise
                from the variable names of the environment you pick below.
              </DialogDescription>
            </DialogHeader>

            {addError && (
              <Alert variant="destructive">
                <AlertDescription>{addError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="new-environment-name">Name</Label>
              <Input
                id="new-environment-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="production"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-environment-base">Copy variable names from</Label>
              <Select value={baseEnv} onValueChange={setBaseEnv}>
                <SelectTrigger id="new-environment-base" className="w-full" aria-label="Base environment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nothing — start empty</SelectItem>
                  {environments.map((environment) => (
                    <SelectItem key={environment} value={environment}>{environment}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Values are left blank either way: fill in each application's secrets afterwards.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={adding || !newName.trim()}>
                {adding ? 'Creating…' : 'Create files'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default EnvironmentsCard;
