import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, BookOpen, Braces, ChevronDown, Database, FileWarning, SlidersHorizontal } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Markdown from '@/components/shared/Markdown';
import CodeBlock from '@/components/shared/CodeBlock';
import ApplicationSource from '@/components/application/ApplicationSource';
import { applicationsApi } from '@/services/api';
import { useAppState } from '@/context/AppStateContext';

function InputTable({ input }) {
  if (!input || !input.length) {
    return <p className="text-muted-foreground text-sm">This method takes no documented parameters.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/60 text-left">
            <th className="px-3 py-2 font-semibold">Parameter</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Required</th>
            <th className="px-3 py-2 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody>
          {input.map((param) => (
            <tr key={param.name} className="border-t align-top">
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{param.name}</td>
              <td className="text-muted-foreground px-3 py-2 font-mono text-xs">{param.type || '-'}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {param.required
                  ? <Badge variant="warning" className="text-[10px]">required</Badge>
                  : <span className="text-muted-foreground text-xs">optional</span>}
                {/* @param {type} [name=value] documents a default */}
                {param.default !== undefined && (
                  <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
                    = {param.default}
                  </span>
                )}
              </td>
              <td className="text-muted-foreground px-3 py-2 text-xs">{param.description || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemoryList({ memory }) {
  if (!memory || !memory.length) {
    return <p className="text-muted-foreground text-sm">This method does not read or write flow memory.</p>;
  }

  return (
    <ul className="space-y-2">
      {memory.map((entry) => (
        <li key={`${entry.mode}-${entry.key}`} className="flex items-start gap-2 text-sm">
          <Badge variant={entry.mode === 'write' ? 'info' : 'secondary'} className="mt-0.5 text-[10px]">
            {entry.mode || 'write'}
          </Badge>
          <div>
            <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">memory.{entry.key}</code>
            <p className="text-muted-foreground mt-1 text-xs">{entry.description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// Descriptions come from JSDoc, so they are markdown wrapped over several
// lines. The collapsed header shows the first paragraph as a single line.
const collapseLines = (text) => (text || '').replace(/\s*\n\s*/g, ' ').trim();
const firstParagraph = (text) => collapseLines((text || '').split(/\n\s*\n/)[0]);

function MethodCard({ method, appSlug, highlighted }) {
  const [open, setOpen] = useState(highlighted);
  const ref = useRef<any>(null);
  const docs = method.docs || {};

  const summary = firstParagraph(method.description);
  // Only render the full markdown when it says more than the summary
  const hasLongDescription = Boolean(method.description) &&
    collapseLines(method.description) !== summary;

  useEffect(() => {
    if (highlighted) {
      setOpen(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [highlighted]);

  const hasValidationSchema = method.parameters && Object.keys(method.parameters).length > 0;

  return (
    <Card ref={ref} id={`method-${method.name}`} className={highlighted ? 'border-info' : undefined}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none pb-4">
            <div className="flex items-center gap-2">
              <ChevronDown className={`text-muted-foreground size-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
              <CardTitle className="font-mono text-sm">{method.name}</CardTitle>
              {method.implemented === false && (
                <Badge variant="warning" className="text-[10px]">documented only</Badge>
              )}
            </div>
            {summary && <CardDescription className="pl-6">{summary}</CardDescription>}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-5 pl-10">
            {hasLongDescription && <Markdown className="text-sm">{method.description}</Markdown>}

            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <SlidersHorizontal className="size-3.5" /> Input parameters
              </h4>
              <InputTable input={docs.input} />
            </section>

            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Braces className="size-3.5" /> Output
              </h4>
              {docs.output ? (
                <div className="space-y-2">
                  {docs.output.status != null && docs.output.status !== '' && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge variant="secondary" className="font-mono">{String(docs.output.status)}</Badge>
                    </div>
                  )}
                  {docs.output.description && (
                    <p className="text-muted-foreground text-sm">{docs.output.description}</p>
                  )}
                  {docs.output.body !== undefined && (
                    typeof docs.output.body === 'string'
                      ? <CodeBlock code={docs.output.body} />
                      : <CodeBlock code={JSON.stringify(docs.output.body, null, 2)} language="json" />
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No documented output.</p>
              )}
            </section>

            <section>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Database className="size-3.5" /> Memory
              </h4>
              <MemoryList memory={docs.memory} />
            </section>

            {docs.example && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Example step
                </h4>
                <CodeBlock code={docs.example} language="yaml" />
                <p className="text-muted-foreground mt-1.5 text-xs">
                  Paste this inside a ```step block of any flow that uses <span className="font-mono">{appSlug}</span>.
                </p>
              </section>
            )}

            {hasValidationSchema && (
              <Collapsible>
                <CollapsibleTrigger className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4 cursor-pointer">
                  Show validation schema (from index.ts)
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CodeBlock className="mt-2" code={JSON.stringify(method.parameters, null, 2)} language="json" />
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export function ApplicationPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const highlightedMethod = searchParams.get('method');
  // Deep links to the Source view (?view=source&file=env/x.env) land on the
  // editor with that file selected — how the home page opens env files
  const requestedView = searchParams.get('view');
  const requestedFile = searchParams.get('file');
  const { applicationsRevision, refreshApplications, refreshEnvironments } = useAppState();

  const [app, setApp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [view, setView] = useState('document');

  const fetchApp = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setApp(null);
    }
    setError(null);

    try {
      const response = await applicationsApi.get(slug);
      if (!response.data) {
        setError(`Application “${slug}” not found`);
      } else {
        setApp(response.data);
      }
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchApp();
  }, [fetchApp]);

  // What this page holds was read when it opened. Anything that writes to the
  // application folder afterwards -- importing environment variables on the
  // home page, creating env files from their templates, another tab saving a
  // file -- re-reads the applications, and this page follows: silently, so
  // the env values on screen are the ones on disk without the page blinking.
  const readAtRevision = useRef(applicationsRevision);

  useEffect(() => {
    if (readAtRevision.current === applicationsRevision) { return; }
    readAtRevision.current = applicationsRevision;
    fetchApp({ silent: true });
  }, [applicationsRevision, fetchApp]);

  // Deep links to a method (?method=x) always land on the Document view
  useEffect(() => {
    if (highlightedMethod) { setView('document'); }
  }, [highlightedMethod, slug]);

  useEffect(() => {
    if (requestedView === 'source') { setView('source'); }
  }, [requestedView, requestedFile, slug]);

  // The Document view must reflect files saved from the Source view — and a
  // saved env file may declare a new environment for the selector
  const handleSourceSaved = useCallback(() => {
    fetchApp({ silent: true });
    refreshApplications();
    refreshEnvironments();
  }, [fetchApp, refreshApplications, refreshEnvironments]);

  const defaultTab = useMemo(() => (highlightedMethod ? 'methods' : 'readme'), [highlightedMethod]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 p-6">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load the application</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Toolbar — same shape as the flow view so both headers line up */}
      <div className="bg-background/95 sticky top-0 z-10 border-b px-6 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold tracking-tight">{app.name}</h1>
              <Badge variant="outline" className="text-[10px] uppercase">application</Badge>
              {app.errors?.length > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <FileWarning className="size-3" />
                  {app.errors.length} problem{app.errors.length > 1 ? 's' : ''}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground truncate font-mono text-xs">{app.path}</p>
          </div>

          {/* Same Document / Source toggle as the flow view */}
          <Tabs value={view} onValueChange={setView}>
            <TabsList>
              <TabsTrigger value="document">Document</TabsTrigger>
              <TabsTrigger value="source">Source</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {view === 'source' ? (
        <div className="min-h-0 flex-1">
          <ApplicationSource
            slug={slug}
            initialFile={requestedFile}
            revision={applicationsRevision}
            onSaved={handleSourceSaved}
          />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-6">
      {/* Application description: the JSDoc block at the top of its index.ts */}
      {app.description && <Markdown className="text-muted-foreground text-sm">{app.description}</Markdown>}

      {app.errors?.length > 0 && (
        <Alert variant="destructive">
          <FileWarning />
          <AlertTitle>This application has problems</AlertTitle>
          <AlertDescription>
            {app.errors.map((err, index) => (
              <p key={index} className="font-mono text-xs">{err.message}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      <Tabs key={`${slug}:${highlightedMethod || ''}`} defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="readme"><BookOpen /> README</TabsTrigger>
          <TabsTrigger value="methods">
            Methods
            <Badge variant="secondary" className="ml-1">{app.methods?.length || 0}</Badge>
          </TabsTrigger>
          <TabsTrigger value="environments">
            Environments
            <Badge variant="secondary" className="ml-1">{app.envFiles?.length || 0}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* README */}
        <TabsContent value="readme" className="pt-4">
          {app.readme ? (
            <Markdown>{app.readme}</Markdown>
          ) : (
            <p className="text-muted-foreground text-sm">
              This application has no README.md. Create one in <span className="font-mono">{app.path}</span> to document it.
            </p>
          )}
        </TabsContent>

        {/* Methods, from the JSDoc blocks of the application's index.ts */}
        <TabsContent value="methods" className="space-y-4 pt-4">
          {(app.methods || []).length === 0 && (
            <p className="text-muted-foreground text-sm">No methods found for this application.</p>
          )}
          {(app.methods || []).map((method) => (
            <MethodCard
              key={method.name}
              method={method}
              appSlug={app.slug}
              highlighted={highlightedMethod === method.name}
            />
          ))}
        </TabsContent>

        {/* Environment files */}
        <TabsContent value="environments" className="space-y-4 pt-4">
          {(app.envFiles || []).length === 0 && (
            <p className="text-muted-foreground text-sm">
              No environment files. Add e.g. <span className="font-mono">env/local.env</span> inside the application folder.
            </p>
          )}
          {(app.envFiles || []).map((envFile) => (
            <Card key={envFile.name}>
              <CardHeader>
                <CardTitle className="font-mono text-sm">{envFile.name}.env</CardTitle>
                <CardDescription className="font-mono text-xs">{envFile.path}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <tbody>
                      {(envFile.contents || []).map((entry) => (
                        <tr key={entry.key} className="border-t first:border-t-0">
                          <td className="px-3 py-1.5 font-mono text-xs font-medium whitespace-nowrap">{entry.key}</td>
                          <td className="text-muted-foreground w-full px-3 py-1.5 font-mono text-xs break-all">
                            {entry.value}
                            {entry.isSecret && <Badge variant="secondary" className="ml-2 text-[10px]">secret</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <Separator />
      <p className="text-muted-foreground text-xs">
        Methods and their documentation come from the JSDoc blocks of the application's{' '}
        <span className="font-mono">index.ts</span>. Edit them in the <strong>Source</strong> view.
      </p>
      </div>
      </div>
      )}
    </div>
  );
}

export default ApplicationPage;
