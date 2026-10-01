import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';

import { listFlows } from './core/contexts';
import { parseFlow } from './core/flowParser';
import type { StepBlock } from './core/flowParser';
import type { Install } from './core/install';
import { launch } from './core/process';
import type { Outcome, Running } from './core/process';
import { summarize, Tracker } from './core/tracker';
import type { Failure, FlowResult, RunSummary, StepRef, StepResult } from './core/tracker';
import type { Contexts, RonselContext } from './discovery';
import type { Environments } from './environments';
import type { Installs } from './installs';
import type { Prompts } from './prompts';

/**
 * Flows as tests, the way VS Code shows tests.
 *
 * Every context is a root of the Testing view, its folders and flows below
 * it, and every ```step block of a flow is a test of its own, with the range
 * of its block: that is what puts a play button next to each flow and, once
 * it ran, a check or a cross next to every step, in the gutter of the
 * document -- drawn by VS Code, like any test's. Failures open where they
 * happened, with what was expected next to what came.
 *
 * Running a step runs its flow: steps hand each other their results through
 * the flow's memory, and none of them makes sense on its own.
 */

/** Who else wants to know how the runs this window starts go: the Executions panel. */
export interface RunObserver {
  /** The run, as recorded so far */
  run: (context: RonselContext, run: RunSummary) => void;
  /** A step of one of its flows, as it goes */
  step: (context: RonselContext, runId: string, file: string, index: number, state: LiveStep) => void;
}

/** A step of a flow that is running. */
export interface LiveStep {
  status: 'running' | 'passed' | 'failed' | 'errored' | 'skipped';
  duration?: number;
  error?: string;
}

/** What a flow item is, besides the item. */
interface FlowEntry {
  item: vscode.TestItem;
  context: RonselContext;
  /** Relative to the context's flows folder, forward slashes: how a run names it */
  file: string;
  /** The step items, by block index */
  steps: vscode.TestItem[];
}

/** What to run in one context. */
type Target = { flows: FlowEntry[] } | { view: string; label: string };

const CONTEXT = 'context:';
const FOLDER = 'folder:';

/** Why a run stopped, when it was stopped from here: the run records it as each flow's error. */
const CANCELLED = 'Cancelled from VS Code';
const STOPPED = 'Stopped from the debugger';

/** Terminal output wants \r\n. */
const terminal = (text: string) => text.replace(/\r?\n/g, '\r\n');

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

