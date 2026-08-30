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
jest.mock('../src/helpers/cli', () => ({ logo: jest.fn(), wisdom: jest.fn(), isInteractive: false }));
jest.mock('../src/api', () => ({ start: jest.fn().mockResolvedValue(undefined) }));

const spawn = jest.fn();
jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: (...a: any[]) => spawn(...a) }));

import fs from 'fs';

import * as paths from '../src/helpers/paths';
import * as applications from '../src/helpers/applications';
import * as flows from '../src/helpers/flows';
import * as markdownFlows from '../src/helpers/markdownFlows';
import * as runner from '../src/helpers/runner/v1';
import * as testRuns from '../src/helpers/testRuns';
import * as bases from '../src/helpers/bases';
import * as envTransfer from '../src/helpers/envTransfer';
import * as api from '../src/api';

/** Import cli.ts fresh and let its async main() settle. */
const runCli = async () => {
  jest.isolateModules(() => { require('../src/cli'); });
  await new Promise(resolve => setImmediate(resolve));
};

const logged = () => (console.log as jest.Mock).mock.calls.map(c => c.join(' ')).join('\n');
const errored = () => (console.error as jest.Mock).mock.calls.map(c => c.join(' ')).join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  ARGV = {};
  (paths.contextDir as jest.Mock).mockImplementation(async (p: string) => `/ctx/${p}`);
  (applications.loadAll as jest.Mock).mockResolvedValue(undefined);
  (flows.listCapabilities as jest.Mock).mockResolvedValue(undefined);
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  jest.spyOn(fs, 'readFileSync').mockReturnValue('# t\n\n```step\napplication: a\nmethod: b\n```\n' as any);
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
    expect(logged()).toContain('Lab34 Flows CLI Tool');
    expect(logged()).toContain('--server');
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});

describe('cli --debug', () => {
  test('prints package, process and environment information', async () => {
    ARGV = { debug: true };
    await runCli();

    const out = logged();
    expect(out).toContain('=== DEBUG INFORMATION ===');
    expect(out).toContain('Package Name: @lab34/flows');
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

describe('cli --server', () => {
  test('starts the API', async () => {
    ARGV = { server: true };

    await runCli();

    expect(api.start).toHaveBeenCalled();
  });

  // The UI ships pre-built inside the package: an installed copy has neither
  // the frontend sources nor a working directory it could build them from.
  test('never shells out to build the frontend', async () => {
    ARGV = { server: true };

    await runCli();

    expect(spawn).not.toHaveBeenCalled();
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

  test('an import before the UI starts is an import, then the UI', async () => {
    ARGV = { 'import-env': 'env.yaml', server: true };
    await runCli();

    expect(envTransfer.importFile).toHaveBeenCalled();
    expect(api.start).toHaveBeenCalled();
  });

  test('the help mentions it', async () => {
    ARGV = { help: true };
    await runCli();

    expect(logged()).toContain('--import-env');
    expect(logged()).toContain('--dry-run');
  });
});

describe('cli with no arguments', () => {
  test('explains what it needs', async () => {
    ARGV = {};
    await runCli();
    expect(errored()).toContain('No flow source specified');
  });
});
