// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';

// A throwaway context directory, so the tests never touch the real one. The
// "mock" prefix is what lets jest.mock's hoisted factory reference it.
const mockContext = fs.mkdtempSync(path.join(os.tmpdir(), 'lab34-testruns-'));

jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (parts) => require('path').join(mockContext, ...(parts || [])),
  createFolder: async () => {},
  findFiles: () => []
}));

// What a folder/CLI run reaches for lazily: the applications it needs
// loaded, the view that picks the flows, and the runner that executes them.
jest.mock('../../src/helpers/applications', () => ({
  allPossibleEnvironments: jest.fn(async () => ['local', 'staging']),
  loadAll: jest.fn(async () => {})
}));
jest.mock('../../src/helpers/bases', () => ({ query: jest.fn() }));

// A finished run hands its report to the integrations: none of them may
// reach the network from a test
jest.mock('../../src/helpers/sharepoint', () => ({
  loadSettings: jest.fn(async () => ({})),
  shouldUpload: jest.fn(() => false),
  uploadReport: jest.fn(async () => null)
}));
jest.mock('../../src/helpers/runner/v1', () => ({ run: jest.fn(), isRunning: jest.fn(() => false) }));

import * as testRuns from '../../src/helpers/testRuns';
import * as markdownFlows from '../../src/helpers/markdownFlows';
import * as bases from '../../src/helpers/bases';
import * as runner from '../../src/helpers/runner/v1';
import * as sharepoint from '../../src/helpers/sharepoint';

const CONTEXT = mockContext;
const RUNS_DIR = path.join(CONTEXT, 'test-runs');

const MARKDOWN = [
  '---', 'title: Pay with card', '---', '',
  'Intro', '',
  '```step', 'application: calculator', 'method: add', '```', ''
].join('\n');

/** A flow the way the runner leaves it after executing MARKDOWN. */
const executedFlow = (status = 'passed') => ({
  title: 'Pay with card',
  execution: {
    id: 'e1',
    status: status === 'passed' ? 'passed' : 'error',
    times: { start: 1000, end: 3000 },
    ...(status === 'passed' ? {} : { error: { name: 'TestFailed', message: 'Test failed for step calculator-add' } })
  },
  steps: [{
    id: 'calculator-add',
    stepIndex: 0,
    application: 'calculator',
    method: 'add',
    execution: { status: status === 'passed' ? 'passed' : 'failed', times: { start: 1000, end: 2000, duration: 1 }, attempt: 0 },
    request: { body: { a: 1, password: 'supersecret' } },
    response: { status: 200, headers: {}, body: { sum: 3 } }
  }]
});

beforeEach(() => {
  fs.rmSync(RUNS_DIR, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(CONTEXT, { recursive: true, force: true });
});

describe('testRuns.create', () => {
  test('creates the run folder with a running summary', async () => {
    const run = await testRuns.create({
      trigger: 'flow',
      environment: 'local',
      flows: [{ file: 'a.md', title: 'A' }]
    });

    const summary = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, run.id, 'run.json'), 'utf8'));
    expect(summary.status).toBe('running');
    expect(summary.trigger).toBe('flow');
    expect(summary.environment).toBe('local');
    expect(summary.flows).toEqual([{ file: 'a.md', title: 'A', status: 'pending' }]);
  });

  test('the id reads as a date, a time and the environment', async () => {
    const run = await testRuns.create({ trigger: 'cli', environment: 'local', flows: [] });
    expect(run.id).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-local$/);
  });

  test('an environment the filesystem could not carry is slugged', async () => {
    const run = await testRuns.create({ trigger: 'cli', environment: 'pre prod/eu', flows: [] });
    expect(run.id).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-pre-prod-eu$/);
    expect(fs.existsSync(path.join(RUNS_DIR, run.id, 'run.json'))).toBe(true);
  });

  test('two runs in the same second get different folders', async () => {
    const first = await testRuns.create({ trigger: 'cli', environment: 'local', flows: [] });
    const second = await testRuns.create({ trigger: 'cli', environment: 'local', flows: [] });

    expect(second.id).not.toBe(first.id);
    expect(fs.existsSync(path.join(RUNS_DIR, first.id))).toBe(true);
    expect(fs.existsSync(path.join(RUNS_DIR, second.id))).toBe(true);
  });

  test('tells the socket about the run', async () => {
    const io = { emit: jest.fn() };
    const run = await testRuns.create({ trigger: 'folder', environment: 'local', folder: 'payments', view: 'All', flows: [], io });

    expect(io.emit).toHaveBeenCalledWith('testrun:update', expect.objectContaining({
      id: run.id,
      run: expect.objectContaining({ status: 'running', folder: 'payments', view: 'All' })
    }));
  });
});