export class Testing implements vscode.Disposable {
  readonly controller: vscode.TestController;
  private readonly runProfile: vscode.TestRunProfile;
  private readonly debugProfile: vscode.TestRunProfile;
  private readonly contextItems = new Map<string, vscode.TestItem>();
  private readonly flows = new Map<string, FlowEntry>();
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly contexts: Contexts,
    private readonly environments: Environments,
    private readonly installs: Installs,
    private readonly prompts: Prompts,
    private readonly log: vscode.LogOutputChannel,
    private readonly observer?: RunObserver
  ) {
    this.controller = vscode.tests.createTestController('ronsel', 'Ronsel');

    this.controller.resolveHandler = async () => {
      await this.contexts.ready;
    };
    this.controller.refreshHandler = async () => {
      await this.contexts.refresh();
    };

    this.runProfile = this.controller.createRunProfile(
      'Run', vscode.TestRunProfileKind.Run, (request, token) => this.handle(request, token, false), true
    );
    this.debugProfile = this.controller.createRunProfile(
      'Debug', vscode.TestRunProfileKind.Debug, (request, token) => this.handle(request, token, true), true
    );

    // The gear next to the run buttons picks the environment they run against
    this.runProfile.configureHandler = () => { void this.environments.pick(); };
    this.debugProfile.configureHandler = () => { void this.environments.pick(); };

    this.disposables.push(
      this.controller,
      this.runProfile,
      this.debugProfile,
      contexts.onDidChange(() => this.syncAll()),
      contexts.onDidChangeFlow(({ context, uri, deleted }) => this.flowChanged(context, uri, deleted)),
      environments.onDidChange(() => this.label()),
      vscode.workspace.onDidChangeTextDocument(event => this.edited(event.document))
    );

    this.label();
    this.syncAll();
  }

  /** Every flow, for a picker. */
  get allFlows(): FlowEntry[] {
    return [...this.flows.values()].sort((a, b) =>
      a.context.name.localeCompare(b.context.name) || a.file.localeCompare(b.file));
  }

  /** The flow a file is, when it is one. */
  flowOf(uri: vscode.Uri): FlowEntry | undefined {
    return this.flows.get(uri.toString());
  }

  /** Run flows, the way the run button of the Testing view would. */
  async runFlows(entries: FlowEntry[], debug = false): Promise<void> {
    // VS Code saves before it runs tests; a run started from here does the same
    const files = new Set(entries.map(entry => entry.item.id));
    await Promise.all(vscode.workspace.textDocuments
      .filter(document => document.isDirty && files.has(document.uri.toString()))
      .map(document => document.save()));

    const profile = debug ? this.debugProfile : this.runProfile;
    const request = new vscode.TestRunRequest(entries.map(entry => entry.item), undefined, profile);
    const cancellation = new vscode.CancellationTokenSource();
    try {
      await this.handle(request, cancellation.token, debug);
    }
    finally {
      cancellation.dispose();
    }
  }

  /** Run a view of a context: the flows its filters match today. */
  async runView(context: RonselContext, view: string, environment?: string): Promise<void> {
    const chosen = environment || await this.environments.ensure();
    if (!chosen) { return; }

    const run = this.controller.createTestRun(new vscode.TestRunRequest(), `Ronsel (${chosen}): ${view}`, true);
    try {
      await this.runIn(run, context, { view, label: view }, chosen, run.token, false);
    }
    finally {
      run.end();
    }
  }

  /**
   * Run flows named by file, with an environment of their own: a run of the
   * Executions panel, run again the way it ran.
   */
  async rerun(context: RonselContext, files: string[], environment: string): Promise<void> {
    const entries = files
      .map(file => this.flows.get(vscode.Uri.file(path.join(context.flowsDir, ...file.split('/'))).toString()))
      .filter((entry): entry is FlowEntry => Boolean(entry));

    if (!entries.length) {
      void vscode.window.showWarningMessage('None of the flows of that run is there any more.');
      return;
    }

    const request = new vscode.TestRunRequest(entries.map(entry => entry.item), undefined, this.runProfile);
    const run = this.controller.createTestRun(request, `Ronsel (${environment})`);
    try {
      await this.runIn(run, context, { flows: entries }, environment, run.token, false);
    }
    finally {
      run.end();
    }
  }

  /* ------------------------------------------------------------------ tree */

  /** Rebuild the tree of every context: contexts come and go. */
  private syncAll() {
    const roots = new Set(this.contexts.all.map(context => context.root));

    for (const [root, item] of this.contextItems) {
      if (roots.has(root)) { continue; }
      this.controller.items.delete(item.id);
      this.contextItems.delete(root);
      for (const [key, entry] of this.flows) {
        if (entry.context.root === root) { this.flows.delete(key); }
      }
    }

    this.contexts.all.forEach(context => this.syncContext(context));
    this.publishFlowPaths();
    this.label();
  }

  /**
   * Rebuild the tree of one context from its flows folder. Items keep their
   * ids, so VS Code keeps their results: nothing is lost by building anew.
   */
  private syncContext(context: RonselContext) {
    let root = this.contextItems.get(context.root);
    if (!root) {
      root = this.controller.createTestItem(`${CONTEXT}${context.root}`, context.name);
      this.controller.items.add(root);
      this.contextItems.set(context.root, root);
    }

    root.label = context.name;
    const where = vscode.workspace.asRelativePath(context.root, false);
    root.description = where !== context.name ? where : undefined;

    for (const [key, entry] of this.flows) {
      if (entry.context.root === context.root) { this.flows.delete(key); }
    }

    const folders = new Map<string, vscode.TestItem>();
    const top: vscode.TestItem[] = [];

    const folderOf = (relative: string): vscode.TestItem | null => {
      if (relative === '.' || relative === '') { return null; }

      const known = folders.get(relative);
      if (known) { return known; }

      const absolute = path.join(context.flowsDir, ...relative.split('/'));
      const folder = this.controller.createTestItem(`${FOLDER}${absolute}`, path.posix.basename(relative));
      folder.sortText = `0-${path.posix.basename(relative)}`;
      folders.set(relative, folder);

      const parent = folderOf(path.posix.dirname(relative));
      if (parent) { parent.children.add(folder); }
      else { top.push(folder); }

      return folder;
    };

    for (const file of listFlows(context.flowsDir)) {
      const uri = vscode.Uri.file(path.join(context.flowsDir, ...file.split('/')));
      const item = this.controller.createTestItem(uri.toString(), path.posix.basename(file), uri);
      item.sortText = `1-${path.posix.basename(file)}`;

      const entry: FlowEntry = { item, context, file, steps: [] };
      this.flows.set(uri.toString(), entry);
      this.syncFlow(entry);

      const parent = folderOf(path.posix.dirname(file));
      if (parent) { parent.children.add(item); }
      else { top.push(item); }
    }

    root.children.replace(top);
  }

  /** A flow's title, range and steps, from its open document or from disk. */
  private syncFlow(entry: FlowEntry, text?: string) {
    let content = text;
    if (content === undefined) {
      const open = vscode.workspace.textDocuments.find(document => document.uri.toString() === entry.item.id);
      try {
        content = open ? open.getText() : fs.readFileSync(entry.item.uri!.fsPath, 'utf8');
      }
      catch {
        content = '';
      }
    }

    const parsed = parseFlow(content);
    const lastLine = Math.max(0, content.split(/\r?\n/).length - 1);
    const { item } = entry;

    item.label = parsed.title || path.posix.basename(entry.file);
    item.description = parsed.title ? path.posix.basename(entry.file) : undefined;
    item.range = new vscode.Range(parsed.titleLine, 0, Math.max(parsed.titleLine, lastLine), 0);

    entry.steps = parsed.steps.map(block => this.stepItem(entry, block));
    item.children.replace(entry.steps);
  }

  private stepItem(entry: FlowEntry, block: StepBlock): vscode.TestItem {
    const step = this.controller.createTestItem(`${entry.item.id}#${block.id || `step-${block.index + 1}`}`, block.label, entry.item.uri);
    step.range = new vscode.Range(block.line, 0, block.endLine, 0);
    step.sortText = String(block.index).padStart(6, '0');

    const notes = [block.call && block.call !== block.label ? block.call : null, block.enabled ? null : 'disabled'];
    step.description = notes.filter(Boolean).join(' · ') || undefined;
    step.error = block.error;

    return step;
  }

  /** A flow file was written or removed: one flow changes, or the shape of the tree does. */
  private flowChanged(context: RonselContext, uri: vscode.Uri, deleted: boolean) {
    const entry = this.flows.get(uri.toString());

    if (entry && !deleted) {
      this.debounce(uri.toString(), () => this.syncFlow(entry));
      return;
    }

    this.debounce(`${CONTEXT}${context.root}`, () => {
      this.syncContext(context);
      this.publishFlowPaths();
    });
  }

  /** A flow being edited shows its steps where they are now, before it is saved. */
  private edited(document: vscode.TextDocument) {
    const entry = this.flows.get(document.uri.toString());
    if (!entry) { return; }

    this.debounce(document.uri.toString(), () => this.syncFlow(entry, document.getText()));
  }

  private debounce(key: string, task: () => void) {
    clearTimeout(this.pending.get(key));
    this.pending.set(key, setTimeout(() => {
      this.pending.delete(key);
      task();
    }, 250));
  }

  /** What the explorer's "Run Flow" needs to know: which files are flows. */
  private publishFlowPaths() {
    void vscode.commands.executeCommand('setContext', 'ronsel.flowPaths', [...this.flows.values()].map(entry => entry.item.uri!.fsPath));
    this.publishActive();
  }

  /** Whether the active editor holds a flow, for its run button. */
  publishActive() {
    const editor = vscode.window.activeTextEditor;
    const isFlow = Boolean(editor && this.flows.has(editor.document.uri.toString()));
    void vscode.commands.executeCommand('setContext', 'ronsel.activeEditorIsFlow', isFlow);
  }

  /** The profiles say which environment they run against. */
  private label() {
    const environment = this.environments.current;
    this.runProfile.label = environment ? `Run (${environment})` : 'Run';
    this.debugProfile.label = environment ? `Debug (${environment})` : 'Debug';
  }

  /* ------------------------------------------------------------------- run */

  /** The flows a request means, by context. A step means its flow. */
  private flowsOf(request: vscode.TestRunRequest): Map<RonselContext, FlowEntry[]> {
    const excluded = new Set((request.exclude || []).map(item => item.id));
    const chosen = new Map<string, FlowEntry>();

    const visit = (item: vscode.TestItem) => {
      if (excluded.has(item.id)) { return; }

      const hash = item.id.indexOf('#');
      const flow = this.flows.get(hash === -1 ? item.id : item.id.slice(0, hash));
      if (flow) {
        chosen.set(flow.item.id, flow);
        return;
      }

      item.children.forEach(visit);
    };

    if (request.include) { request.include.forEach(visit); }
    else { this.controller.items.forEach(visit); }

    const byContext = new Map<RonselContext, FlowEntry[]>();
    for (const entry of chosen.values()) {
      byContext.set(entry.context, [...(byContext.get(entry.context) || []), entry]);
    }
    for (const entries of byContext.values()) {
      entries.sort((a, b) => a.file.localeCompare(b.file));
    }

    return byContext;
  }

  private async handle(request: vscode.TestRunRequest, token: vscode.CancellationToken, debug: boolean) {
    await this.contexts.ready;

    const targets = this.flowsOf(request);
    if (!targets.size) { return; }

    const environment = await this.environments.ensure();
    if (!environment) { return; }

    const run = this.controller.createTestRun(request, `Ronsel (${environment})`);
    const stop = new vscode.CancellationTokenSource();
    const subscriptions = [
      token.onCancellationRequested(() => stop.cancel()),
      run.token.onCancellationRequested(() => stop.cancel())
    ];

    try {
      for (const [context, flows] of targets) {
        if (stop.token.isCancellationRequested) {
          flows.forEach(entry => this.skipAll(run, entry));
          continue;
        }
        await this.runIn(run, context, { flows }, environment, stop.token, debug);
      }
    }
    finally {
      subscriptions.forEach(subscription => subscription.dispose());
      stop.dispose();
      run.end();
    }
  }

  private skipAll(run: vscode.TestRun, entry: FlowEntry) {
    run.skipped(entry.item);
    entry.steps.forEach(step => run.skipped(step));
  }

  /** Run flows of one context, in one process, as one test run of the context. */
  private async runIn(
    run: vscode.TestRun,
    context: RonselContext,
    target: Target,
    environment: string,
    token: vscode.CancellationToken,
    debug: boolean
  ) {
    const flows = 'flows' in target ? target.flows : [];
    const install = await this.installs.require(context);

    if (!install) {
      flows.forEach(entry => {
        run.errored(entry.item, new vscode.TestMessage(`Ronsel is not installed for "${context.name}". Install it in the project (npm install ronsel), or globally, or set ronsel.cliPath.`));
        entry.steps.forEach(step => run.skipped(step));
      });
      return;
    }

    flows.forEach(entry => {
      run.enqueued(entry.item);
      entry.steps.forEach(step => run.enqueued(step));
    });

    const files = flows.map(entry => `flows/${entry.file}`);
    const node = this.installs.node();
    const what = 'view' in target ? `--view "${target.view}"` : files.map(file => `--file ${file}`).join(' ');

    run.appendOutput(terminal(`${dim(`ronsel ${install.version} -- ${context.root}`)}\n`));
    run.appendOutput(terminal(`${dim(`ronsel --env ${environment} ${what}`)}\n\n`));
    this.log.info(`Running in ${context.root}: ${node} ${install.script} --env ${environment} ${what}`);

    // Whatever the run reported on, so whatever it did not can be explained
    const finished = new Set<string>();
    const touched = new Map<string, FlowEntry>();
    flows.forEach(entry => touched.set(entry.file, entry));
    const reportedSteps = new Set<vscode.TestItem>();
    /** Steps that failed, which say why their flow did */
    const failedSteps = new Set<vscode.TestItem>();
    let runId: string | null = null;
    let over = false;
    let running: Running | null = null;

    // Looked up afresh every time: the tree is rebuilt when a flow is added
    // while the run goes on, and the items with it
    const entryOf = (file: string): FlowEntry | undefined => {
      const fresh = this.flows.get(vscode.Uri.file(path.join(context.flowsDir, ...file.split('/'))).toString());
      const entry = fresh || touched.get(file);
      if (entry && !touched.has(file)) {
        // A view names its flows as it runs them
        run.enqueued(entry.item);
        entry.steps.forEach(step => run.enqueued(step));
      }
      if (entry) { touched.set(file, entry); }
      return entry;
    };

    // By the runner's id first: it survives a step being inserted above while
    // the run goes on, which the position does not
    const stepOf = (entry: FlowEntry, ref: StepRef): vscode.TestItem | undefined =>
      (ref.id ? entry.steps.find(step => step.id.endsWith(`#${ref.id}`)) : undefined) || entry.steps[ref.index];

    const live = (file: string, index: number, state: LiveStep) => {
      if (runId && this.observer) { this.observer.step(context, runId, file, index, state); }
    };

    const tracker = new Tracker({
      runUpdated: (summary) => {
        runId = summary.id;
        over = summary.status !== 'running';
        if (this.observer) { this.observer.run(context, summary); }
      },
      flowStarted: (file) => {
        const entry = entryOf(file);
        if (entry) { run.started(entry.item); }
      },
      stepStarted: (file, ref) => {
        const entry = entryOf(file);
        const step = entry && stepOf(entry, ref);
        if (step) { run.started(step); }
        live(file, ref.index, { status: 'running' });
      },
      stepFinished: (file, ref, result) => {
        const entry = entryOf(file);
        const step = entry && stepOf(entry, ref);
        if (step) {
          this.report(run, step, result);
          reportedSteps.add(step);
          if (result.status === 'failed' || result.status === 'errored') { failedSteps.add(step); }
        }
        live(file, ref.index, {
          status: result.status,
          ...(result.duration !== undefined ? { duration: result.duration } : {}),
          ...(result.failures[0] ? { error: summarize(result.failures[0]) } : {})
        });
      },
      flowFinished: (file, result, reported) => {
        const entry = entryOf(file);
        if (!entry) { return; }
        finished.add(file);
        entry.steps.forEach((step, index) => {
          if (!reported.has(index) && !reportedSteps.has(step)) { run.skipped(step); }
        });

        // Stopped from here is not failed: VS Code shows a test it was told
        // to stop as one that never finished. The run itself says why
        if (result.status === 'failed' && (result.error === CANCELLED || result.error === STOPPED)) {
          run.skipped(entry.item);
          return;
        }

        this.reportFlow(run, entry, result, entry.steps.some(step => failedSteps.has(step)));
      },
      inputRequested: (file, request) => {
        const entry = file ? entryOf(file) : undefined;
        this.prompts.ask({
          request,
          title: `Ronsel: ${entry ? entry.item.label : 'a step'} asks`,
          answer: value => running?.answer(request.id, value),
          refuse: () => running?.refuse(request.id)
        });
      },
      inputResolved: (id) => this.prompts.withdraw(id)
    });

    const name = 'view' in target ? target.label : flows.map(entry => entry.item.label).join(', ');

    running = launch({
      node,
      script: install.script,
      context: context.root,
      environment,
      ...('view' in target ? { view: target.view } : { files }),
      inspect: debug
    }, {
      event: (event, payload) => tracker.handle(event, payload),
      output: (text) => run.appendOutput(terminal(text)),
      inspector: (port) => {
        void this.attach(port, context, run, running as Running, name, () => over);
      }
    });

    const cancelled = token.onCancellationRequested(() => running?.cancel(CANCELLED));
    const outcome = await running.done;
    cancelled.dispose();
    tracker.close();

    const reason = this.explain(outcome, install, node);
    if (reason) {
      run.appendOutput(terminal(`\n${reason}\n`));
      this.log.warn(`${context.name}: ${reason}`);
    }

    for (const [file, entry] of touched) {
      if (finished.has(file)) { continue; }

      if (outcome.cancelled) {
        run.skipped(entry.item);
      }
      else {
        run.errored(entry.item, new vscode.TestMessage(reason || 'The run ended before this flow did.'));
      }
      entry.steps.forEach(step => { if (!reportedSteps.has(step)) { run.skipped(step); } });
    }
  }

  /** Why a run said nothing about some of its flows, when there is a why. */
  private explain(outcome: Outcome, install: Install, node: string): string | null {
    if (outcome.cancelled) { return null; }

    if (outcome.error && /^Could not start /.test(outcome.error)) {
      return `${outcome.error}. Is Node.js installed? ronsel.nodePath can point at it.`;
    }

    if (outcome.error) { return outcome.error; }

    if (!outcome.hello) {
      return `ronsel ${install.version || ''} (${install.root}) did not answer the editor: it needs a version that ` +
        'reports to editors (--ipc). Update it, e.g. npm install ronsel@latest. ' +
        `It was run with ${node}; ronsel needs Node.js 24 or newer.`;
    }

    if (!outcome.run) {
      return `The run ended unexpectedly (${outcome.signal ? `signal ${outcome.signal}` : `exit code ${outcome.code}`}). ` +
        'Its output is above.';
    }

    return null;
  }

  /** A step's result, the way VS Code shows a test's. */
  private report(run: vscode.TestRun, step: vscode.TestItem, result: StepResult) {
    switch (result.status) {
      case 'passed':
        run.passed(step, result.duration);
        break;
      case 'skipped':
        run.skipped(step);
        break;
      case 'failed':
        run.failed(step, this.messages(step, result.failures), result.duration);
        break;
      default:
        run.errored(step, this.messages(step, result.failures), result.duration);
    }
  }

  private messages(step: vscode.TestItem, failures: Failure[]): vscode.TestMessage[] {
    return failures.map(failure => {
      const message = failure.expected !== undefined && failure.actual !== undefined
        ? vscode.TestMessage.diff(failure.message, failure.expected, failure.actual)
        : new vscode.TestMessage(failure.actual !== undefined ? `${failure.message}\nActual: ${failure.actual}` : failure.message);

      if (step.uri && step.range) {
        message.location = new vscode.Location(step.uri, step.range);
      }
      return message;
    });
  }

  /**
   * A flow's result. A flow that failed because a step did says nothing of
   * its own: the step already shows why, where it happened, and VS Code would
   * repeat it on the flow's title. Only a failure no step explains -- an env
   * file missing, a step that does not parse -- is the flow's to tell.
   */
  private reportFlow(run: vscode.TestRun, entry: FlowEntry, result: FlowResult, explained: boolean) {
    if (result.status === 'passed') {
      run.passed(entry.item, result.duration);
      return;
    }

    if (explained) {
      run.failed(entry.item, [], result.duration);
      return;
    }

    const message = new vscode.TestMessage(result.error || 'The flow failed');
    if (entry.item.uri && entry.item.range) {
      const start = entry.item.range.start;
      message.location = new vscode.Location(entry.item.uri, new vscode.Range(start, start));
    }
    run.failed(entry.item, message, result.duration);
  }

  /** Attach the debugger to a run started paused, and let it go. */
  private async attach(
    port: number,
    context: RonselContext,
    run: vscode.TestRun,
    running: Running,
    name: string,
    over: () => boolean
  ) {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(context.root));

    const configuration: vscode.DebugConfiguration = {
      type: 'node',
      request: 'attach',
      name: `Ronsel: ${name}`,
      address: '127.0.0.1',
      port,
      continueOnAttach: true,
      skipFiles: ['<node_internals>/**'],
      // The applications' TypeScript is transpiled in memory, with inline
      // source maps: breakpoints in their .ts files bind wherever they live
      resolveSourceMapLocations: ['**', '!**/node_modules/**']
    };

    // testRun ties the session to the run in the Testing view: stopping one
    // stops the other. VS Code learnt it after 1.90, which ignores it
    const options = { testRun: run } as vscode.DebugSessionOptions;
    const attached = await vscode.debug.startDebugging(folder, configuration, options);

    if (!attached) {
      running.cancel('The debugger could not attach');
      return;
    }

    // Stopping the debugger stops the run it was attached to
    const subscription = vscode.debug.onDidTerminateDebugSession(session => {
      if (session.configuration.port !== port) { return; }
      subscription.dispose();
      if (!over()) { running.cancel(STOPPED); }
    });
  }

  dispose() {
    this.pending.forEach(timer => clearTimeout(timer));
    this.disposables.forEach(disposable => disposable.dispose());
  }
}

export type { FlowEntry };
