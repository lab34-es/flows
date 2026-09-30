/**
 * The ronsel command line, as a flow sees it.
 *
 * Every method spawns the compiled CLI (`dist/cli.js`, see env/ci.env) in a
 * separate process, exactly as a person or a pipeline would run it, and
 * brings back what it printed and how it exited. Nothing here reaches into
 * the package: a flow written against this application is a test of the
 * shipped command, not of its internals.
 *
 * The commands run against a scratch context: an empty temporary folder
 * furnished with the bundled examples, the way ronsel furnishes an empty
 * folder on first start. It is created once per process, so the steps of a
 * flow (and the flows of a view) see the same folder, in order.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applications } from 'ronsel';
import type { Context, Parameters } from 'ronsel';

/** This application lives in e2e/applications/ronsel-cli of the repository. */
const repositoryRoot = (ctx: Context) => path.resolve(ctx.path, '..', '..', '..');

/** Colours and cursor movement, so assertions read what a person reads. */
const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');

let scratch: string | null = null;

/**
 * The context the commands run against, created on first use.
 *
 * `ronsel start` would furnish it too, but then goes on to serve the UI and
 * never exits; the examples are copied out of the build instead, which is
 * the same set of files that command lays down.
 */
const scratchContext = (ctx: Context) => {
  if (scratch) { return scratch; }

  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ronsel-e2e-cli-'));

  const defaults = path.join(repositoryRoot(ctx), path.dirname(ctx.env.CLI || 'dist/cli.js'), 'defaults');
  for (const folder of ['applications', 'flows']) {
    fs.cpSync(path.join(defaults, folder), path.join(scratch, folder), { recursive: true });
  }

  return scratch;
};

interface Invocation {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run the CLI once and wait for it to exit.
 * @param {Context} ctx
 * @param {string[]} args - Everything after `ronsel`
 */
const invoke = (ctx: Context, args: string[]): Promise<Invocation> => {
  const cli = path.resolve(repositoryRoot(ctx), ctx.env.CLI || 'dist/cli.js');
  const timeout = parseInt(ctx.env.TIMEOUT_MS || '60000', 10);

  return new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], {
      cwd: repositoryRoot(ctx),
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0' }
    }, (error, stdout, stderr) => {
      // execFile reports a non-zero exit as an error; the exit code is what
      // a flow asserts, so it is answered rather than thrown
      const exitCode = error ? (typeof error.code === 'number' ? error.code : null) : 0;

      resolve({
        command: ['ronsel', ...args].join(' '),
        exitCode,
        stdout: stripAnsi(String(stdout)),
        stderr: stripAnsi(String(stderr))
      });
    });
  });
};

/**
 * The version the repository's package.json names -- the one every
 * `--version`, banner and UI title has to agree with.
 *
 * @returns {200} The version.
 * ```json
 * { "version": "1.2.3" }
 * ```
 * @memory {write} version - For a later step to compare against.
 * @example
 * application: ronsel-cli
 * method: packageVersion
 * test:
 *   status: 200
 */
export const packageVersion = applications.handler([
  async (ctx: Context) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot(ctx), 'package.json'), 'utf8'));
    return [{}, 200, { version: manifest.version }, { version: manifest.version }];
  }
], 'packageVersion');

/**
 * Run `ronsel` with the given arguments and wait for it to exit.
 *
 * @param {string[]} body.args - The arguments, one per item, e.g. `["--file", "flows/a.md", "--env", "local"]`.
 * @param {boolean} [body.context=false] - Add `--context <scratch>`: run against
 *   the scratch context, an empty folder furnished with the bundled examples.
 * @returns {200 | 400} 200 when the command exited 0, 400 otherwise. Either
 *   way the body carries the exit code and what was printed, with colours
 *   stripped.
 * ```json
 * { "command": "ronsel --version", "exitCode": 0, "stdout": "1.2.3\n", "stderr": "" }
 * ```
 * @memory {write} lastExitCode - How the command exited.
 * @example
 * application: ronsel-cli
 * method: run
 * parameters:
 *   body:
 *     args: ["--version"]
 * test:
 *   status: 200
 *   body:
 *     exitCode: 0
 */
export const run = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const body = (parameters || {}).body || {};
    const args = Array.isArray(body.args) ? body.args.map(String) : [];

    if (body.context) {
      args.push('--context', scratchContext(ctx));
    }

    const result = await invoke(ctx, args);

    return [{}, result.exitCode === 0 ? 200 : 400, result, { lastExitCode: result.exitCode }];
  }
], 'run');

/**
 * The runs the CLI recorded in the scratch context, newest first: what
 * `test-runs/<id>/run.json` says about each.
 *
 * @returns {200} The runs, as `{ id, trigger, environment, status, flows }`.
 * ```json
 * { "total": 1, "runs": [{ "id": "2026-01-01T10-00-00-local", "trigger": "cli", "status": "passed" }] }
 * ```
 * @example
 * application: ronsel-cli
 * method: testRuns
 * test:
 *   status: 200
 *   body:
 *     total: 1
 */
export const testRuns = applications.handler([
  async (ctx: Context) => {
    const root = path.join(scratchContext(ctx), 'test-runs');
    const runs: any[] = [];

    if (fs.existsSync(root)) {
      for (const id of fs.readdirSync(root).sort().reverse()) {
        const summary = path.join(root, id, 'run.json');
        if (!fs.existsSync(summary)) { continue; }

        const { trigger, environment, status, flows } = JSON.parse(fs.readFileSync(summary, 'utf8'));
        runs.push({
          id,
          trigger,
          environment,
          status,
          flows: (flows || []).map((flow: any) => ({ file: flow.file, status: flow.status }))
        });
      }
    }

    return [{}, 200, { total: runs.length, runs }, {}];
  }
], 'testRuns');
