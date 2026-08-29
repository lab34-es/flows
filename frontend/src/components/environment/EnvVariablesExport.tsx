import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Copy, Download, KeyRound, Loader2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { environmentApi } from '@/services/api';

/**
 * One variable's place in the tree, and the id its checkbox is ticked by.
 * Application and environment names are path segments and a variable name is
 * an identifier, so none of the three can carry the separator.
 */
const idOf = (application, environment, key) => `${application} ${environment} ${key}`;

const idsOfEnvironment = (application, environment) =>
  environment.variables.map((variable) => idOf(application.slug, environment.name, variable.key));

const idsOfApplication = (application) =>
  application.environments.flatMap((environment) => idsOfEnvironment(application, environment));

/**
 * The state of a parent checkbox: on when every variable under it is ticked,
 * indeterminate when only some are.
 */
const stateOf = (ids, selected) => {
  const ticked = ids.filter((id) => selected.has(id)).length;
  if (!ticked) { return false; }
  return ticked === ids.length ? true : 'indeterminate';
};

/** Group the ticked ids back into what the export endpoint takes. */
const selectionOf = (selected) => {
  const byFile = new Map<string, { application: string, environment: string, keys: string[] }>();

  selected.forEach((id) => {
    const [application, environment, key] = id.split(' ');
    const fileKey = `${application} ${environment}`;
    if (!byFile.has(fileKey)) { byFile.set(fileKey, { application, environment, keys: [] }); }
    byFile.get(fileKey)!.keys.push(key);
  });

  return [...byFile.values()];
};

/**
 * Picking what to send: application, then environment, then variable, each
 * level with its own checkbox, and the document itself in a modal to copy out
 * of.
 *
 * The tree carries names only. The values are read when the export is asked
 * for, so what travels is what the files hold at that moment rather than what
 * they held when the card was opened.
 */
