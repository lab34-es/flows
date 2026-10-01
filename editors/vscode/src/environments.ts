import * as vscode from 'vscode';

import { listEnvironments } from './core/contexts';
import type { Contexts, RonselContext } from './discovery';

/**
 * The environment flows run against.
 *
 * Every run needs one -- it is `--env` to the CLI -- and it is chosen once,
 * not on every run: the status bar shows it, and a click on it changes it,
 * the way an interpreter or a kit is chosen for a workspace. The choice is
 * this workspace's, remembered across sessions. Until there is one, `local`
 * is taken when a context has it, being what the examples and `ronsel start`
 * use; otherwise the first run asks.
 */

const KEY = 'ronsel.environment';
const DEFAULT = 'local';

export class Environments implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private chosen: string | undefined;

  private readonly changed = new vscode.EventEmitter<string | undefined>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly contexts: Contexts, private readonly state: vscode.Memento) {
    this.chosen = state.get<string>(KEY);

    this.item = vscode.window.createStatusBarItem('ronsel.environment', vscode.StatusBarAlignment.Left, 50);
    this.item.name = 'Ronsel Environment';
    this.item.command = 'ronsel.selectEnvironment';

    this.disposables.push(
      contexts.onDidChange(() => this.update()),
      contexts.onDidChangeEnvironments(() => this.update())
    );
    this.update();
  }

  /** Every environment the contexts declare, and which ones declare it. */
  available(): Map<string, RonselContext[]> {
    const found = new Map<string, RonselContext[]>();

    for (const context of this.contexts.all) {
      for (const environment of listEnvironments(context.root)) {
        found.set(environment, [...(found.get(environment) || []), context]);
      }
    }

    return new Map([...found.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  /** The environment runs use now, when there is one. */
  get current(): string | undefined {
    if (this.chosen) { return this.chosen; }

    const available = this.available();
    if (available.has(DEFAULT)) { return DEFAULT; }
    return available.size === 1 ? [...available.keys()][0] : undefined;
  }

  /**
   * The environment for a run: the current one, or the one picked now.
   * @returns {Promise<string|undefined>} undefined when nobody picked one
   */
  async ensure(): Promise<string | undefined> {
    return this.current || this.pick();
  }

  /** Ask which environment to use from now on. */
  async pick(): Promise<string | undefined> {
    const available = this.available();
    const current = this.current;

    if (!available.size) {
      void vscode.window.showWarningMessage(
        'There are no environments to run flows against. An environment is an env file of an application: ' +
        'applications/<application>/env/<environment>.env, in the flows folder.'
      );
      return undefined;
    }

    const several = this.contexts.all.length > 1;
    type Item = vscode.QuickPickItem & { environment: string };
    const items: Item[] = [...available.entries()].map(([environment, contexts]) => ({
      environment,
      label: environment,
      description: environment === current ? 'current' : undefined,
      detail: several ? contexts.map(context => context.name).join(', ') : undefined,
      iconPath: new vscode.ThemeIcon(environment === current ? 'check' : 'server-environment')
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Ronsel: Environment',
      placeHolder: 'The environment flows run against'
    });

    if (!picked) { return undefined; }

    this.chosen = picked.environment;
    await this.state.update(KEY, picked.environment);
    this.update();
    this.changed.fire(picked.environment);

    return picked.environment;
  }

  private update() {
    if (!this.contexts.all.length) {
      this.item.hide();
      return;
    }

    const current = this.current;
    const known = current !== undefined && this.available().has(current);

    this.item.text = `$(server-environment) ${current || 'No environment'}`;
    this.item.tooltip = current
      ? (known
        ? `Ronsel: flows run against "${current}". Click to change it.`
        : `Ronsel: "${current}" is not an environment of these flows any more. Click to pick another one.`)
      : 'Ronsel: pick the environment flows run against.';
    this.item.backgroundColor = current && !known ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.item.show();
  }

  dispose() {
    this.item.dispose();
    this.changed.dispose();
    this.disposables.forEach(disposable => disposable.dispose());
  }
}
