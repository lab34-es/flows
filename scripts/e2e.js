#!/usr/bin/env node
/**
 * Run ronsel's own flows with ronsel.
 *
 * The context is e2e/: two applications that drive the compiled package --
 * ronsel-cli spawns dist/cli.js, ronsel-api talks to a running API -- and the
 * flows under e2e/flows. This script provides the one thing the flows cannot
 * arrange for themselves: the API, started on an empty scratch context that
 * ronsel furnishes with its bundled examples, exactly as a first start does.
 *
 * Then it is a plain `ronsel --view`: every flow the view matches runs as one
 * test run, and the exit code is the view's. CI hangs on that exit code (the
 * e2e job of .github/workflows/ci.yml), and so does `npm run e2e`.
 *
 *   npm run build && npm run e2e
 *   npm run e2e -- --view nightly        # another view of e2e/views.yaml
 *
 * Everything runs from dist/, so build first: what is tested is what ships.
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const context = path.join(root, 'e2e');
const api = path.join(root, 'dist', 'api.js');
const cli = path.join(root, 'dist', 'cli.js');

const PORT = 3001;
const ENVIRONMENT = 'ci';
const DEFAULT_VIEW = 'cicd-pr-ronsel';
const API_START_TIMEOUT_MS = 30000;

const argv = process.argv.slice(2);
const viewIndex = argv.indexOf('--view');
const view = viewIndex >= 0 && argv[viewIndex + 1] ? argv[viewIndex + 1] : DEFAULT_VIEW;

if (!fs.existsSync(api) || !fs.existsSync(cli)) {
  console.error('dist/ is not built. Run "npm run build" first: the flows test the compiled package.');
  process.exit(1);
}

/** Resolves once the API answers, rejects when it does not within the timeout. */
const waitForApi = (child) => new Promise((resolve, reject) => {
  const started = Date.now();

  const attempt = () => {
    if (child.exitCode !== null) {
      reject(new Error(`The API exited with code ${child.exitCode} before answering`));
      return;
    }

    if (Date.now() - started > API_START_TIMEOUT_MS) {
      reject(new Error(`The API did not answer on :${PORT} within ${API_START_TIMEOUT_MS}ms`));
      return;
    }

    http.get({ host: '127.0.0.1', port: PORT, path: '/api/context' }, (res) => {
      res.resume();
      resolve();
    }).on('error', () => setTimeout(attempt, 250));
  };

  attempt();
});

const main = async () => {
  // An empty folder is the point: ronsel seeds the examples into it on start,
  // and the flows count on exactly that set of files
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ronsel-e2e-api-'));

  // The API's own output goes to a file: it includes the failing run a flow
  // deliberately starts, which would read as a failure of this script. It is
  // printed only when the view fails, which is when it helps. The file sits
  // next to the scratch folder, not in it: a folder with anything in it is
  // served as it is, and would never get the examples
  const apiLog = `${scratch}.log`;
  const log = fs.openSync(apiLog, 'w');

  console.log(`API context: ${scratch}`);
  const server = spawn(process.execPath, [api, '--context', scratch], {
    cwd: root,
    stdio: ['ignore', log, log],
    env: { ...process.env, FORCE_COLOR: '0' }
  });

  let code = 1;
  try {
    await waitForApi(server);

    console.log(`\nView: ${view}  Environment: ${ENVIRONMENT}  Context: ${context}\n`);
    code = await new Promise((resolve) => {
      const runner = spawn(process.execPath, [
        cli, '--context', context, '--view', view, '--env', ENVIRONMENT
      ], { cwd: root, stdio: 'inherit', env: { ...process.env, FORCE_COLOR: '0' } });

      runner.on('exit', (exitCode) => resolve(exitCode === null ? 1 : exitCode));
    });
  }
  catch (error) {
    console.error(error.message);
  }
  finally {
    server.kill();
    fs.closeSync(log);
  }

  if (code !== 0) {
    console.error(`\nThe API's output (${apiLog}):\n`);
    console.error(fs.readFileSync(apiLog, 'utf8'));
  }

  process.exit(code);
};

main();
