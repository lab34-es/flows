import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { copyOf, listRuns, readSteps } from '../src/core/history';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ronsel-history-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

let count = 0;
const context = () => fs.mkdtempSync(path.join(scratch, `ctx-${++count}-`));

/** A run folder, the way the package records one. */
const recordRun = (root: string, id: string, summary: Record<string, unknown> | string) => {
  const dir = path.join(root, 'test-runs', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), typeof summary === 'string' ? summary : JSON.stringify(summary));
  return dir;
};

/** A flow copy with its results written in (withResults in the package). */
const COPY = [
  '---',
  'title: Pay with card',
  'testRun:',
  '  status: failed',
  '---',
  '',
  '```step',
  'application: cards',
  'method: charge',
  'description: Charge the card',
  '```',
  '',
  '```step-result',
  'execution:',
  '  status: passed',
  '  times:',
  '    start: 1000',
  '    end: 1420',
  '    duration: 0.42',
  '```',
  '```step',
  'application: ledger',
  'method: post',
  '```',
  '',
  '```step-result',
  'execution:',
  '  status: error',
  '  times:',
  '    duration: 1.5',
  '  error:',
  '    name: TestFailed',
  '    message: Test failed for step ledger-post',
  '```',
  '```step',
  'application: ledger',
  'method: close',
  '```',
  '',
  '```step-result',
  'execution:',
  '  status: skipped',
  '```',
  '```step',
  'application: ledger',
  'method: audit',
  '```'
].join('\n');

describe('listRuns', () => {
  test('lists the runs of a context, newest first, the folder being the id', () => {
    const root = context();
    recordRun(root, 'old', { id: 'whatever', status: 'passed', times: { start: 1 }, flows: [] });
    recordRun(root, 'new', { status: 'failed', times: { start: 3 }, flows: [{ file: 'a.md', status: 'failed' }] });
    recordRun(root, 'middle', { status: 'running', times: { start: 2 }, flows: [] });

    const runs = listRuns(root);

    assert.deepEqual(runs.map(run => run.id), ['new', 'middle', 'old']);
    assert.equal(runs[2].summary.id, 'old');
    assert.equal(runs[0].context, root);
    assert.equal(runs[0].dir, path.join(root, 'test-runs', 'new'));
  });

  test('keeps to the limit', () => {
    const root = context();
    ['a', 'b', 'c'].forEach((id, index) => recordRun(root, id, { status: 'passed', times: { start: index }, flows: [] }));

    assert.deepEqual(listRuns(root, 2).map(run => run.id), ['c', 'b']);
  });

  test('skips what is not a run, and a context that ran nothing has none', () => {
    const root = context();
    recordRun(root, 'broken', '{ not json');
    recordRun(root, 'not-a-run', { hello: 'world' });
    fs.writeFileSync(path.join(root, 'test-runs', 'stray.txt'), '');
    recordRun(root, 'same-start-b', { status: 'passed', flows: [] });
    recordRun(root, 'same-start-a', { status: 'passed', flows: [] });

    assert.deepEqual(listRuns(root).map(run => run.id), ['same-start-b', 'same-start-a']);
    assert.deepEqual(listRuns(context()), []);
  });
});

describe('copyOf', () => {
  test('is the copy inside the run folder, never outside of it', () => {
    const root = context();
    const dir = recordRun(root, 'r1', { status: 'passed', flows: [] });
    const run = listRuns(root)[0];

    assert.equal(copyOf(run, 'payments/refund.md'), path.join(dir, 'payments', 'refund.md'));
    assert.equal(copyOf(run, '..\\..\\escape.md'), null);
    assert.equal(copyOf(run, ''), null);
  });
});

describe('readSteps', () => {
  test('reads what became of every step, and where its result is', () => {
    const file = path.join(context(), 'copy.md');
    fs.writeFileSync(file, COPY);

    assert.deepEqual(readSteps(file), [
      { index: 0, label: 'Charge the card', status: 'passed', duration: 420, line: 6, resultLine: 12 },
      {
        index: 1, label: 'ledger.post', status: 'failed', duration: 1500,
        error: 'Test failed for step ledger-post', line: 20, resultLine: 25
      },
      { index: 2, label: 'ledger.close', status: 'skipped', line: 34, resultLine: 39 },
      { index: 3, label: 'ledger.audit', status: 'pending', line: 43 }
    ]);
  });

  test('a failed assertion reads as what was expected against what came', () => {
    const file = path.join(context(), 'copy.md');
    fs.writeFileSync(file, [
      '```step', 'application: a', 'method: b', '```',
      '```step-result',
      'execution:',
      '  status: error',
      '  error: { name: TestFailed, message: Error executing step a-b }',
      'testReport:',
      '  hasErrors: true',
      '  body:',
      '    - { message: Value mismatch at result, expected: -24, actual: -25 }',
      '```',
      '```step', 'application: a', 'method: c', '```',
      '```step-result',
      'execution:',
      '  status: error',
      '  error: { name: Error, message: connect ECONNREFUSED }',
      '```'
    ].join('\n'));

    const [assertion, thrown] = readSteps(file) || [];
    assert.equal(assertion.status, 'failed');
    assert.equal(assertion.error, 'body: Value mismatch at result: expected -24, got -25');
    assert.equal(thrown.status, 'errored');
    assert.equal(thrown.error, 'connect ECONNREFUSED');
  });

  test('is nothing when there is no copy to read', () => {
    assert.equal(readSteps(path.join(scratch, 'missing.md')), null);
  });
});