export function EnvVariablesExport({ revision = 0 }: { revision?: number }) {
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const [selected, setSelected] = useState(() => new Set<string>());
  const [expanded, setExpanded] = useState(() => new Set<string>());

  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    environmentApi.variables()
      .then((response) => {
        if (cancelled) { return; }

        const list = response.data.applications || [];
        setApplications(list);

        // A refresh can take a variable away -- an env file edited elsewhere,
        // an application deleted. Ticks for what is gone would be counted and
        // never exported, so they go with it.
        const alive = new Set(list.flatMap((application) => idsOfApplication(application)));
        setSelected((current) => new Set([...current].filter((id) => alive.has(id))));
      })
      .catch((ex) => {
        if (cancelled) { return; }
        setError(ex.response?.data?.error || ex.message);
      })
      .finally(() => { if (!cancelled) { setLoading(false); } });

    return () => { cancelled = true; };
    // Read again whenever the applications are: an import a moment ago may
    // have created the very env file this tree should be offering
  }, [revision]);

  // The tick on the copy button is a receipt, not a state
  useEffect(() => {
    if (!copied) { return undefined; }
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const everyId = useMemo(
    () => applications.flatMap((application) => idsOfApplication(application)),
    [applications]
  );

  const tick = useCallback((ids, on) => {
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }, []);

  const toggleOpen = useCallback((id) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await environmentApi.exportVariables(selectionOf(selected));
      setExported(response.data);
      setCopied(false);
      setCopyFailed(false);
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    } finally {
      setExporting(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported.yaml);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // A browser that refuses the clipboard still lets the text be selected
      setCopied(false);
      setCopyFailed(true);
    }
  };

  if (loading) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
        <Loader2 className="size-4 animate-spin" /> Reading the env files…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {applications.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No env file carries a variable yet, so there is nothing to export.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button size="sm" variant="ghost" onClick={() => tick(everyId, true)}>Select all</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <span className="text-muted-foreground text-xs">
              {selected.size} of {everyId.length} variable{everyId.length === 1 ? '' : 's'} selected
            </span>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-lg border">
            {applications.map((application) => {
              const applicationIds = idsOfApplication(application);
              const open = expanded.has(application.slug);

              return (
                <div key={application.slug} className="border-b last:border-b-0">
                  <div className="hover:bg-muted/50 flex items-center gap-2 px-3 py-2">
                    <Checkbox
                      checked={stateOf(applicationIds, selected)}
                      onCheckedChange={(on) => tick(applicationIds, on)}
                      aria-label={`Export every variable of ${application.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => toggleOpen(application.slug)}
                      className="flex flex-1 cursor-pointer items-center gap-2 text-left text-sm"
                      aria-expanded={open}
                    >
                      <ChevronRight className={`text-muted-foreground size-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                      <span className="font-medium">{application.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {application.environments.length} environment{application.environments.length === 1 ? '' : 's'}
                        {' · '}
                        {applicationIds.length} variable{applicationIds.length === 1 ? '' : 's'}
                      </span>
                    </button>
                  </div>

                  {open && application.environments.map((environment) => {
                    const environmentIds = idsOfEnvironment(application, environment);
                    const environmentKey = `${application.slug} ${environment.name}`;
                    const environmentOpen = expanded.has(environmentKey);

                    return (
                      <div key={environment.name}>
                        <div className="hover:bg-muted/50 flex items-center gap-2 py-1.5 pr-3 pl-9">
                          <Checkbox
                            checked={stateOf(environmentIds, selected)}
                            onCheckedChange={(on) => tick(environmentIds, on)}
                            aria-label={`Export ${application.name} on ${environment.name}`}
                          />
                          <button
                            type="button"
                            onClick={() => toggleOpen(environmentKey)}
                            className="flex flex-1 cursor-pointer items-center gap-2 text-left text-sm"
                            aria-expanded={environmentOpen}
                          >
                            <ChevronRight className={`text-muted-foreground size-4 shrink-0 transition-transform ${environmentOpen ? 'rotate-90' : ''}`} />
                            <span className="font-mono text-xs">{environment.name}</span>
                            <span className="text-muted-foreground text-xs">
                              {environment.variables.length} variable{environment.variables.length === 1 ? '' : 's'}
                            </span>
                          </button>
                        </div>

                        {environmentOpen && environment.variables.map((variable) => {
                          const id = idOf(application.slug, environment.name, variable.key);

                          return (
                            <div
                              key={variable.key}
                              className="hover:bg-muted/50 flex items-center gap-2 py-1 pr-3 pl-[3.75rem]"
                            >
                              <Checkbox
                                checked={selected.has(id)}
                                onCheckedChange={(on) => tick([id], on)}
                                aria-label={`Export ${variable.key} of ${application.name} on ${environment.name}`}
                              />
                              <span className="font-mono text-xs">{variable.key}</span>
                              {variable.secret && (
                                <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
                                  <KeyRound className="size-2.5" /> secret
                                </Badge>
                              )}
                              {variable.empty && (
                                <span className="text-muted-foreground text-[10px]">empty</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <Button size="sm" onClick={handleExport} disabled={exporting || selected.size === 0}>
            <Download />
            {exporting
              ? 'Reading the values…'
              : `Export ${selected.size} variable${selected.size === 1 ? '' : 's'}`}
          </Button>
        </>
      )}

      <Dialog open={Boolean(exported)} onOpenChange={(value) => { if (!value) { setExported(null); } }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Environment variables to share</DialogTitle>
            <DialogDescription>
              {exported?.summary.variables} variable{exported?.summary.variables === 1 ? '' : 's'} from{' '}
              {exported?.summary.environments} env file{exported?.summary.environments === 1 ? '' : 's'}.
              Whoever receives it pastes it into the <strong>Import</strong> section of their
              own context. These are the real values, secrets included — share it the way you would
              share a password.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            readOnly
            value={exported?.yaml || ''}
            onFocus={(event) => event.target.select()}
            className="max-h-[50vh] min-h-64 overflow-y-auto font-mono text-xs"
            aria-label="The document to copy"
          />

          {copyFailed && (
            <p className="text-destructive text-xs">
              The clipboard is not available here — select the text above and copy it yourself.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setExported(null)}>Close</Button>
            <Button onClick={copy}>
              {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EnvVariablesExport;
