import path from 'path';
import * as vscode from 'vscode';

import { isContext, listViews } from './core/contexts';
import { Contexts } from './discovery';
import type { RonselContext } from './discovery';
import { Environments } from './environments';
import { Executions } from './executions';
import type { FlowNode, RunNode } from './executions';
import { Installs } from './installs';
import { Prompts } from './prompts';
import { Testing } from './testing';
import type { FlowEntry } from './testing';

/**
 * Ronsel in VS Code.
 *
 * Flows are tests (testing.ts): the Testing view lists them, a play button
 * runs them -- next to each flow, in the editor's title, in the explorer --
 * and every step of a flow gets its check or its cross in the gutter. Runs
 * land in the Executions panel (executions.ts), next to the terminal, along
 * with the ones started from the CLI or the web UI. The environment they run
 * against is one click away in the status bar (environments.ts).
 *
 * Nothing of ronsel is bundled: flows run with the ronsel each context
 * depends on, in a process of their own (core/process.ts), which reports
 * back over the IPC channel of `ronsel --ipc`.
 */
export function activate(extension: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Ronsel', { log: true });
  const contexts = new Contexts(log);
  const environments = new Environments(contexts, extension.workspaceState);
  const installs = new Installs(log);
  const prompts = new Prompts();
  const executions = new Executions(contexts);
  const testing = new Testing(contexts, environments, installs, prompts, log, executions);

  /** The context to act on: the only one, or the one picked. */
  const pickContext = async (purpose: string): Promise<RonselContext | undefined> => {
    await contexts.ready;
    const all = contexts.all;

    if (!all.length) {
      const add = 'Add Flows Folder...';
      const answer = await vscode.window.showInformationMessage('There are no Ronsel flows in this workspace.', add);
      if (answer === add) { await vscode.commands.executeCommand('ronsel.addContext'); }
      return undefined;
    }

    if (all.length === 1) { return all[0]; }

    const picked = await vscode.window.showQuickPick(
      all.map(context => ({ label: context.name, description: context.root, context })),
      { title: `Ronsel: ${purpose}`, placeHolder: 'Which flows folder' }
    );
    return picked?.context;
  };

  /** The flows a command means: the ones it was invoked on, the open one, or the one picked. */
  const flowsFor = async (uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<FlowEntry[]> => {
    await contexts.ready;

    const given = (uris && uris.length ? uris : uri ? [uri] : []);
    if (given.length) {
      const entries = given
        .map(candidate => testing.flowOf(candidate))
        .filter((entry): entry is FlowEntry => Boolean(entry));
      if (!entries.length) {
        void vscode.window.showWarningMessage('That is not a flow of a Ronsel flows folder.');
      }
      return entries;
    }

    const active = vscode.window.activeTextEditor && testing.flowOf(vscode.window.activeTextEditor.document.uri);
    if (active) { return [active]; }

    const all = testing.allFlows;
    if (!all.length) {
      await pickContext('Run Flow');
      return [];
    }

    const several = contexts.all.length > 1;
    const picked = await vscode.window.showQuickPick(
      all.map(entry => ({
        label: String(entry.item.label),
        description: entry.file,
        detail: several ? entry.context.name : undefined,
        entry
      })),
      { title: 'Ronsel: Run Flow', placeHolder: 'The flow to run', matchOnDescription: true, matchOnDetail: true }
    );
    return picked ? [picked.entry] : [];
  };

  const runFlows = (debug: boolean) => async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
    const entries = await flowsFor(uri, uris);
    if (entries.length) { await testing.runFlows(entries, debug); }
  };

  extension.subscriptions.push(
    log, contexts, environments, prompts, executions, testing,

    vscode.commands.registerCommand('ronsel.runFlow', runFlows(false)),
    vscode.commands.registerCommand('ronsel.debugFlow', runFlows(true)),

    vscode.commands.registerCommand('ronsel.runView', async () => {
      const context = await pickContext('Run View');
      if (!context) { return; }

      let views: string[];
      try {
        views = listViews(context.root);
      }
      catch (ex) {
        void vscode.window.showErrorMessage((ex as Error).message);
        return;
      }

      const view = views.length === 1
        ? views[0]
        : (await vscode.window.showQuickPick(views, { title: 'Ronsel: Run View', placeHolder: 'Every flow the view matches runs, as one run' }));
      if (view) { await testing.runView(context, view); }
    }),

    vscode.commands.registerCommand('ronsel.selectEnvironment', () => environments.pick()),

    vscode.commands.registerCommand('ronsel.refresh', async () => {
      await contexts.refresh();
      executions.refresh();
    }),

    vscode.commands.registerCommand('ronsel.addContext', async () => {
      const [folder] = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Add Flows Folder',
        title: 'A folder with flows/ and applications/ in it'
      }) || [];
      if (!folder) { return; }

      // The flows folder itself, picked by mistake, means the folder above it
      let root = folder.fsPath;
      if (!isContext(root) && path.basename(root) === 'flows' && isContext(path.dirname(root))) {
        root = path.dirname(root);
      }

      if (!isContext(root)) {
        void vscode.window.showWarningMessage(`${root} has no flows/ folder with applications/ next to it: it is not a Ronsel flows folder.`);
        return;
      }

      const config = vscode.workspace.getConfiguration('ronsel');
      const current = config.get<string[]>('contexts', []);
      if (!current.includes(root)) {
        const target = vscode.workspace.workspaceFolders
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
        await config.update('contexts', [...current, root], target);
      }
      await contexts.refresh();
    }),

    vscode.commands.registerCommand('ronsel.openUI', async () => {
      const context = await pickContext('Open Web UI');
      if (!context) { return; }

      const install = await installs.require(context);
      if (!install) { return; }

      const terminal = vscode.window.createTerminal({
        name: `Ronsel UI: ${context.name}`,
        cwd: context.root,
        shellPath: installs.node(),
        shellArgs: [install.script, '--context', context.root],
        iconPath: new vscode.ThemeIcon('globe')
      });
      terminal.show();
    }),

    vscode.commands.registerCommand('ronsel.showLog', () => log.show()),

    vscode.commands.registerCommand('ronsel.executions.open', (file: string, line?: number) => executions.open(file, line)),

    vscode.commands.registerCommand('ronsel.executions.rerun', async (node?: RunNode | FlowNode) => {
      if (!node) { return; }
      const run = node.kind === 'run' ? node : node.run;
      const files = node.kind === 'run' ? run.record.summary.flows.map(flow => flow.file) : [node.flow.file];
      const environment = run.record.summary.environment || await environments.ensure();
      if (environment) { await testing.rerun(run.context, files, environment); }
    }),

    vscode.commands.registerCommand('ronsel.executions.openReport', (node?: RunNode) => node && executions.openReport(node)),
    vscode.commands.registerCommand('ronsel.executions.revealFolder', (node?: RunNode) => node && executions.revealFolder(node)),

    vscode.window.onDidChangeActiveTextEditor(() => testing.publishActive())
  );

  void contexts.refresh();
}

export function deactivate() {
  // Everything is disposed with the extension's subscriptions; a run still
  // going loses its channel, and ronsel --ipc ends a run whose editor left
}
