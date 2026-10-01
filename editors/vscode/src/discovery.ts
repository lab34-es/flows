import os from 'os';
import path from 'path';
import * as vscode from 'vscode';

import { contextOf, isContext } from './core/contexts';

/**
 * The contexts this window shows: the folders of the workspace that hold
 * flows, and the ones `ronsel.contexts` adds from anywhere else -- which is
 * how the flows of another repository are run while working on this one.
 *
 * It also watches them. Whoever cares about a change hears about it: a flow
 * written, a run recorded (by this window, the CLI or the web UI), an env
 * file added.
 */

/** A context, as the editor knows it. */
export interface RonselContext {
  /** The context folder */
  root: string;
  /** How it is shown: its folder's name, or more of its path when two share one */
  name: string;
  /** Its flows folder */
  flowsDir: string;
  /** Named in the settings rather than found */
  configured: boolean;
}

/** A flow file, or a folder of them, written or removed. */
export interface FlowChange {
  context: RonselContext;
  uri: vscode.Uri;
  deleted: boolean;
}

/** Folders a search never takes for flows folders. */
const ALWAYS_EXCLUDED = ['**/node_modules/**', '**/.git/**', '**/test-runs/**'];

/** How many flow files the search looks at, at most. */
const SEARCH_LIMIT = 20000;

/** A path from the settings: `~` is the home folder, and relative is to the first workspace folder. */
export const resolveSetting = (entry: string): string | null => {
  const value = String(entry || '').trim();
  if (!value) { return null; }

  const expanded = value === '~' || value.startsWith('~/') || value.startsWith('~\\')
    ? path.join(os.homedir(), value.slice(1))
    : value;

  if (path.isAbsolute(expanded)) { return path.normalize(expanded); }

  const first = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return first ? path.resolve(first.uri.fsPath, expanded) : null;
};

export class Contexts implements vscode.Disposable {
  private list: RonselContext[] = [];
  private watchers: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private refreshing: Promise<void> | null = null;
  private again = false;
  private settled: Promise<void>;
  private settle: () => void = () => {};

  private readonly changed = new vscode.EventEmitter<void>();
  /** The list of contexts changed */
  readonly onDidChange = this.changed.event;

  private readonly flowChanged = new vscode.EventEmitter<FlowChange>();
  /** A flow file, or a folder of them, was written or removed */
  readonly onDidChangeFlow = this.flowChanged.event;

  private readonly runsChanged = new vscode.EventEmitter<RonselContext>();
  /** A run was recorded, updated or removed */
  readonly onDidChangeRuns = this.runsChanged.event;

  private readonly environmentsChanged = new vscode.EventEmitter<RonselContext>();
  /** An env file was added or removed */
  readonly onDidChangeEnvironments = this.environmentsChanged.event;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.settled = new Promise(resolve => { this.settle = resolve; });

    // A flows folder appearing anywhere in the workspace may be a new context
    const anywhere = vscode.workspace.createFileSystemWatcher('**/flows/**/*.{md,markdown}', false, true, true);
    anywhere.onDidCreate(uri => {
      const root = contextOf(uri.fsPath);
      if (root && !this.list.some(context => context.root === root)) {
        void this.refresh();
      }
    });

    this.disposables.push(
      anywhere,
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('ronsel.contexts') || event.affectsConfiguration('ronsel.exclude')) {
          void this.refresh();
        }
      })
    );
  }

  /** Every context, by name. */
  get all(): RonselContext[] {
    return this.list;
  }

  /** Resolves once the first search is over. */
  get ready(): Promise<void> {
    return this.settled;
  }

  /**
   * The context a file is part of: the innermost one holding it.
   * @param {string} file
   * @returns {RonselContext|undefined}
   */
  of(file: string): RonselContext | undefined {
    return this.list
      .filter(context => file === context.root || file.startsWith(context.root + path.sep))
      .sort((a, b) => b.root.length - a.root.length)[0];
  }

  /** Look for the contexts again. Calls made while one is under way are folded into one more. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }

    this.refreshing = (async () => {
      do {
        this.again = false;
        try {
          await this.search();
        }
        catch (ex) {
          this.log.error('Could not look for flows:', ex);
        }
      } while (this.again);
    })().finally(() => {
      this.refreshing = null;
      this.settle();
    });

    return this.refreshing;
  }

  private async search() {
    const config = vscode.workspace.getConfiguration('ronsel');
    const found = new Map<string, boolean>();

    for (const entry of config.get<string[]>('contexts', [])) {
      const root = resolveSetting(entry);
      if (root && isContext(root)) {
        found.set(root, true);
      }
      else if (root && isContext(path.dirname(root)) && path.basename(root) === 'flows') {
        // The flows folder itself was named: its context is the folder above
        found.set(path.dirname(root), true);
      }
      else {
        this.log.warn(`ronsel.contexts: "${entry}" is not a folder with flows/ and applications/ in it`);
      }
    }

    for (const folder of vscode.workspace.workspaceFolders || []) {
      if (folder.uri.scheme === 'file' && isContext(folder.uri.fsPath) && !found.has(folder.uri.fsPath)) {
        found.set(folder.uri.fsPath, false);
      }
    }

    const exclude = [...ALWAYS_EXCLUDED, ...config.get<string[]>('exclude', [])];
    const files = await vscode.workspace.findFiles('**/flows/**/*.{md,markdown}', `{${exclude.join(',')}}`, SEARCH_LIMIT);

    for (const uri of files) {
      const root = contextOf(uri.fsPath);
      if (root && !found.has(root)) {
        found.set(root, false);
      }
    }

    const roots = [...found.keys()];
    const names = roots.map(root => path.basename(root));

    this.list = roots
      .map((root, index) => ({
        root,
        // Two contexts called the same are told apart by where they are
        name: names.filter(name => name === names[index]).length > 1
          ? vscode.workspace.asRelativePath(root, true)
          : names[index],
        flowsDir: path.join(root, 'flows'),
        configured: Boolean(found.get(root))
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.log.info(`Flows found in ${this.list.length} folder(s): ${this.list.map(context => context.root).join(', ') || 'none'}`);

    this.watch();
    void vscode.commands.executeCommand('setContext', 'ronsel.hasContexts', this.list.length > 0);
    this.changed.fire();
  }

  /** One watcher per context, for its flows, its runs and its env files. */
  private watch() {
    this.watchers.forEach(watcher => watcher.dispose());
    this.watchers = [];

    for (const context of this.list) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(context.root), '{flows/**,test-runs/*/run.json,applications/*/env/*}')
      );

      const dispatch = (deleted: boolean) => (uri: vscode.Uri) => {
        const relative = path.relative(context.root, uri.fsPath).split(path.sep);
        if (relative[0] === 'flows') {
          this.flowChanged.fire({ context, uri, deleted });
        }
        else if (relative[0] === 'test-runs') {
          this.runsChanged.fire(context);
        }
        else if (relative[0] === 'applications') {
          this.environmentsChanged.fire(context);
        }
      };

      watcher.onDidCreate(dispatch(false));
      watcher.onDidChange(dispatch(false));
      watcher.onDidDelete(dispatch(true));
      this.watchers.push(watcher);
    }
  }

  dispose() {
    this.watchers.forEach(watcher => watcher.dispose());
    this.disposables.forEach(disposable => disposable.dispose());
    this.changed.dispose();
    this.flowChanged.dispose();
    this.runsChanged.dispose();
    this.environmentsChanged.dispose();
  }
}
