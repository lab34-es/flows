// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';

// A throwaway context directory, so the tests never touch the real one. The
// "mock" prefix is what lets jest.mock's hoisted factory reference it.
const mockContext = fs.mkdtempSync(path.join(os.tmpdir(), 'lab34-runsint-'));

jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (parts) => require('path').join(mockContext, ...(parts || [])),
  createFolder: async () => {},
  findFiles: () => []
}));

// Mimicing and the tester are orthogonal to what this suite integrates: the
// real runner driving the real test-run recording, on a real filesystem.
jest.mock('../../src/helpers/mimicing');
jest.mock('../../src/helpers/runner/tester');

import * as apps from '../../src/helpers/applications';
import * as mimicing from '../../src/helpers/mimicing';
import * as tester from '../../src/helpers/runner/tester';
import * as flows from '../../src/helpers/flows';
import * as testRuns from '../../src/helpers/testRuns';
import * as markdownFlows from '../../src/helpers/markdownFlows';

const CONTEXT = mockContext;
const RUNS_DIR = path.join(CONTEXT, 'test-runs');
const FLOWS_DIR = path.join(CONTEXT, 'flows');

const PASSING = [
  '---', 'title: Adds numbers', '---', '',
  'Adds a and b.', '',
  '```step', 'application: calculator', 'method: add',
  'parameters:', '  body:', '    a: 1', '    b: 2', '```', ''
].join('\n');

const FAILING = [
  '---', 'title: Blows up', '---', '',
  '```step', 'application: calculator', 'method: boom', '```', ''
].join('\n');