describe('testRuns recording', () => {
  test('flowFinished writes the copy with results and updates the summary', async () => {
    const run = await testRuns.create({
      trigger: 'flow', environment: 'local', flows: [{ file: 'payments/pay.md', title: 'Pay with card' }]
    });

    testRuns.flowStarted(run, 'payments/pay.md');
    testRuns.flowFinished(run, 'payments/pay.md', { content: MARKDOWN, flow: executedFlow() });
    await testRuns.finalize(run);

    const summary = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, run.id, 'run.json'), 'utf8'));
    expect(summary.status).toBe('passed');
    expect(summary.times.end).toBeDefined();
    expect(summary.flows[0]).toMatchObject({
      file: 'payments/pay.md',
      status: 'passed',
      steps: { total: 1, passed: 1, failed: 0 }
    });

    const copy = fs.readFileSync(path.join(RUNS_DIR, run.id, 'payments', 'pay.md'), 'utf8');
    const parsed = markdownFlows.parse(markdownFlows.extractResults(copy).content);
    expect(parsed.meta.testRun).toMatchObject({ id: run.id, status: 'passed', environment: 'local' });
    expect(parsed.meta.title).toBe('Pay with card');

    const { results } = markdownFlows.extractResults(copy);
    expect(results[0].execution.status).toBe('passed');
    expect(results[0].response.body).toEqual({ sum: 3 });
  });

  test('what the reporter masks on screen is masked on disk too', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [{ file: 'a.md' }] });

    testRuns.flowFinished(run, 'a.md', { content: MARKDOWN, flow: executedFlow() });

    const copy = fs.readFileSync(path.join(RUNS_DIR, run.id, 'a.md'), 'utf8');
    expect(copy).not.toContain('supersecret');

    const { results } = markdownFlows.extractResults(copy);
    expect(results[0].request.body.password).toMatch(/^\*+/);
  });

  test('a failed flow fails the run and keeps the error', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [{ file: 'a.md' }] });

    testRuns.flowFinished(run, 'a.md', { content: MARKDOWN, flow: executedFlow('failed') });
    await testRuns.finalize(run);

    const summary = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, run.id, 'run.json'), 'utf8'));
    expect(summary.status).toBe('failed');
    expect(summary.flows[0].status).toBe('failed');
    expect(summary.flows[0].error).toContain('Test failed');
    expect(summary.flows[0].steps).toEqual({ total: 1, passed: 0, failed: 1 });
  });

  test('a step the run never reached is stored as skipped', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [{ file: 'a.md' }] });

    const flow = executedFlow('failed');
    flow.steps.push({ id: 'never-ran', stepIndex: 1, application: 'calculator', method: 'add' } as any);
    const content = `${MARKDOWN}\n\`\`\`step\napplication: calculator\nmethod: add\n\`\`\`\n`;

    testRuns.flowFinished(run, 'a.md', { content, flow });

    const copy = fs.readFileSync(path.join(RUNS_DIR, run.id, 'a.md'), 'utf8');
    const { results } = markdownFlows.extractResults(copy);
    expect(results[1]).toEqual({ execution: { status: 'skipped' } });
  });

  test('flowFailed records a flow that could not run at all', async () => {
    const run = await testRuns.create({ trigger: 'folder', environment: 'local', flows: [{ file: 'broken.md' }] });

    testRuns.flowFailed(run, 'broken.md', { content: '```step\n[broken\n```\n', error: new Error('Invalid markdown flow') });
    await testRuns.finalize(run);

    const summary = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, run.id, 'run.json'), 'utf8'));
    expect(summary.status).toBe('failed');
    expect(summary.flows[0].error).toContain('Invalid markdown flow');
    expect(fs.existsSync(path.join(RUNS_DIR, run.id, 'broken.md'))).toBe(true);
  });

  test('a copy cannot be written outside of the run folder', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [] });

    testRuns.flowFailed(run, '../escape.md', { content: '# nope', error: new Error('x') });

    expect(fs.existsSync(path.join(RUNS_DIR, 'escape.md'))).toBe(false);
    // The failure is still on the summary, only the copy was refused
    const summary = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, run.id, 'run.json'), 'utf8'));
    expect(summary.flows[0].status).toBe('failed');
  });

  test('discard removes the run folder', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [] });
    expect(fs.existsSync(run.dir)).toBe(true);

    testRuns.discard(run);
    expect(fs.existsSync(run.dir)).toBe(false);
  });

  test('single ties creation and recording together', async () => {
    const record = await testRuns.single({
      trigger: 'cli', environment: 'local', file: 'a.md', title: 'A', content: MARKDOWN
    });

    await record.onFinished(executedFlow());

    const summary = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, record.run.id, 'run.json'), 'utf8'));
    expect(summary.trigger).toBe('cli');
    expect(summary.status).toBe('passed');
    expect(fs.existsSync(path.join(RUNS_DIR, record.run.id, 'a.md'))).toBe(true);
  });
});

