import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { AlertCircle, Check, CloudOff, FileText, Loader2, Play, Wand2, XCircle, CheckCircle2 } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AiEditDialog from '@/components/flow/AiEditDialog';
import BlockEditor from '@/components/flow/BlockEditor';
import FlowProperties from '@/components/flow/FlowProperties';
import XrayChip from '@/components/flow/XrayChip';
import { environmentApi, flowsApi, jiraApi } from '@/services/api';
import { useAppState } from '@/context/AppStateContext';
import { useExecutions } from '@/context/ExecutionContext';
import { useTheme } from '@/context/ThemeContext';
import { MONACO_FONT_FAMILY } from '@/lib/monaco';
import { useTabTitle } from '@/workspace/RoutePanel';

const RUN_STATUS_META = {
  starting: { label: 'Starting…', variant: 'info', Icon: Loader2, iconClass: 'animate-spin' },
  running: { label: 'Running…', variant: 'info', Icon: Loader2, iconClass: 'animate-spin' },
  passed: { label: 'Passed', variant: 'success', Icon: CheckCircle2 },
  error: { label: 'Failed', variant: 'destructive', Icon: XCircle },
};

// Writing to disk waits for a pause in the typing; re-parsing the document
// (which is what keeps the step cells and the problem list honest) is quicker,
// because it costs nothing but a round trip to the local API.
const SAVE_DELAY = 700;
const PARSE_DELAY = 350;

// Keystrokes closer together than this are one undo step, so Cmd+Z walks back
// through edits rather than through characters.
const HISTORY_COALESCE = 600;

