// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';

// A throwaway context directory, so the tests never touch the real one. The
// "mock" prefix is what lets jest.mock's hoisted factory reference it.
const mockContext = fs.mkdtempSync(path.join(os.tmpdir(), 'lab34-testrunreport-'));

jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (parts) => require('path').join(mockContext, ...(parts || [])),
  createFolder: async () => {},
  findFiles: () => []
}));

import * as testRuns from '../../src/helpers/testRuns';
import * as testRunReport from '../../src/helpers/testRunReport';

const CONTEXT = mockContext;
const RUNS_DIR = path.join(CONTEXT, 'test-runs');

const MARKDOWN = [
  '---', 'title: Pay with card', 'tags:', '  - payments', '  - smoke', '---', '',
  'Intro', '',
  '```step', 'application: calculator', 'method: add', '```', '',
  '```step', 'application: calculator', 'method: subtract', '```', ''
].join('\n');

/** A flow the way the runner leaves it: first step failed, second never ran. */
const failedFlow = () => ({
  title: 'Pay with card',
  execution: {
    id: 'e1',
    status: 'error',
    times: { start: 1000, end: 3000 },
    error: { name: 'TestFailed', message: 'Test failed for step calculator-add' }
  },
  steps: [{
    id: 'calculator-add',
    stepIndex: 0,
    application: 'calculator',
    method: 'add',
    execution: { status: 'failed', times: { start: 1000, end: 2000, duration: 1000 }, attempt: 0 },
    request: { body: { a: 1 } },
    response: { status: 500, headers: {}, body: { error: { code: 'BOOM' } } },
    testReport: {
      hasErrors: true,
      status: [{ message: 'Expected status does not match actual status', expected: [200], actual: 500 }],
      body: [{ message: 'Expression evaluation failed at sum', expression: 'value > 2', actualValue: 1 }]
    }
  }]
});

const passedFlow = () => ({
  title: 'Pay with card',
  execution: { id: 'e1', status: 'passed', times: { start: 1000, end: 3000 } },
  steps: [{
    id: 'calculator-add',
    stepIndex: 0,
    application: 'calculator',
    method: 'add',
    execution: { status: 'passed', times: { start: 1000, end: 2000, duration: 1000 }, attempt: 0 },
    response: { status: 200, headers: {}, body: { sum: 3 } }
  }]
});

beforeEach(() => {
  fs.rmSync(RUNS_DIR, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(CONTEXT, { recursive: true, force: true });
});

describe('finalize writes the report', () => {
  test('a finished run holds a report.html', async () => {
    const run = await testRuns.create({
      trigger: 'flow', environment: 'local', flows: [{ file: 'payments/pay.md', title: 'Pay with card' }]
    });
    testRuns.flowFinished(run, 'payments/pay.md', { content: MARKDOWN, flow: passedFlow() });
    testRuns.finalize(run);

    const html = fs.readFileSync(path.join(RUNS_DIR, run.id, 'report.html'), 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('PASSED');
  });

  test('a report that cannot be written never fails the run', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [{ file: 'a.md' }] });
    testRuns.flowFinished(run, 'a.md', { content: MARKDOWN, flow: passedFlow() });

    const spy = jest.spyOn(testRunReport, 'write').mockImplementation(() => { throw new Error('disk full'); });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => testRuns.finalize(run)).not.toThrow();
      const summary = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, run.id, 'run.json'), 'utf8'));
      expect(summary.status).toBe('passed');
    }
    finally {
      spy.mockRestore();
      error.mockRestore();
    }
  });
});

describe('the report of a passed run', () => {
  test('carries the verdict, the counts and every suite', async () => {
    const run = await testRuns.create({
      trigger: 'folder', environment: 'staging', flows: [
        { file: 'payments/pay.md', title: 'Pay with card' },
        { file: 'root.md', title: 'At the root' }
      ]
    });
    testRuns.flowFinished(run, 'payments/pay.md', { content: MARKDOWN, flow: passedFlow() });
    testRuns.flowFinished(run, 'root.md', { content: MARKDOWN, flow: passedFlow() });
    testRuns.finalize(run);

    const html = await testRuns.report(run.id);

    expect(html).toContain('PASSED');
    expect(html).toContain('2 passed');
    expect(html).toContain('0 failed');
    expect(html).toContain('2 flows, 2 suites');
    expect(html).toContain('payments/');
    expect(html).toContain('./');
    expect(html).toContain('staging');
    expect(html).toContain('Folder run');
    // Nothing failed, so there is no failures section
    expect(html).not.toContain('Failures —');
  });

  test('every suite expands to its flows, their steps and their timings', async () => {
    const run = await testRuns.create({
      trigger: 'folder', environment: 'local', flows: [
        { file: 'payments/pay.md', title: 'Pay with card' },
        { file: 'accounts/close.md', title: 'Close an account' }
      ]
    });
    testRuns.flowFinished(run, 'payments/pay.md', { content: MARKDOWN, flow: passedFlow() });
    testRuns.finalize(run);

    const html = await testRuns.report(run.id);

    // The suite rows are expandable
    expect(html).toContain('<details class="suite">');
    // A passed flow shows its steps and how long each of them took
    expect(html).toContain('Pay with card');
    expect(html).toContain('calculator add · 1.0 s');
    // The step the run never reached is there too, as skipped
    expect(html).toContain('calculator subtract');
    // A flow that never ran still gets its line
    expect(html).toContain('Close an account');
    expect(html).toContain('not run');
  });
});

