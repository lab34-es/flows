// cli.ts parses argv and runs main() as a side effect of being imported, so
// each case sets ARGV and re-imports the module in isolation.
let ARGV: Record<string, any> = {};
jest.mock('yargs-parser', () => () => ARGV);

jest.mock('../src/helpers/paths');
jest.mock('../src/helpers/applications');
jest.mock('../src/helpers/flows');
jest.mock('../src/helpers/markdownFlows');
jest.mock('../src/helpers/runner/v1');
jest.mock('../src/helpers/testRuns', () => ({
  copyFileName: jest.fn(async () => 'a.md'),
  single: jest.fn(async () => ({ run: { id: 'run-1' }, onFinished: jest.fn(), discard: jest.fn() })),
  runViewFromCli: jest.fn()
}));
jest.mock('../src/helpers/bases', () => ({
  ...jest.requireActual('../src/helpers/bases'),
  load: jest.fn()
}));
jest.mock('../src/helpers/envTransfer', () => ({
  importFile: jest.fn(),
  reportLines: jest.fn(() => ['  created applications/payments/env/uat.env — 2 added'])
}));
jest.mock('../src/helpers/reporter', () => ({ get: jest.fn(() => ({ server: { emit: jest.fn() } })) }));
// Whether anybody is there to answer the context question. Read on every
// call, so a case can turn the terminal on and off.
let INTERACTIVE = false;
jest.mock('../src/helpers/cli', () => ({
  logo: jest.fn(),
  wisdom: jest.fn(),
  confirm: jest.fn(),
  get isInteractive() { return INTERACTIVE; }
}));
jest.mock('../src/helpers/bootstrap', () => ({
  ensureTypeScriptConfig: jest.fn().mockResolvedValue(undefined),
  initialise: jest.fn().mockResolvedValue(undefined),
  isEmptyDirectory: jest.fn(() => false),
  isContextDirectory: jest.fn(() => true)
}));
jest.mock('../src/helpers/project', () => ({
  ...jest.requireActual('../src/helpers/project'),
  ensurePackageJson: jest.fn(),
  ensureGitignore: jest.fn(() => []),
  isInstalled: jest.fn(() => true),
  install: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../src/helpers/browsers', () => ({
  ensure: jest.fn().mockResolvedValue({ status: 'ready', browsers: [] })
}));
// The API picks its own port, so the URL is whatever it hands back
jest.mock('../src/api', () => ({ start: jest.fn().mockResolvedValue('http://127.0.0.1:3457') }));
// No test run opens a browser; whether one would be is decided here
jest.mock('../src/helpers/browser', () => ({
  wanted: jest.fn(() => true),
  open: jest.fn(() => true)
}));

const spawn = jest.fn();
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: (...a: any[]) => spawn(...a) }));

import fs from 'fs';

import * as paths from '../src/helpers/paths';
import * as cliHelper from '../src/helpers/cli';
import * as bootstrap from '../src/helpers/bootstrap';
import * as applications from '../src/helpers/applications';
import * as flows from '../src/helpers/flows';
import * as markdownFlows from '../src/helpers/markdownFlows';
import * as runner from '../src/helpers/runner/v1';
import * as testRuns from '../src/helpers/testRuns';
import * as bases from '../src/helpers/bases';
import * as envTransfer from '../src/helpers/envTransfer';
import * as project from '../src/helpers/project';
import * as browsers from '../src/helpers/browsers';
import * as api from '../src/api';
import * as browser from '../src/helpers/browser';

/** Import cli.ts fresh and let its async main() settle. */
const runCli = async () => {
  jest.isolateModules(() => { require('../src/cli'); });
  await new Promise(resolve => setImmediate(resolve));
};

/** The flow document every case runs, when a case runs one at all. */
const FLOW = '# t\n\n```step\napplication: a\nmethod: b\n```\n';

// Captured before anything spies on it. Only the flow document is faked
// below: a blanket mock also answers the reads jest itself makes while it
// transforms a module inside a test, which ends with its own tooling being
// parsed as markdown.
const readFileSync = fs.readFileSync;