export function FlowPage() {
  const [searchParams] = useSearchParams();
  const flowPath = searchParams.get('path');

  const { environment, refreshTree, agent } = useAppState();
  const { executions, startRun, clearRun, answerInput, anyRunning } = useExecutions();
  const { theme } = useTheme();

  const [flowData, setFlowData] = useState<any>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<any>(null);

  // The document's own title on the tab, once it is known
  useTabTitle(flowData?.title || null);
  const [tab, setTab] = useState('document');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savingProperties, setSavingProperties] = useState(false);
  const [saveError, setSaveError] = useState<any>(null);
  const [aiOpen, setAiOpen] = useState(false);
  // What this flow needs to run on the selected environment: null until the
  // check has answered
  const [readiness, setReadiness] = useState<any>(null);
  // configured: null while unknown (loading / unreachable), then a boolean
  const [xray, setXray] = useState<{
    configured: boolean | null;
    jiraBaseUrl: string;
    tests: Record<string, any>;
  }>({ configured: null, jiraBaseUrl: '', tests: {} });

  // What is on disk, as far as this page knows. The state drives the
  // indicator; the ref is what the write queue reads, whenever it gets to run.
  const [savedContent, setSavedContent] = useState('');
  const savedRef = useRef('');
  const draftRef = useRef('');
  const relativePathRef = useRef<string | null>(null);

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { relativePathRef.current = flowData?.relativePath || null; }, [flowData]);

  // Writes are chained: two keystrokes apart cannot land out of order
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const parsedRef = useRef('');
  // The title the last parse found, and the one the sidebar was told about
  const parsedTitleRef = useRef<string | null | undefined>(undefined);
  const treeTitleRef = useRef<string | null>(null);

  /**
   * The undo stack of the Document view. It holds whole documents: the block
   * editor rewrites the file on every keystroke, so anything finer would have
   * to know about blocks, and the Source tab (Monaco) keeps its own history
   * anyway.
   */
  const historyRef = useRef<{ entries: string[]; index: number; at: number }>({
    entries: [],
    index: 0,
    at: 0,
  });

  const run = flowPath ? executions[flowPath] : undefined;
  const dirty = draft !== savedContent;

  const loadFlow = useCallback(async () => {
    if (!flowPath) { return; }
    setLoading(true);
    setLoadError(null);
    try {
      const response = await flowsApi.getUserFlow(flowPath);
      const content = response.data.plainText || '';
      setFlowData(response.data);
      setDraft(content);
      savedRef.current = content;
      setSavedContent(content);
      parsedRef.current = content;
      treeTitleRef.current = response.data.title || null;
      historyRef.current = { entries: [content], index: 0, at: 0 };
      setSaveState('idle');
    } catch (ex) {
      setLoadError(ex.response?.data?.error || ex.message);
    } finally {
      setLoading(false);
    }
  }, [flowPath]);

  useEffect(() => {
    setTab('document');
    setSaveError(null);
    setAiOpen(false);
    loadFlow();
  }, [loadFlow]);

  /* ------------------------------ persistence ------------------------------ */

  /**
   * Write the document to disk. There is no Save button: the file is the
   * document, and it is kept up to date the way an editor keeps it.
   *
   * @param {string} content - The document to write
   */
  const persist = useCallback((content: string) => {
    const path = relativePathRef.current;
    if (!path) { return Promise.resolve(); }

    writeQueueRef.current = writeQueueRef.current.then(async () => {
      if (content === savedRef.current) { return; }
      setSaveState('saving');
      try {
        await flowsApi.saveFile(path, content, true);
        savedRef.current = content;
        setSavedContent(content);
        setSaveState('saved');
        setSaveError(null);

        // The sidebar shows the document's title, so it only has to hear
        // about the saves that changed it
        const title = parsedTitleRef.current;
        if (title !== undefined && title !== treeTitleRef.current) {
          treeTitleRef.current = title;
          refreshTree();
        }
      } catch (ex) {
        setSaveState('error');
        setSaveError(ex.response?.data?.error || ex.message);
      }
    });

    return writeQueueRef.current;
  }, [refreshTree]);

  // Autosave: a pause in the typing is what commits the document
  useEffect(() => {
    if (!flowData?.relativePath || draft === savedContent) { return undefined; }
    const timer = setTimeout(() => { persist(draft); }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [draft, flowData?.relativePath, persist, savedContent]);

  // Leaving the flow (or the page) must not drop the last keystrokes
  useEffect(() => {
    const flush = () => {
      if (draftRef.current !== savedRef.current) { persist(draftRef.current); }
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [flowPath, persist]);

  /**
   * Keep the notebook honest while the document is written: the steps, the
   * problems and the title come from a re-parse of the draft, not from what
   * was on disk when the flow was opened.
   */
  useEffect(() => {
    if (!flowData || draft === parsedRef.current) { return undefined; }

    const timer = setTimeout(async () => {
      parsedRef.current = draft;
      try {
        const parsed = await flowsApi.parse(draft);
        parsedTitleRef.current = parsed.data.title || null;
        setFlowData((current) => (current ? {
          ...current,
          segments: parsed.data.segments,
          steps: parsed.data.steps,
          errors: parsed.data.errors,
          title: parsed.data.title || current.title,
          description: parsed.data.description,
          // The property list and the Xray chip read the frontmatter, so
          // they have to come from the same re-parse as the steps
          properties: parsed.data.properties,
          xray: parsed.data.xray,
        } : current));
      } catch (ex) {
        setSaveError(ex.response?.data?.error || ex.message);
      }
    }, PARSE_DELAY);

    return () => clearTimeout(timer);
  }, [draft, flowData]);

  /* -------------------------------- history -------------------------------- */

  /**
   * Take an edit: it becomes the draft, and a point Cmd+Z can come back to.
   * Edits made in quick succession are folded into one entry.
   *
   * @param {string} next - The new document
   */
  const applyEdit = useCallback((next: string) => {
    setDraft(next);

    const history = historyRef.current;
    const now = Date.now();
    const atTip = history.index === history.entries.length - 1;

    if (atTip && history.entries.length && now - history.at < HISTORY_COALESCE) {
      history.entries[history.index] = next;
    } else {
      history.entries = [...history.entries.slice(0, history.index + 1), next];
      // A long session should not grow without bound
      if (history.entries.length > 250) { history.entries.shift(); }
      history.index = history.entries.length - 1;
    }
    history.at = now;
  }, []);

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (history.index <= 0) { return; }
    history.index -= 1;
    history.at = 0;
    setDraft(history.entries[history.index]);
  }, []);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (history.index >= history.entries.length - 1) { return; }
    history.index += 1;
    history.at = 0;
    setDraft(history.entries[history.index]);
  }, []);

  // Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (or Ctrl+Y) walk the document's own
  // history. The Source tab and the dialogs keep the browser's.
  useEffect(() => {
    if (tab !== 'document') { return undefined; }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) { return; }

      const key = event.key.toLowerCase();
      const isUndo = key === 'z' && !event.shiftKey;
      const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
      if (!isUndo && !isRedo) { return; }

      // Anything with its own editing history keeps it
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], .monaco-editor')) { return; }

      event.preventDefault();
      if (isUndo) { undo(); } else { redo(); }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, tab, undo]);

  /* --------------------------------- actions -------------------------------- */

  /**
   * Take the document the model rewrote as an ordinary edit: it lands in the
   * document, in the undo stack and — a moment later — on disk.
   */
  const handleAiEdit = async (content) => {
    applyEdit(content);
    setSaveError(null);

    // The previous run's step mapping no longer matches the document
    clearRun(flowPath);
    setTab('document');
  };

  const handleRun = async () => {
    if (!flowData || !environment) { return; }

    // What runs is what is on disk, so the file and the run never disagree
    await persist(draft);

    try {
      const parsed = await flowsApi.parse(draft);
      parsedRef.current = draft;
      parsedTitleRef.current = parsed.data.title || null;
      setFlowData((current) => ({
        ...current,
        segments: parsed.data.segments,
        steps: parsed.data.steps,
        errors: parsed.data.errors,
        title: parsed.data.title || current.title,
        description: parsed.data.description,
        properties: parsed.data.properties,
        xray: parsed.data.xray,
      }));
      if (parsed.data.errors?.length) {
        setTab('document');
        return;
      }
    } catch (ex) {
      setSaveError(ex.response?.data?.error || ex.message);
      return;
    }

    setTab('document');
    await startRun(flowPath, { value: draft, environment, path: flowData.relativePath, agent });
  };

  /**
   * Write the frontmatter back to the file. Only the property block is
   * rewritten — the body of the document is never touched — and the flow is
   * read back afterwards so the notebook, the title and the tree agree with
   * what is on disk.
   *
   * @param {Object} properties - The whole new frontmatter
   */
  const handlePropertiesChange = async (properties) => {
    if (!flowData?.relativePath) { return; }
    setSavingProperties(true);
    setSaveError(null);
    try {
      // The server rewrites the file it has, so the body has to be there first
      await persist(draftRef.current);
      await flowsApi.saveProperties(flowData.relativePath, properties);

      const response = await flowsApi.getUserFlow(flowPath);
      const content = response.data.plainText || '';
      setFlowData(response.data);
      setDraft(content);
      savedRef.current = content;
      setSavedContent(content);
      parsedRef.current = content;
      historyRef.current = {
        entries: [...historyRef.current.entries.slice(0, historyRef.current.index + 1), content],
        index: historyRef.current.index + 1,
        at: 0,
      };
      refreshTree();
    } catch (ex) {
      setSaveError(ex.response?.data?.error || ex.message);
    } finally {
      setSavingProperties(false);
    }
  };

  /**
   * The Xray tests this document mentions: the flow's own one
   * (frontmatter "xray.testKey") plus the "testKey" of each step.
   */
  const testKeys = useMemo(() => {
    const keys: any[] = [];
    if (flowData?.xray?.testKey) { keys.push(flowData.xray.testKey); }
    (flowData?.steps || []).forEach((step) => {
      if (step?.testKey) { keys.push(step.testKey); }
    });
    return [...new Set(keys.map((key) => String(key).trim()).filter(Boolean))];
  }, [flowData]);

  const testKeysParam = testKeys.join(',');

  // Xray data is fetched after the document is rendered, and never blocks
  // it: when the integration is off, or Jira is unreachable, the flow reads
  // exactly as it did before.
  useEffect(() => {
    const keys = testKeysParam ? testKeysParam.split(',') : [];

    if (!keys.length) {
      setXray({ configured: null, jiraBaseUrl: '', tests: {} });
      return undefined;
    }

    let cancelled = false;

    jiraApi.getTests(keys)
      .then((response) => {
        if (cancelled) { return; }
        setXray({
          configured: Boolean(response.data.configured),
          jiraBaseUrl: response.data.jiraBaseUrl || '',
          tests: response.data.tests || {},
        });
      })
      .catch(() => {
        if (!cancelled) { setXray({ configured: null, jiraBaseUrl: '', tests: {} }); }
      });

    return () => { cancelled = true; };
  }, [testKeysParam]);

  const xrayTestFor = useCallback(
    (key) => (key ? xray.tests[String(key).trim().toUpperCase()] : undefined),
    [xray]
  );

  const runStatusMeta = run ? RUN_STATUS_META[run.status] : null;

  const parseErrors = flowData?.errors || [];

  // The applications the document calls, as a stable key: the readiness check
  // only has to be asked again when they -- or the environment -- change, not
  // on every keystroke
  const usedApplications = useMemo(
    () => [...new Set<string>((flowData?.steps || [])
      .map((step) => step.application)
      .filter(Boolean))].sort().join(','),
    [flowData?.steps]
  );

  const flowLoaded = Boolean(flowData);

  /**
   * Whether the flow can run where the sidebar points, asked before anybody
   * presses Run. An environment exists as soon as one application declares
   * it, so the files that matter are the ones belonging to the applications
   * this flow uses -- the rest of them are none of this flow's business.
   */
  useEffect(() => {
    if (!environment || !flowLoaded) {
      setReadiness(null);
      return;
    }

    let cancelled = false;
    const applications = usedApplications ? usedApplications.split(',') : [];

    environmentApi.readiness({ environment, applications })
      .then((response) => { if (!cancelled) { setReadiness(response.data); } })
      // A check that cannot be made says nothing: the run itself makes it too
      .catch(() => { if (!cancelled) { setReadiness(null); } });

    return () => { cancelled = true; };
  }, [environment, usedApplications, flowLoaded]);

  // Invalid step YAML, by step number, as the parser saw it
  const stepErrors = useMemo(() => {
    const errors = new Map<number, string>();
    (flowData?.segments || []).forEach((segment) => {
      if (segment.type === 'step' && segment.error) { errors.set(segment.stepIndex, segment.error); }
    });
    return errors;
  }, [flowData]);

  /**
   * Everything a step cell shows besides its own YAML: what the parser made
   * of it, what the run did with it, and what Jira knows about it.
   *
   * @param {number} stepIndex - Position of the step in the document
   */
  const resolveStep = useCallback((stepIndex: number) => {
    const step = (flowData?.steps || []).find(
      (candidate) => candidate && candidate.stepIndex === stepIndex
    );
    const stepId = run?.stepOrder?.[stepIndex];

    return {
      step,
      stepData: stepId ? run?.steps?.[stepId] : undefined,
      inputRequest: stepId ? run?.inputs?.[stepId] : null,
      xrayTest: xrayTestFor(step?.testKey),
      jiraBaseUrl: xray.jiraBaseUrl,
      error: stepErrors.get(stepIndex),
    };
  }, [flowData, run, stepErrors, xray.jiraBaseUrl, xrayTestFor]);

  if (!flowPath) {
    return (
      <div className="p-6">
        <Alert>
          <FileText />
          <AlertTitle>No flow selected</AlertTitle>
          <AlertDescription>Pick a flow from the sidebar.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 p-6">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Could not load the flow</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <AiEditDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        content={draft}
        onApply={handleAiEdit}
      />

      {/* Toolbar */}
      <div className="bg-background/95 sticky top-0 z-10 border-b px-6 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold tracking-tight">{flowData.title}</h1>
              {runStatusMeta && (
                <Badge variant={runStatusMeta.variant} className="gap-1">
                  <runStatusMeta.Icon className={runStatusMeta.iconClass ? `size-3 ${runStatusMeta.iconClass}` : 'size-3'} />
                  {runStatusMeta.label}
                </Badge>
              )}
            </div>
            {flowData.relativePath && (
              <p className="text-muted-foreground truncate font-mono text-xs">{flowData.relativePath}</p>
            )}
          </div>

          {/* There is no Save button: this says what the file is doing */}
          {flowData.relativePath && (
            saveState === 'error' ? (
              <span className="text-destructive flex items-center gap-1 text-xs" title={String(saveError || '')}>
                <CloudOff className="size-3.5" /> Not saved
              </span>
            ) : saveState === 'saving' || dirty ? (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Saving…
              </span>
            ) : saveState === 'saved' ? (
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Check className="size-3.5" /> Saved
              </span>
            ) : null
          )}

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="document">Document</TabsTrigger>
              <TabsTrigger value="source">Source</TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setAiOpen(true)}
            disabled={anyRunning}
            title="Edit this flow with AI"
            aria-label="Edit this flow with AI"
          >
            <Wand2 />
          </Button>

          <Button
            onClick={handleRun}
            disabled={anyRunning || !environment}
            title={
              !environment
                ? 'Select an environment in the sidebar first'
                : readiness && !readiness.ready
                  ? `This flow is missing env files for “${environment}”`
                  : agent
                    ? `Run the committed copy on agent “${agent}”, against “${environment}”`
                    : `Run on “${environment}”`
            }
          >
            <Play /> Run{environment ? ` · ${environment}` : ''}{agent ? ` · ${agent}` : ''}
          </Button>
        </div>
      </div>

      {/* Content */}
      {tab === 'source' ? (
        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            language="markdown"
            theme={theme === 'dark' ? 'lab34-dark' : 'lab34-light'}
            value={draft}
            onChange={(value) => applyEdit(value ?? '')}
            options={{
              minimap: { enabled: false },
              fontFamily: MONACO_FONT_FAMILY,
              fontSize: 13,
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-4xl space-y-1 px-6 py-6">
            {/* The frontmatter, as a property list. "title" and
                "description" are ordinary properties, but they read as the
                document's heading, so they are rendered above the list */}
            <FlowProperties
              properties={flowData.properties}
              fallbackTitle={flowData.title}
              saving={savingProperties}
              onChange={handlePropertiesChange}
            />

            {/* The Xray Test this flow maps to (frontmatter "xray.testKey"):
                a live chip when Jira answered, a gray notice otherwise */}
            {flowData.xray?.testKey && (
              <div className="mb-4">
                {xrayTestFor(flowData.xray.testKey) ? (
                  <XrayChip
                    testKey={flowData.xray.testKey}
                    test={xrayTestFor(flowData.xray.testKey)}
                    jiraBaseUrl={xray.jiraBaseUrl}
                  />
                ) : (
                  <p className="text-muted-foreground text-xs">
                    <span className="font-mono">{flowData.xray.testKey}</span>
                    {' — '}
                    {xray.configured === false
                      ? 'the Jira / Xray integration is not configured. Set it up in Settings › Xray to see this test.'
                      : 'no details from Jira yet.'}
                  </p>
                )}
              </div>
            )}

            {/* Problems */}
            {saveError && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle />
                <AlertTitle>Something went wrong</AlertTitle>
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
            {run?.startError && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle />
                <AlertTitle>The flow could not start</AlertTitle>
                <AlertDescription>{run.startError}</AlertDescription>
              </Alert>
            )}
            {run?.execution?.error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle />
                <AlertTitle>{run.execution.error.name || 'Execution error'}</AlertTitle>
                <AlertDescription>
                  <p>{run.execution.error.message}</p>
                  {/* The step cell carries the full picture (causes, stack);
                      here only what the message does not already say */}
                  {(run.execution.error.causes || []).map((cause, index) => (
                    <p key={index} className="font-mono text-xs">
                      {cause.name}: {cause.message}
                    </p>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            {readiness && !readiness.ready && (
              <Alert className="mb-4">
                <AlertCircle />
                <AlertTitle>
                  This flow is not ready to run on &ldquo;{readiness.environment}&rdquo;
                </AlertTitle>
                <AlertDescription>
                  {readiness.known ? (
                    <>
                      <p>
                        Every application a flow uses needs its env file for the environment.
                        These do not have one yet:
                      </p>
                      {readiness.missing.map((item) => (
                        <p key={item.application} className="font-mono text-xs">
                          {item.file}
                          {item.hasTemplate ? ' — a .env.example template is committed next to it' : ''}
                        </p>
                      ))}
                      <p>
                        Create them from the Environment variables card on the home page, or
                        import a teammate's export under Environment variables › Import.
                      </p>
                    </>
                  ) : (
                    <p>
                      No application declares that environment. Pick another one in the sidebar,
                      or write its env file from the Source view of an application that needs it —
                      importing a teammate's export creates the files the document names too.
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {parseErrors.length > 0 && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle />
                <AlertTitle>This flow has {parseErrors.length} problem{parseErrors.length > 1 ? 's' : ''}</AlertTitle>
                <AlertDescription>
                  {parseErrors.map((error, index) => (
                    <p key={index} className="font-mono text-xs">
                      {typeof error.stepIndex === 'number' ? `step ${error.stepIndex + 1}: ` : ''}{error.message}
                    </p>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {/* The notebook, written in place: rendered Markdown you can type
                into, with the step cells and their execution output */}
            <BlockEditor
              key={flowPath}
              value={draft}
              onChange={applyEdit}
              resolveStep={resolveStep}
              onAnswerInput={answerInput}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default FlowPage;