/** Wait until the run.json of the given run leaves the running state. */
const finishedSummary = async (runId) => {
  const file = path.join(RUNS_DIR, runId, 'run.json');
  for (let i = 0; i < 200; i++) {
    try {
      const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (summary.status !== 'running') { return summary; }
    }
    catch { /* mid-write: try again */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Run ${runId} never finished`);
};

beforeEach(() => {
  jest.clearAllMocks();

  fs.rmSync(RUNS_DIR, { recursive: true, force: true });
  fs.rmSync(FLOWS_DIR, { recursive: true, force: true });
  fs.mkdirSync(FLOWS_DIR, { recursive: true });

  // A real env file for the runner to read; the application itself runs
  // in-process
  fs.mkdirSync(path.join(CONTEXT, 'applications', 'calculator', 'env'), { recursive: true });
  fs.writeFileSync(path.join(CONTEXT, 'applications', 'calculator', 'env', 'local.env'), 'BASE=1\n', 'utf8');

  (apps.applications as any).calculator = {
    add: jest.fn().mockResolvedValue([
      { 'content-type': 'application/json' }, 200, { result: 3, token: 'abcd1234efgh' }, { last: 3 }
    ]),
    boom: jest.fn().mockRejectedValue(new Error('kaput'))
  };
  jest.spyOn(apps, 'allPossibleEnvironments').mockResolvedValue(['local']);
  jest.spyOn(apps, 'loadAll').mockResolvedValue(undefined as any);

  (mimicing.validate as jest.Mock).mockReturnValue(true);
  (mimicing.load as jest.Mock).mockResolvedValue({});
  (mimicing.startStep as jest.Mock).mockResolvedValue([]);
  (tester.getReady as jest.Mock).mockResolvedValue(undefined);
  (tester.test as jest.Mock).mockResolvedValue({ hasErrors: false });
});

afterAll(() => {
  fs.rmSync(CONTEXT, { recursive: true, force: true });
});

describe('a flow started from the API records a test run', () => {
  test('the copy carries the masked results and the summary closes', async () => {
    const io = { emit: jest.fn() };

    const result: any = await flows.start(
      { value: PASSING, environment: 'local', path: 'math/add.md' },
      { io }
    );
    expect(result.execution.id).toBeDefined();

    const [runId] = fs.readdirSync(RUNS_DIR);
    const summary = await finishedSummary(runId);

    expect(summary.status).toBe('passed');
    expect(summary.trigger).toBe('flow');
    expect(summary.flows[0]).toMatchObject({
      file: 'math/add.md',
      title: 'Adds numbers',
      status: 'passed',
      steps: { total: 1, passed: 1, failed: 0 }
    });

    const copy = fs.readFileSync(path.join(RUNS_DIR, runId, 'math', 'add.md'), 'utf8');
    const { results, content } = markdownFlows.extractResults(copy);

    expect(results[0].execution.status).toBe('passed');
    expect(results[0].response.status).toBe(200);
    expect(results[0].response.body.result).toBe(3);
    // Masked exactly like the reporter masks the console and the socket
    expect(results[0].response.body.token).toBe('****efgh');
    expect(copy).not.toContain('abcd1234efgh');

    expect(markdownFlows.parse(content).meta.testRun).toMatchObject({
      id: runId,
      status: 'passed',
      environment: 'local'
    });

    // The UI heard about the run over the socket
    expect(io.emit).toHaveBeenCalledWith('testrun:update', expect.objectContaining({ id: runId }));
  });
});

describe('a folder run executes its flows one after the other', () => {
  test('each flow gets its copy; one failure fails the run', async () => {
    fs.mkdirSync(path.join(FLOWS_DIR, 'math'), { recursive: true });
    fs.writeFileSync(path.join(FLOWS_DIR, 'math', 'add.md'), PASSING, 'utf8');
    fs.writeFileSync(path.join(FLOWS_DIR, 'math', 'boom.md'), FAILING, 'utf8');

    const io = { emit: jest.fn() };

    const run = await testRuns.startFolderRun({
      files: ['math/add.md', 'math/boom.md'],
      folder: 'math',
      view: 'All flows',
      environment: 'local',
      io
    });

    expect(run.status).toBe('running');
    expect(run.flows.map(flow => flow.file)).toEqual(['math/add.md', 'math/boom.md']);

    const summary = await finishedSummary(run.id);

    expect(summary.status).toBe('failed');
    expect(summary.folder).toBe('math');
    expect(summary.view).toBe('All flows');
    expect(summary.flows[0]).toMatchObject({ file: 'math/add.md', status: 'passed' });
    expect(summary.flows[1]).toMatchObject({ file: 'math/boom.md', status: 'failed' });
    expect(summary.flows[1].error).toContain('kaput');

    // Both copies are there, each with its own outcome written in
    const passedCopy = fs.readFileSync(path.join(RUNS_DIR, run.id, 'math', 'add.md'), 'utf8');
    expect(markdownFlows.extractResults(passedCopy).results[0].execution.status).toBe('passed');

    const failedCopy = fs.readFileSync(path.join(RUNS_DIR, run.id, 'math', 'boom.md'), 'utf8');
    const failedResults = markdownFlows.extractResults(failedCopy).results;
    expect(failedResults[0].execution.status).toBe('error');
    expect(failedResults[0].execution.error.message).toContain('kaput');

    // One at a time: the second flow only ran after the first was done
    const addCall = ((apps.applications as any).calculator.add as jest.Mock).mock.invocationCallOrder[0];
    const boomCall = ((apps.applications as any).calculator.boom as jest.Mock).mock.invocationCallOrder[0];
    expect(addCall).toBeLessThan(boomCall);
  });

  test('a refused environment never creates a run folder', async () => {
    fs.writeFileSync(path.join(FLOWS_DIR, 'a.md'), PASSING, 'utf8');

    await expect(testRuns.startFolderRun({
      files: ['a.md'],
      environment: 'staging'
    })).rejects.toThrow(/Invalid environment/);

    expect(fs.existsSync(RUNS_DIR)).toBe(false);
  });

  test('a file outside the flows directory is refused upfront', async () => {
    await expect(testRuns.startFolderRun({
      files: ['../escape.md'],
      environment: 'local'
    })).rejects.toThrow(/outside of the flows directory/);

    expect(fs.existsSync(RUNS_DIR)).toBe(false);
  });
});

describe('a run is refused when the flow\'s applications have no env file', () => {
  test('the applications of the flow are what is checked, and nothing is recorded', async () => {
    const io = { emit: jest.fn() };

    // "payments" has no env folder at all; the flow that uses it cannot run
    const flow = PASSING.replace('application: calculator', 'application: payments');

    await expect(flows.start({ value: flow, environment: 'local', path: 'shop/pay.md' }, { io }))
      .rejects.toThrow(/Missing environment file for "local": payments/);

    expect(fs.existsSync(RUNS_DIR)).toBe(false);
  });

  test('a folder run stops before the first flow starts', async () => {
    fs.writeFileSync(path.join(FLOWS_DIR, 'add.md'), PASSING, 'utf8');
    fs.writeFileSync(
      path.join(FLOWS_DIR, 'pay.md'),
      PASSING.replace('application: calculator', 'application: payments'),
      'utf8'
    );

    await expect(testRuns.startFolderRun({
      files: ['add.md', 'pay.md'],
      environment: 'local',
      io: { emit: jest.fn() }
    })).rejects.toThrow(/Missing environment file for "local": payments/);

    expect(fs.existsSync(RUNS_DIR)).toBe(false);
    expect((apps.applications as any).calculator.add).not.toHaveBeenCalled();
  });

  test('an environment only some applications declare still runs the flows that have it', async () => {
    // "uat" exists because calculator declares it -- "legacy" never will,
    // and no flow of this run uses it
    fs.mkdirSync(path.join(CONTEXT, 'applications', 'legacy', 'env'), { recursive: true });
    fs.writeFileSync(path.join(CONTEXT, 'applications', 'legacy', 'env', 'local.env'), 'L=1\n', 'utf8');
    fs.writeFileSync(path.join(CONTEXT, 'applications', 'calculator', 'env', 'uat.env'), 'BASE=2\n', 'utf8');

    const io = { emit: jest.fn() };

    const result: any = await flows.start({ value: PASSING, environment: 'uat', path: 'math/add.md' }, { io });
    expect(result.execution.id).toBeDefined();

    const [runId] = fs.readdirSync(RUNS_DIR);
    const summary = await finishedSummary(runId);

    expect(summary.status).toBe('passed');
    expect(summary.environment).toBe('uat');
  });
});
