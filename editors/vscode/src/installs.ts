import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';

import { globalModules, locate } from './core/install';
import type { Install } from './core/install';
import { resolveSetting } from './discovery';
import type { RonselContext } from './discovery';

/**
 * Which ronsel, and which node, run a context's flows -- and what to do when
 * there is none: say so once, with the ways out.
 */
export class Installs {
  private globalRoot: Promise<string | null> | null = null;
  private readonly told = new Set<string>();

  constructor(private readonly log: vscode.LogOutputChannel) {}

  /** The node flows run with: `ronsel.nodePath`, or the one on the PATH. */
  node(): string {
    const configured = (vscode.workspace.getConfiguration('ronsel').get<string>('nodePath', '') || '').trim();
    if (!configured) { return 'node'; }

    // A bare name is a command on the PATH; anything else is a path
    return /[\\/]/.test(configured) || configured.startsWith('~')
      ? resolveSetting(configured) || configured
      : configured;
  }

  /**
   * The ronsel a context runs with, or null when there is none.
   * @param {RonselContext} context
   * @returns {Promise<Install|null>}
   */
  async locate(context: RonselContext): Promise<Install | null> {
    const configured = vscode.workspace.getConfiguration('ronsel').get<string>('cliPath', '');
    const folders = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath);

    const options = {
      configured: configured ? resolveSetting(configured) : null,
      folders
    };

    // npm is only asked about its global folder when nothing closer has ronsel
    const near = locate(context.root, options);
    if (near || options.configured) { return near; }

    if (!this.globalRoot) { this.globalRoot = globalModules(); }
    return locate(context.root, { ...options, globalRoot: await this.globalRoot });
  }

  /**
   * The ronsel a context runs with; when there is none, the person is told how
   * to get one -- once per context, rather than once per flow.
   * @param {RonselContext} context
   * @returns {Promise<Install|null>}
   */
  async require(context: RonselContext): Promise<Install | null> {
    const found = await this.locate(context);

    if (found) {
      this.log.info(`${context.name}: ronsel ${found.version || '(unknown version)'} at ${found.root}`);
      return found;
    }

    this.log.warn(`${context.name}: ronsel is not installed in ${context.root}, the workspace, or globally`);

    if (!this.told.has(context.root)) {
      this.told.add(context.root);
      void this.offer(context);
    }

    return null;
  }

  /** Say there is no ronsel for a context, and offer the ways to get one. */
  private async offer(context: RonselContext) {
    const hasManifest = fs.existsSync(path.join(context.root, 'package.json'));
    const here = `Install in ${context.name}`;
    const global = 'Install Globally';
    const configure = 'Set Path...';

    const answer = await vscode.window.showErrorMessage(
      `Ronsel is not installed for "${context.name}". Flows run with the ronsel the project depends on, ` +
      'or a global one.',
      ...(hasManifest ? [here] : []), global, configure
    );

    if (answer === here || answer === global) {
      const terminal = vscode.window.createTerminal({ name: 'Ronsel: install', cwd: context.root });
      terminal.show();
      terminal.sendText(answer === here ? 'npm install ronsel' : 'npm install -g ronsel');
      // A new install has to be looked for again
      this.globalRoot = null;
      this.told.delete(context.root);
    }
    else if (answer === configure) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'ronsel.cliPath');
    }
  }
}