describe('testRuns.runViewFromCli', () => {
  const FLOWS_DIR = path.join(CONTEXT, 'flows');

  beforeEach(() => {
    jest.clearAllMocks();

    fs.mkdirSync(path.join(FLOWS_DIR, 'payments'), { recursive: true });
    fs.writeFileSync(path.join(FLOWS_DIR, 'payments', 'card.md'), MARKDOWN, 'utf8');
    fs.writeFileSync(path.join(FLOWS_DIR, 'payments', 'cash.md'), MARKDOWN, 'utf8');

    (bases.query as jest.Mock).mockResolvedValue({
      view: { name: 'Smoke tests' },
      rows: [{ relativePath: 'payments/card.md' }, { relativePath: 'payments/cash.md' }]
    });

    // Every flow passes unless a test says otherwise
    (runner.run as jest.Mock).mockImplementation(async (flow, options) => {
      await options.onFinished(executedFlow());
      return { execution: { status: 'passed' } };
    });
  });

  afterEach(() => {
    fs.rmSync(FLOWS_DIR, { recursive: true, force: true });
  });

  test('runs every flow the view matches and waits for the last one', async () => {
    const summary = await testRuns.runViewFromCli({ folder: 'payments', view: 'Smoke tests', environment: 'local' });

    expect(bases.query).toHaveBeenCalledWith({ folder: 'payments', view: 'Smoke tests' });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(summary.trigger).toBe('cli');
    expect(summary.view).toBe('Smoke tests');
    expect(summary.status).toBe('passed');
    expect(summary.flows.map(flow => flow.file)).toEqual(['payments/card.md', 'payments/cash.md']);

    // The run is closed on disk, not only in memory
    const stored = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, summary.id, 'run.json'), 'utf8'));
    expect(stored.status).toBe('passed');
    expect(fs.existsSync(path.join(RUNS_DIR, summary.id, 'payments', 'card.md'))).toBe(true);
  });

  test('reports on the terminal and never exits on a failing flow', async () => {
    await testRuns.runViewFromCli({ view: 'Smoke tests', environment: 'local' });

    expect(runner.run).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cli: true, exitOnFailure: false, environment: 'local' })
    );
  });

  test('a failing flow does not stop the ones after it', async () => {
    (runner.run as jest.Mock).mockImplementationOnce(async (flow, options) => {
      await options.onFinished(executedFlow('failed'));
      return { execution: { status: 'error' } };
    });

    const summary = await testRuns.runViewFromCli({ view: 'Smoke tests', environment: 'local' });

    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(summary.status).toBe('failed');
    expect(summary.flows.map(flow => flow.status)).toEqual(['failed', 'passed']);
  });

  test('refuses an environment that does not exist', async () => {
    await expect(testRuns.runViewFromCli({ view: 'Smoke tests', environment: 'nope' }))
      .rejects.toThrow('Invalid environment: nope');
  });

  test('refuses a view that matches no flow', async () => {
    (bases.query as jest.Mock).mockResolvedValue({ view: { name: 'Smoke tests' }, rows: [] });

    await expect(testRuns.runViewFromCli({ view: 'Smoke tests', environment: 'local' }))
      .rejects.toThrow('No flows to run');
  });

  test('waits rather than crossing another run', async () => {
    (runner.isRunning as jest.Mock).mockReturnValue(true);

    await expect(testRuns.runViewFromCli({ view: 'Smoke tests', environment: 'local' }))
      .rejects.toThrow('Another flow is already running');
  });
});

