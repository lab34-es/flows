import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';

import { parseFlow } from './core/flowParser';
import { elapsed, formatDuration, formatStart, runLabel, runScore } from './core/format';
import { copyOf, listRuns, readSteps } from './core/history';
import type { RunRecord, StepRecord } from './core/history';
import type { RunSummary } from './core/tracker';
import type { Contexts, RonselContext } from './discovery';
import type { LiveStep, RunObserver } from './testing';

/**
 * The Executions panel: every run of every context, newest first, in the
 * panel next to the terminal -- each run, its flows, and each flow's steps
 * with a check or a cross.
 *
 * Runs are read from the contexts' test-runs folders, so a run started from
 * the CLI or the web UI is here as well as the ones started from the editor,
 * and the panel follows those folders as they change. The runs this window
 * drives are followed step by step, before their copies are written.
 */

type Status = 'pending' | 'running' | 'passed' | 'failed' | 'errored' | 'skipped';

interface RunNode {
  kind: 'run';
  context: RonselContext;
  record: RunRecord;
}

interface FlowNode {
  kind: 'flow';
  run: RunNode;
  flow: RunSummary['flows'][number];
}

interface StepNode {
  kind: 'step';
  flow: FlowNode;
  label: string;
  status: Status;
  duration?: number;
  error?: string;
  /** Where clicking it goes */
  target: { file: string; line: number };
}

type Node = RunNode | FlowNode | StepNode;

/** How a status looks: the icons and colours of the Testing view. */
const ICONS: Record<Status, vscode.ThemeIcon> = {
  pending: new vscode.ThemeIcon('history', new vscode.ThemeColor('testing.iconQueued')),
  running: new vscode.ThemeIcon('loading~spin'),
  passed: new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed')),
  failed: new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')),
  errored: new vscode.ThemeIcon('issues', new vscode.ThemeColor('testing.iconErrored')),
  skipped: new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('testing.iconSkipped'))
};

/** A status as the run wrote it, as the panel shows it. */
const statusOf = (value: string | undefined): Status => {
  switch (value) {
    case 'running':
    case 'passed':
    case 'failed':
    case 'skipped':
    case 'errored':
      return value;
    case 'error':
      return 'errored';
    default:
      return 'pending';
  }
};

/** A line of an error, short enough for a tree. */
const short = (text: string | undefined) => {
  const line = String(text || '').split('\n')[0];
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
};

const liveKey = (context: RonselContext, runId: string, file: string) => `${context.root}\n${runId}\n${file}`;