const logged = () => (console.log as jest.Mock).mock.calls.map(c => c.join(' ')).join('\n');
const errored = () => (console.error as jest.Mock).mock.calls.map(c => c.join(' ')).join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  ARGV = {};
  // Nobody is watching unless the case says otherwise, so nothing is ever
  // asked and the working directory is taken as the context
  INTERACTIVE = false;
  (bootstrap.isEmptyDirectory as jest.Mock).mockReturnValue(false);
  (bootstrap.isContextDirectory as jest.Mock).mockReturnValue(true);
  (project.ensurePackageJson as jest.Mock).mockReturnValue({
    path: '/ctx/package.json', created: true, changes: ['created package.json'], scriptTaken: false
  });
  (project.ensureGitignore as jest.Mock).mockReturnValue([]);
  (project.isInstalled as jest.Mock).mockReturnValue(true);
  // clearAllMocks forgets the calls, not the implementations: a case that made
  // one of these fail would otherwise make every case after it fail too
  (project.install as jest.Mock).mockResolvedValue(undefined);
  (browsers.ensure as jest.Mock).mockResolvedValue({ status: 'ready', browsers: [] });
  (paths.contextDir as jest.Mock).mockImplementation(async (p: string) => `/ctx/${p}`);
  (applications.loadAll as jest.Mock).mockResolvedValue(undefined);
  (flows.listCapabilities as jest.Mock).mockResolvedValue(undefined);
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  jest.spyOn(fs, 'readFileSync').mockImplementation(((file: any, ...rest: any[]) => (
    typeof file === 'string' && /\.(md|markdown)$/i.test(file)
      ? FLOW
      : (readFileSync as any)(file, ...rest)
  )) as any);
  (markdownFlows.toFlow as jest.Mock).mockReturnValue({ title: 't', steps: [] });
  // What the flow needs before it can run: every case but the one that
  // checks it has it
  (applications.environmentReadiness as jest.Mock).mockResolvedValue({
    environment: 'local', environments: ['local'], known: true, applications: [], missing: [], ready: true
  });
  (applications.readinessError as jest.Mock).mockReturnValue(null);
  (bases.load as jest.Mock).mockResolvedValue(bases.normalizeDocument({
    views: [{ type: 'table', name: 'All flows' }, { type: 'table', name: 'Smoke tests' }]
  }));
  (envTransfer.importFile as jest.Mock).mockResolvedValue({
    file: '/ctx/env.yaml',
    dryRun: false,
    files: [{ file: 'applications/payments/env/uat.env', created: true, added: ['A', 'B'], changed: [], unchanged: [] }],
    skipped: [],
    summary: { files: 1, created: 1, updated: 0, added: 2, changed: 0, unchanged: 0, skipped: 0 }
  });
  (testRuns.runViewFromCli as jest.Mock).mockResolvedValue({
    id: 'run-9',
    status: 'passed',
    flows: [{ file: 'a.md', status: 'passed' }, { file: 'b.md', status: 'passed' }]
  });
});

afterEach(() => jest.restoreAllMocks());