describe('testRuns.copyFileName', () => {
  test('keeps a clean relative path', async () => {
    expect(await testRuns.copyFileName({ relativePath: 'payments/pay.md' })).toBe('payments/pay.md');
    expect(await testRuns.copyFileName({ relativePath: './payments/pay.md' })).toBe('payments/pay.md');
  });

  test('refuses a path that climbs out and falls back to the title', async () => {
    expect(await testRuns.copyFileName({ relativePath: '../../etc/passwd', title: 'Pay with card' }))
      .toBe('pay-with-card.md');
  });

  test('derives the name from the flows directory for absolute paths', async () => {
    const inside = path.join(CONTEXT, 'flows', 'team', 'a.md');
    expect(await testRuns.copyFileName({ absolutePath: inside })).toBe('team/a.md');

    const outside = path.join(os.tmpdir(), 'elsewhere', 'b.md');
    expect(await testRuns.copyFileName({ absolutePath: outside })).toBe('b.md');
  });

  test('slugs the title when there is nothing else', async () => {
    expect(await testRuns.copyFileName({ title: '¡Pago con tarjeta! (v2)' })).toBe('pago-con-tarjeta-v2.md');
    expect(await testRuns.copyFileName({})).toBe('flow.md');
  });
});

describe('testRuns reading', () => {
  test('list answers every run, newest first, skipping broken folders', async () => {
    const first = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [] });
    // Make the ordering deterministic: ids can collide-suffix within a second
    const firstSummary = JSON.parse(fs.readFileSync(path.join(first.dir, 'run.json'), 'utf8'));
    firstSummary.times.start = 1000;
    fs.writeFileSync(path.join(first.dir, 'run.json'), JSON.stringify(firstSummary));

    const second = await testRuns.create({ trigger: 'cli', environment: 'local', flows: [] });

    // A folder with no run.json must not take the list down
    fs.mkdirSync(path.join(RUNS_DIR, 'not-a-run'));
    // Nor a file sitting in the runs directory
    fs.writeFileSync(path.join(RUNS_DIR, 'stray.txt'), 'x');

    const runs = await testRuns.list();
    expect(runs.map(run => run.id)).toEqual([second.id, first.id]);
  });

  test('list is empty when nothing ran yet', async () => {
    expect(await testRuns.list()).toEqual([]);
  });

  test('get answers one run summary', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [{ file: 'a.md' }] });
    const summary = await testRuns.get(run.id);
    expect(summary.id).toBe(run.id);
    expect(summary.flows).toHaveLength(1);
  });

  test('get refuses ids that escape the runs directory', async () => {
    await expect(testRuns.get('../flows')).rejects.toThrow('Test run not found');
    await expect(testRuns.get('nope')).rejects.toThrow('Test run not found');
  });

  test('getFlow answers the stored copy, parsed, with its results', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [{ file: 'payments/pay.md' }] });
    testRuns.flowFinished(run, 'payments/pay.md', { content: MARKDOWN, flow: executedFlow() });

    const flow = await testRuns.getFlow(run.id, 'payments/pay.md');

    expect(flow.title).toBe('Pay with card');
    expect(flow.testRun).toMatchObject({ id: run.id, status: 'passed' });
    expect(flow.steps).toHaveLength(1);
    expect(flow.results[0].execution.status).toBe('passed');
    // The rendered segments carry no result blocks
    expect(flow.segments.every(segment => !segment.content.includes('step-result'))).toBe(true);
  });

  test('getFlow refuses paths that escape the run folder', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [] });
    fs.writeFileSync(path.join(RUNS_DIR, 'outside.md'), '# outside');

    await expect(testRuns.getFlow(run.id, '../outside.md')).rejects.toThrow('Flow not found');
    await expect(testRuns.getFlow(run.id, 'run.json')).rejects.toThrow('Flow not found');
  });
});