describe('the report of a failed run', () => {
  const recordFailedRun = async () => {
    const run = await testRuns.create({
      trigger: 'flow', environment: 'local', flows: [{ file: 'payments/pay.md', title: 'Pay with card' }]
    });
    testRuns.flowFinished(run, 'payments/pay.md', { content: MARKDOWN, flow: failedFlow() });
    testRuns.finalize(run);
    return run;
  };

  test('holds the failure with its steps and its evidence', async () => {
    const run = await recordFailedRun();
    const html = await testRuns.report(run.id);

    expect(html).toContain('FAILED');
    expect(html).toContain('Failures — 1');
    expect(html).toContain('Pay with card');
    // The flow's tags become chips on the card
    expect(html).toContain('payments');
    expect(html).toContain('smoke');
    // The step that failed, and the one the run never reached
    expect(html).toContain('calculator add');
    expect(html).toContain('calculator subtract');
    // The assertion errors, the flow error and the response
    expect(html).toContain('Expected status does not match actual status');
    expect(html).toContain('Expression evaluation failed at sum');
    expect(html).toContain('Test failed for step calculator-add');
    expect(html).toContain('response 500');
    expect(html).toContain('BOOM');
  });

  test('a missing copy still leaves a card with the summary error', async () => {
    const run = await recordFailedRun();
    fs.rmSync(path.join(RUNS_DIR, run.id, 'payments', 'pay.md'));
    fs.rmSync(path.join(RUNS_DIR, run.id, 'report.html'));

    const html = await testRuns.report(run.id);
    expect(html).toContain('Failures — 1');
    expect(html).toContain('Test failed for step calculator-add');
  });
});

describe('escaping', () => {
  test('what came from the outside cannot become markup', () => {
    const summary: any = {
      id: 'r1',
      trigger: 'flow',
      environment: '<img src=x onerror=alert(1)>',
      status: 'failed',
      times: { start: 1000, end: 2000, duration: 1000 },
      flows: [{
        file: 'a.md',
        title: '<script>alert(1)</script>',
        status: 'failed',
        error: '<b>broken</b>'
      }]
    };

    const html = testRunReport.buildHtml(summary, path.join(RUNS_DIR, 'nope'));

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>broken</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapeHtml covers every special character', () => {
    expect(testRunReport.escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
    expect(testRunReport.escapeHtml(null)).toBe('');
  });
});

describe('testRuns.report', () => {
  test('answers the stored file without rebuilding it', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [{ file: 'a.md' }] });
    testRuns.flowFinished(run, 'a.md', { content: MARKDOWN, flow: passedFlow() });
    testRuns.finalize(run);

    fs.writeFileSync(path.join(RUNS_DIR, run.id, 'report.html'), 'as stored');
    expect(await testRuns.report(run.id)).toBe('as stored');
  });

  test('rebuilds and keeps the report of a run recorded before reports existed', async () => {
    const run = await testRuns.create({ trigger: 'flow', environment: 'local', flows: [{ file: 'a.md' }] });
    testRuns.flowFinished(run, 'a.md', { content: MARKDOWN, flow: passedFlow() });
    testRuns.finalize(run);
    fs.rmSync(path.join(RUNS_DIR, run.id, 'report.html'));

    const html = await testRuns.report(run.id);
    expect(html).toContain('PASSED');
    expect(fs.existsSync(path.join(RUNS_DIR, run.id, 'report.html'))).toBe(true);
  });

  test('refuses ids that escape the runs directory', async () => {
    await expect(testRuns.report('../flows')).rejects.toThrow('Test run not found');
    await expect(testRuns.report('nope')).rejects.toThrow('Test run not found');
  });
});