describe('cli --v and --help', () => {
  test('--v prints the version and exits', async () => {
    ARGV = { v: true };
    await runCli();
    expect(logged()).toMatch(/^\d+\.\d+\.\d+$/m);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('--help prints the usage and exits', async () => {
    ARGV = { help: true };
    await runCli();
    expect(logged()).toContain('Ronsel CLI Tool');
    expect(logged()).toContain('--context');
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});

describe('cli --debug', () => {
  test('prints package, process and environment information', async () => {
    ARGV = { debug: true };
    await runCli();

    const out = logged();
    expect(out).toContain('=== DEBUG INFORMATION ===');
    expect(out).toContain('Package Name: ronsel');
    expect(out).toContain('Node Version:');
    expect(out).toContain('Environment Variables:');
    expect(out).toContain('__dirname:');
  });
});

describe('cli --capabilities', () => {
  test('lists the capabilities and exits cleanly', async () => {
    ARGV = { capabilities: true };
    await runCli();
    expect(flows.listCapabilities).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});

describe('cli --ai', () => {
  test('explains that AI generation moved to the UI', async () => {
    ARGV = { ai: 'make me a flow' };
    await runCli();
    expect(errored()).toContain('no longer available from the CLI');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('cli with nothing to run', () => {
  test('starts the API: whoever typed it came to look at the flows', async () => {
    ARGV = {};

    await runCli();

    expect(api.start).toHaveBeenCalled();
  });

  test('starts it on the context it was given, too', async () => {
    ARGV = { context: 'my/context' };

    await runCli();

    expect(api.start).toHaveBeenCalled();
  });

  // The UI ships pre-built inside the package: an installed copy has neither
  // the frontend sources nor a working directory it could build them from.
  test('never shells out to build the frontend', async () => {
    ARGV = {};

    await runCli();

    expect(spawn).not.toHaveBeenCalled();
  });

  test('opens the browser on the URL the API settled on, not on a guess', async () => {
    ARGV = {};

    await runCli();

    expect(browser.wanted).toHaveBeenCalledWith({ open: true });
    expect(browser.open).toHaveBeenCalledWith('http://127.0.0.1:3457');
  });

  test('--no-open starts the UI and leaves the browser alone', async () => {
    ARGV = { open: false };
    (browser.wanted as jest.Mock).mockReturnValueOnce(false);

    await runCli();

    expect(api.start).toHaveBeenCalled();
    expect(browser.wanted).toHaveBeenCalledWith({ open: false });
    expect(browser.open).not.toHaveBeenCalled();
  });

  test('--port and --host are handed to the API as they were written', async () => {
    ARGV = { port: '4000', host: true };

    await runCli();

    expect(api.start).toHaveBeenCalledWith({ port: '4000', host: true });
  });
});


describe('cli start', () => {
  beforeEach(() => {
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
  });

  test('furnishes the folder, writes the project and starts the UI on it', async () => {
    ARGV = { _: ['start'] };

    await runCli();

    expect(bootstrap.initialise).toHaveBeenCalled();
    expect(project.ensurePackageJson)
      .toHaveBeenCalledWith({ directory: process.cwd(), version: expect.any(String) });
    expect(project.ensureGitignore).toHaveBeenCalledWith(process.cwd());
    expect(project.install).toHaveBeenCalledWith(process.cwd());
    expect(paths.useContext).toHaveBeenCalledWith(process.cwd());
    expect(api.start).toHaveBeenCalled();
    expect(logged()).toContain('npm run ronsel');
  });

  test('--context names the folder, and it is created if it is not there', async () => {
    ARGV = { _: ['start'], context: 'somewhere/new' };

    await runCli();

    const directory = require('path').resolve(process.cwd(), 'somewhere/new');
    expect(fs.mkdirSync).toHaveBeenCalledWith(directory, { recursive: true });
    expect(project.ensurePackageJson)
      .toHaveBeenCalledWith({ directory, version: expect.any(String) });
  });

  test('--no-install writes everything and leaves the install to somebody else', async () => {
    ARGV = { _: ['start'], install: false };
    (project.isInstalled as jest.Mock).mockReturnValue(false);

    await runCli();

    expect(project.install).not.toHaveBeenCalled();
    expect(logged()).toContain('Run "npm install" first');
    expect(api.start).toHaveBeenCalled();
  });

  test('a folder holding somebody else\'s work is asked about, and no is no', async () => {
    ARGV = { _: ['start'] };
    INTERACTIVE = true;
    (bootstrap.isContextDirectory as jest.Mock).mockReturnValue(false);
    (cliHelper.confirm as jest.Mock).mockResolvedValue(false);

    await runCli();

    expect(cliHelper.confirm).toHaveBeenCalledWith(expect.stringContaining('already holds other files'));
    expect(project.ensurePackageJson).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('a run nobody is watching says what it is doing and gets on with it', async () => {
    ARGV = { _: ['start'] };
    (bootstrap.isContextDirectory as jest.Mock).mockReturnValue(false);

    await runCli();

    expect(cliHelper.confirm).not.toHaveBeenCalled();
    expect(project.ensurePackageJson).toHaveBeenCalled();
  });

  test('a "ronsel" script that is already theirs is reported, and the run goes on', async () => {
    ARGV = { _: ['start'] };
    (project.ensurePackageJson as jest.Mock).mockReturnValue({
      path: '/ctx/package.json', created: false, changes: [], scriptTaken: true
    });

    await runCli();

    expect(logged()).toContain('left as it is');
    expect(logged()).toContain('already set up: nothing to write');
    expect(api.start).toHaveBeenCalled();
  });

  test('a package.json that cannot be read stops it before anything is installed', async () => {
    ARGV = { _: ['start'] };
    (project.ensurePackageJson as jest.Mock).mockImplementation(() => {
      throw new Error('/ctx/package.json is not valid JSON');
    });

    await runCli();

    expect(errored()).toContain('is not valid JSON');
    expect(project.install).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });

  test('an install that fails leaves the files behind and says how to finish', async () => {
    ARGV = { _: ['start'] };
    (project.install as jest.Mock).mockRejectedValue(new Error('npm install exited with code 1'));

    await runCli();

    expect(errored()).toContain('npm install exited with code 1');
    expect(errored()).toContain('npm run ronsel');
    expect(api.start).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('the playwright browsers are looked for, with nothing said about them', async () => {
    ARGV = { _: ['start'] };

    await runCli();

    expect(browsers.ensure).toHaveBeenCalledWith({ install: undefined });
    expect(api.start).toHaveBeenCalled();
  });

  test('--install-browsers and --no-install-browsers answer before the question', async () => {
    ARGV = { _: ['start'], 'install-browsers': 'all' };
    await runCli();
    expect(browsers.ensure).toHaveBeenCalledWith({ install: 'all' });

    ARGV = { _: ['start'], installBrowsers: false };
    await runCli();
    expect(browsers.ensure).toHaveBeenLastCalledWith({ install: false });
  });

  test('a browser check that goes wrong never keeps the UI from starting', async () => {
    ARGV = { _: ['start'] };
    (browsers.ensure as jest.Mock).mockRejectedValue(new Error('no idea'));

    await runCli();

    expect((console.warn as jest.Mock).mock.calls.join(' ')).toContain('Skipping the browser check: no idea');
    expect(api.start).toHaveBeenCalled();
  });

  test('any other word is not a command', async () => {
    ARGV = { _: ['strat'] };

    await runCli();

    expect(errored()).toContain('Unknown command: strat');
    expect(api.start).not.toHaveBeenCalled();
  });
});

describe('cli context directory', () => {
  test('a run nobody is watching takes the working directory, saying so', async () => {
    ARGV = {};

    await runCli();

    expect(cliHelper.confirm).not.toHaveBeenCalled();
    expect(paths.useContext).toHaveBeenCalledWith(process.cwd());
    expect(logged()).toContain(`Context directory: ${process.cwd()}`);
  });

  test('--context is taken as given, without asking', async () => {
    ARGV = { context: 'my/context' };

    await runCli();

    expect(cliHelper.confirm).not.toHaveBeenCalled();
    expect(paths.useContext).not.toHaveBeenCalled();
  });

  test('asks before working in the directory it was run from', async () => {
    ARGV = {};
    INTERACTIVE = true;
    (cliHelper.confirm as jest.Mock).mockResolvedValue(true);

    await runCli();

    expect(cliHelper.confirm).toHaveBeenCalledWith(expect.stringContaining(process.cwd()));
    expect(paths.useContext).toHaveBeenCalledWith(process.cwd());
    expect(api.start).toHaveBeenCalled();
  });

  test('says the empty directory is about to get the examples', async () => {
    ARGV = {};
    INTERACTIVE = true;
    (cliHelper.confirm as jest.Mock).mockResolvedValue(true);
    (bootstrap.isEmptyDirectory as jest.Mock).mockReturnValue(true);

    await runCli();

    expect(cliHelper.confirm).toHaveBeenCalledWith(expect.stringContaining('It is empty'));
  });

  test('a no stops everything, and says how to name another folder', async () => {
    ARGV = {};
    INTERACTIVE = true;
    (cliHelper.confirm as jest.Mock).mockResolvedValue(false);

    await runCli();

    expect(paths.useContext).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
    expect(logged()).toContain('--context <directory>');
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});

describe('cli --file', () => {
  test('requires an environment', async () => {
    ARGV = { file: 'flows/a.md' };
    await runCli();
    expect(errored()).toContain('No environment specified');
  });

  test('reports a file that is not there', async () => {
    ARGV = { file: 'flows/nope.md', env: 'local' };
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    await runCli();

    expect(errored()).toContain('File not found');
  });

  test('rejects an unsupported extension', async () => {
    ARGV = { file: 'flows/a.txt', env: 'local' };
    await runCli();
    expect(errored()).toContain('File must be a .md or .markdown file');
  });

  test('runs the flow through the runner', async () => {
    ARGV = { file: 'flows/a.md', env: 'local' };
    await runCli();

    expect(applications.loadAll).toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ title: 't' }),
      expect.objectContaining({ environment: 'local', cli: true })
    );
  });

  test('records the run as a test run', async () => {
    ARGV = { file: 'flows/a.md', env: 'local' };
    await runCli();

    expect(testRuns.single).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'cli', environment: 'local', file: 'a.md' })
    );
    expect(runner.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ onFinished: expect.any(Function) })
    );
  });

  test('a flow whose applications have no env file never runs', async () => {
    (applications.environmentReadiness as jest.Mock).mockResolvedValue({
      environment: 'uat',
      environments: ['local', 'uat'],
      known: true,
      applications: ['payments'],
      missing: [{ application: 'payments', file: 'applications/payments/env/uat.env', path: '/x', hasTemplate: false }],
      ready: false
    });
    (applications.readinessError as jest.Mock).mockReturnValue(
      'Missing environment file for "uat": payments (applications/payments/env/uat.env).'
    );

    ARGV = { file: 'flows/a.md', env: 'uat' };
    await runCli();

    expect(errored()).toContain('applications/payments/env/uat.env');
    expect(runner.run).not.toHaveBeenCalled();
    // Nothing is recorded for a run that never started
    expect(testRuns.single).not.toHaveBeenCalled();
  });

  test('a broken test-run recording does not stop the run', async () => {
    ARGV = { file: 'flows/a.md', env: 'local' };
    (testRuns.single as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    await runCli();

    expect(errored()).toContain('Could not record the test run');
    expect(runner.run).toHaveBeenCalled();
  });

  test('runs a markdown flow through the markdown parser', async () => {
    ARGV = { file: 'flows/a.md', env: 'local' };
    (markdownFlows.toFlow as jest.Mock).mockReturnValue({ title: 'md flow', steps: [] });

    await runCli();

    expect(markdownFlows.toFlow).toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'md flow' }),
      expect.any(Object)
    );
  });

  test('a flow file that does not parse is fatal', async () => {
    ARGV = { file: 'flows/a.md', env: 'local' };
    (markdownFlows.toFlow as jest.Mock).mockImplementation(() => {
      throw new Error('Invalid markdown flow: step 1: Invalid step YAML');
    });

    await runCli();

    expect(errored()).toContain('Error parsing flow file');
  });

  test('prints the banner before running', async () => {
    ARGV = { file: 'flows/a.md', env: 'local' };
    const cliHelper = require('../src/helpers/cli');

    await runCli();

    expect(cliHelper.logo).toHaveBeenCalled();
    expect(cliHelper.wisdom).toHaveBeenCalled();
  });

  test('under nodemon the run is delayed', async () => {
    ARGV = { file: 'flows/a.md', env: 'local' };
    process.env.IS_NODEMON = '1';
    jest.useFakeTimers();

    jest.isolateModules(() => { require('../src/cli'); });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1500);

    jest.useRealTimers();
    delete process.env.IS_NODEMON;

    expect(runner.run).toHaveBeenCalled();
  });

  test('a runner failure is reported', async () => {
    ARGV = { file: 'flows/a.md', env: 'local' };
    (applications.loadAll as jest.Mock).mockRejectedValue(new Error('cannot load'));

    await runCli();

    expect(errored()).toContain('Error running flow');
  });
});

describe('cli --view', () => {
  test('requires an environment', async () => {
    ARGV = { view: 'smoke-tests' };
    await runCli();
    expect(errored()).toContain('No environment specified');
    expect(testRuns.runViewFromCli).not.toHaveBeenCalled();
  });

  test('runs every flow of the view, by slug', async () => {
    ARGV = { view: 'smoke-tests', env: 'local' };
    await runCli();

    expect(testRuns.runViewFromCli).toHaveBeenCalledWith({
      folder: '',
      view: 'Smoke tests',
      environment: 'local'
    });
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('scopes the view to a folder', async () => {
    ARGV = { view: 'All flows', folder: 'payments', env: 'staging' };
    await runCli();

    expect(testRuns.runViewFromCli).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'payments', view: 'All flows' })
    );
  });

  test('--view on its own runs the first view of views.yaml', async () => {
    ARGV = { view: true, env: 'local' };
    await runCli();

    expect(testRuns.runViewFromCli).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'All flows' })
    );
  });

  test('a view that is not there lists the ones that are', async () => {
    ARGV = { view: 'nope', env: 'local' };
    await runCli();

    expect(errored()).toContain('View not found: nope');
    expect(errored()).toContain('all-flows, smoke-tests');
    expect(testRuns.runViewFromCli).not.toHaveBeenCalled();
  });

  test('a failed flow makes the command exit with it', async () => {
    ARGV = { view: 'smoke-tests', env: 'local' };
    (testRuns.runViewFromCli as jest.Mock).mockResolvedValue({
      id: 'run-9',
      status: 'failed',
      flows: [{ file: 'a.md', status: 'passed' }, { file: 'b.md', status: 'failed', error: 'boom' }]
    });

    await runCli();

    expect(logged()).toContain('1 passed, 1 failed');
    expect(logged()).toContain('failed: b.md — boom');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('a run that cannot start is reported', async () => {
    ARGV = { view: 'smoke-tests', env: 'local' };
    (testRuns.runViewFromCli as jest.Mock).mockRejectedValue(new Error('No flows to run'));

    await runCli();

    expect(errored()).toContain('No flows to run');
  });
});

describe('cli --import-env', () => {
  test('on its own, imports the document and stops', async () => {
    ARGV = { 'import-env': 'env.yaml' };
    await runCli();

    expect(envTransfer.importFile).toHaveBeenCalledWith('env.yaml', { dryRun: false });
    expect(logged()).toContain('created applications/payments/env/uat.env');
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(runner.run).not.toHaveBeenCalled();
    expect(testRuns.runViewFromCli).not.toHaveBeenCalled();
  });

  test('the camelCase spelling of the flag is the same flag', async () => {
    ARGV = { importEnv: 'env.yaml' };
    await runCli();

    expect(envTransfer.importFile).toHaveBeenCalledWith('env.yaml', { dryRun: false });
  });

  // The variables have to be on disk before the run is checked against them:
  // a flow whose application has no env file is refused before it starts
  test('the variables land before a view runs', async () => {
    ARGV = { 'import-env': 'env.yaml', view: 'smoke-tests', env: 'uat' };
    await runCli();

    expect(envTransfer.importFile).toHaveBeenCalledWith('env.yaml', { dryRun: false });
    expect(testRuns.runViewFromCli).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'Smoke tests', environment: 'uat' })
    );
    expect((envTransfer.importFile as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((testRuns.runViewFromCli as jest.Mock).mock.invocationCallOrder[0]);
  });

  test('the variables land before a single flow runs', async () => {
    ARGV = { 'import-env': 'env.yaml', file: 'flows/a.md', env: 'uat' };
    await runCli();

    expect(envTransfer.importFile).toHaveBeenCalled();
    expect(applications.environmentReadiness).toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalled();
    expect((envTransfer.importFile as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((applications.environmentReadiness as jest.Mock).mock.invocationCallOrder[0]);
  });

  test('a document that cannot be read stops everything', async () => {
    ARGV = { 'import-env': 'nope.yaml', view: 'smoke-tests', env: 'uat' };
    (envTransfer.importFile as jest.Mock).mockRejectedValue(new Error('Document not found: /x/nope.yaml'));

    await runCli();

    expect(errored()).toContain('Could not import the environment variables');
    expect(errored()).toContain('Document not found');
    expect(testRuns.runViewFromCli).not.toHaveBeenCalled();
  });

  test('--dry-run previews the import and runs nothing', async () => {
    ARGV = { 'import-env': 'env.yaml', 'dry-run': true, view: 'smoke-tests', env: 'uat' };
    await runCli();

    expect(envTransfer.importFile).toHaveBeenCalledWith('env.yaml', { dryRun: true });
    expect(testRuns.runViewFromCli).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('--dry-run without a document to preview is refused', async () => {
    ARGV = { dryRun: true, view: 'smoke-tests', env: 'uat' };
    await runCli();

    expect(errored()).toContain('--dry-run only applies to --import-env');
    expect(envTransfer.importFile).not.toHaveBeenCalled();
    expect(testRuns.runViewFromCli).not.toHaveBeenCalled();
  });

  // A pipeline that only loads its credentials must come back, not sit on a
  // web server nobody asked for
  test('a document on its own imports and exits, without starting the UI', async () => {
    ARGV = { 'import-env': 'env.yaml' };
    await runCli();

    expect(envTransfer.importFile).toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  test('the help mentions it', async () => {
    ARGV = { help: true };
    await runCli();

    expect(logged()).toContain('--import-env');
    expect(logged()).toContain('--dry-run');
  });
});