describe('delivering the report of a finished run', () => {
  beforeEach(() => {
    (sharepoint.shouldUpload as jest.Mock).mockReturnValue(false);
    (sharepoint.uploadReport as jest.Mock).mockResolvedValue(null);
  });

  /** A one-flow run, finished and ready to have its report taken somewhere. */
  const finishedRun = async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [{ file: 'a.md' }] });
    testRuns.flowFinished(run, 'a.md', { content: MARKDOWN, flow: executedFlow() });
    return run;
  };

  const storedSummary = (run) =>
    JSON.parse(fs.readFileSync(path.join(RUNS_DIR, run.id, 'run.json'), 'utf8'));

  test('says nothing about an upload nobody asked for', async () => {
    const run = await finishedRun();

    await testRuns.finalize(run);

    expect(sharepoint.uploadReport).not.toHaveBeenCalled();
    expect(storedSummary(run).upload).toBeUndefined();
  });

  test('records where the report landed', async () => {
    (sharepoint.shouldUpload as jest.Mock).mockReturnValue(true);
    const run = await finishedRun();

    // What run.json says while the upload is in flight: the run page reads it
    // to show that something is happening
    let inFlight;
    (sharepoint.uploadReport as jest.Mock).mockImplementation(async () => {
      inFlight = storedSummary(run).upload;
      return {
        target: 'sharepoint',
        status: 'uploaded',
        path: 'Test reports/run.html',
        url: 'https://acme.sharepoint.com/run.html'
      };
    });

    await testRuns.finalize(run);

    expect((sharepoint.uploadReport as jest.Mock).mock.calls[0][0]).toMatchObject({
      dir: run.dir,
      file: 'report.html'
    });
    expect(inFlight).toMatchObject({ target: 'sharepoint', status: 'uploading' });
    expect(storedSummary(run).upload).toMatchObject({
      status: 'uploaded',
      url: 'https://acme.sharepoint.com/run.html'
    });
  });

  test('an upload that failed is recorded, and the run still passed', async () => {
    (sharepoint.shouldUpload as jest.Mock).mockReturnValue(true);
    (sharepoint.uploadReport as jest.Mock).mockResolvedValue({
      target: 'sharepoint', status: 'failed', error: 'Access denied'
    });

    const run = await finishedRun();
    await testRuns.finalize(run);

    const summary = storedSummary(run);
    expect(summary.status).toBe('passed');
    expect(summary.upload).toMatchObject({ status: 'failed', error: 'Access denied' });
  });

  test('an integration that threw cannot take the run down with it', async () => {
    (sharepoint.shouldUpload as jest.Mock).mockReturnValue(true);
    (sharepoint.uploadReport as jest.Mock).mockRejectedValue(new Error('boom'));

    const run = await finishedRun();
    await expect(testRuns.finalize(run)).resolves.toBeUndefined();

    const summary = storedSummary(run);
    expect(summary.status).toBe('passed');
    expect(summary.upload).toMatchObject({ status: 'failed', error: 'boom' });
  });
});