export class Executions implements vscode.TreeDataProvider<Node>, RunObserver, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined | void>();
  readonly onDidChangeTreeData = this.changed.event;

  readonly view: vscode.TreeView<Node>;
  private readonly live = new Map<string, Map<number, LiveStep>>();
  /** Runs this window started and has not shown yet */
  private readonly reveal = new Set<string>();
  /** Runs this window started: each is shown once */
  private readonly started = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly contexts: Contexts) {
    this.view = vscode.window.createTreeView('ronsel.executions', { treeDataProvider: this, showCollapseAll: true });

    this.disposables.push(
      this.view,
      contexts.onDidChange(() => this.refresh()),
      contexts.onDidChangeRuns(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('ronsel.executions')) { this.refresh(); }
      })
    );
  }

  /** Read the runs again, soon: changes come in bursts. */
  refresh() {
    if (this.refreshTimer) { return; }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.changed.fire();
      void this.revealNew();
    }, 150);
  }

  /* ----------------------------------------------- runs this window drives */

  run(context: RonselContext, run: RunSummary) {
    const key = `${context.root}\n${run.id}`;

    if (!this.started.has(key)) {
      this.started.add(key);
      this.reveal.add(key);
    }

    if (run.status !== 'running') {
      // The copies are on disk now: they say the rest
      for (const flow of run.flows) { this.live.delete(liveKey(context, run.id, flow.file)); }
    }

    this.refresh();
  }

  step(context: RonselContext, runId: string, file: string, index: number, state: LiveStep) {
    const key = liveKey(context, runId, file);
    const steps = this.live.get(key) || new Map<number, LiveStep>();
    steps.set(index, state);
    this.live.set(key, steps);
    this.refresh();
  }

  /** Show the panel on a run this window just started, when that is wanted. */
  private async revealNew() {
    if (!this.reveal.size) { return; }

    const wanted = vscode.workspace.getConfiguration('ronsel').get<boolean>('executions.revealOnRun', true);
    const nodes = await this.getChildren();

    for (const node of nodes as RunNode[]) {
      const key = `${node.context.root}\n${node.record.id}`;
      if (!this.reveal.has(key)) { continue; }
      this.reveal.delete(key);
      if (wanted) {
        await this.view.reveal(node, { select: false, focus: false, expand: true }).then(undefined, () => undefined);
      }
    }
  }

  /* ---------------------------------------------------------------- the tree */

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      const limit = vscode.workspace.getConfiguration('ronsel').get<number>('executions.limit', 50);
      return this.contexts.all
        .flatMap(context => listRuns(context.root, limit).map(record => ({ kind: 'run', context, record }) as RunNode))
        .sort((a, b) => ((b.record.summary.times?.start || 0) - (a.record.summary.times?.start || 0)))
        .slice(0, limit);
    }

    if (node.kind === 'run') {
      return node.record.summary.flows.map(flow => ({ kind: 'flow', run: node, flow }) as FlowNode);
    }

    if (node.kind === 'flow') {
      return this.stepsOf(node);
    }

    return [];
  }

  getParent(node: Node): Node | undefined {
    if (node.kind === 'flow') { return node.run; }
    if (node.kind === 'step') { return node.flow; }
    return undefined;
  }

  /** A flow's steps: from its copy once written, as they go while it runs. */
  private stepsOf(node: FlowNode): StepNode[] {
    const { run, flow } = node;
    const copy = copyOf(run.record, flow.file);
    const recorded = copy && flow.status !== 'running' && flow.status !== 'pending' ? readSteps(copy) : null;

    if (recorded) {
      return recorded.map((step: StepRecord) => ({
        kind: 'step',
        flow: node,
        label: step.label,
        status: statusOf(step.status),
        ...(step.duration !== undefined ? { duration: step.duration } : {}),
        ...(step.error ? { error: step.error } : {}),
        target: { file: copy as string, line: step.resultLine ?? step.line }
      }));
    }

    // Not written yet: the flow's own document, and what this window heard
    const source = path.join(run.context.flowsDir, ...flow.file.split('/'));
    let text: string;
    try {
      text = fs.readFileSync(source, 'utf8');
    }
    catch {
      return [];
    }

    const live = this.live.get(liveKey(run.context, run.record.id, flow.file));

    return parseFlow(text).steps.map(step => {
      const state = live && live.get(step.index);
      return {
        kind: 'step',
        flow: node,
        label: step.label,
        status: state ? statusOf(state.status) : 'pending',
        ...(state && state.duration !== undefined ? { duration: state.duration } : {}),
        ...(state && state.error ? { error: state.error } : {}),
        target: { file: source, line: step.line }
      };
    });
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'run') { return this.runItem(node); }
    if (node.kind === 'flow') { return this.flowItem(node); }
    return this.stepItem(node);
  }

  private runItem(node: RunNode): vscode.TreeItem {
    const { summary } = node.record;
    const status = statusOf(summary.status);
    const several = this.contexts.all.length > 1;
    const duration = formatDuration(elapsed(summary.times));
    const start = summary.times?.start ? formatStart(summary.times.start) : null;

    const item = new vscode.TreeItem(runLabel(summary), status === 'running'
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed);

    item.id = `run\n${node.context.root}\n${node.record.id}`;
    item.iconPath = ICONS[status];
    item.description = [
      several ? node.context.name : null,
      summary.environment,
      runScore(summary),
      duration,
      start
    ].filter(Boolean).join(' · ');
    item.contextValue = status === 'running' ? 'run.running' : 'run';

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**${runLabel(summary)}** · ${summary.status}\n\n`);
    tooltip.appendMarkdown(`Environment: \`${summary.environment || '?'}\`  \n`);
    tooltip.appendMarkdown(`Started from: ${summary.trigger || '?'}${summary.view ? ` (view ${summary.view})` : ''}  \n`);
    tooltip.appendMarkdown(`Flows: ${runScore(summary)} passed${duration ? ` in ${duration}` : ''}  \n`);
    tooltip.appendMarkdown(`Run: \`${node.record.id}\` in ${node.context.name}`);
    item.tooltip = tooltip;

    return item;
  }

  private flowItem(node: FlowNode): vscode.TreeItem {
    const { flow, run } = node;
    const status = statusOf(flow.status);
    const item = new vscode.TreeItem(flow.title || flow.file, vscode.TreeItemCollapsibleState.Collapsed);

    item.id = `flow\n${run.context.root}\n${run.record.id}\n${flow.file}`;
    item.iconPath = ICONS[status];
    item.description = [
      flow.title && flow.title !== flow.file ? flow.file : null,
      formatDuration(elapsed(flow.times)),
      short(flow.error) || null
    ].filter(Boolean).join(' · ');
    item.tooltip = flow.error ? `${flow.file}\n\n${flow.error}` : flow.file;
    item.contextValue = 'flow';

    const copy = copyOf(run.record, flow.file);
    const target = copy && fs.existsSync(copy) ? copy : path.join(run.context.flowsDir, ...flow.file.split('/'));
    item.command = { command: 'ronsel.executions.open', title: 'Open', arguments: [target, 0] };

    return item;
  }

  private stepItem(node: StepNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);

    item.id = `step\n${node.flow.run.context.root}\n${node.flow.run.record.id}\n${node.flow.flow.file}\n${node.target.line}`;
    item.iconPath = ICONS[node.status];
    item.description = [formatDuration(node.duration), short(node.error) || null].filter(Boolean).join(' · ') || undefined;
    item.tooltip = node.error ? `${node.label}\n\n${node.error}` : node.label;
    item.contextValue = 'step';
    item.command = { command: 'ronsel.executions.open', title: 'Open', arguments: [node.target.file, node.target.line] };

    return item;
  }

  /* ------------------------------------------------------------- commands */

  /** Open a file of a run, at a line: a flow's copy, at a step's result. */
  async open(file: string, line = 0) {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const position = new vscode.Position(Math.min(line, Math.max(0, document.lineCount - 1)), 0);
    // A preview that leaves the focus in the panel, as the Problems panel
    // opens what is clicked in it: the next row is one arrow key away
    await vscode.window.showTextDocument(document, {
      preview: true,
      preserveFocus: true,
      selection: new vscode.Range(position, position)
    });
  }

  /** The run's HTML report, in the browser. */
  async openReport(node: RunNode) {
    const report = path.join(node.record.dir, 'report.html');

    if (!fs.existsSync(report)) {
      void vscode.window.showInformationMessage('This run has no report yet: it is written when the run ends.');
      return;
    }

    await vscode.env.openExternal(vscode.Uri.file(report));
  }

  /** The run folder, in the system's file manager -- or the explorer, remotely. */
  async revealFolder(node: RunNode) {
    const uri = vscode.Uri.file(node.record.dir);
    await vscode.commands.executeCommand(vscode.env.remoteName ? 'revealInExplorer' : 'revealFileInOS', uri);
  }

  dispose() {
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
    this.changed.dispose();
    this.disposables.forEach(disposable => disposable.dispose());
  }
}

export type { FlowNode, Node, RunNode, StepNode };
