import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { elapsed, formatDuration, formatStart, runLabel, runScore } from '../src/core/format';

describe('formatDuration', () => {
  test('reads like the web UI', () => {
    assert.equal(formatDuration(480.4), '480 ms');
    assert.equal(formatDuration(1234), '1.2 s');
    assert.equal(formatDuration(125000), '2m 5s');
  });

  test('says nothing about nothing', () => {
    assert.equal(formatDuration(undefined), null);
    assert.equal(formatDuration(null), null);
    assert.equal(formatDuration(-1), null);
    assert.equal(formatDuration(Number.NaN), null);
  });
});

describe('formatStart', () => {
  const at = (iso: string) => new Date(iso).getTime();

  test('the time alone today, and the date before', () => {
    assert.equal(formatStart(at('2026-10-01T09:05:04'), at('2026-10-01T18:00:00')), '09:05:04');
    assert.equal(formatStart(at('2026-09-30T23:59:01'), at('2026-10-01T18:00:00')), '2026-09-30 23:59:01');
  });
});

describe('run labels', () => {
  const flow = (file: string, status: any, title?: string) => ({ file, status, ...(title ? { title } : {}) });

  test('a run of one flow is that flow', () => {
    assert.equal(runLabel({ id: 'r', status: 'passed', flows: [flow('a.md', 'passed', 'Pay with card')] }), 'Pay with card');
    assert.equal(runLabel({ id: 'r', status: 'passed', flows: [flow('a.md', 'passed')] }), 'a.md');
  });

  test('a run of several is its view, or how many', () => {
    const flows = [flow('a.md', 'passed'), flow('b.md', 'failed')];
    assert.equal(runLabel({ id: 'r', status: 'failed', view: 'Smoke tests', flows }), 'Smoke tests');
    assert.equal(runLabel({ id: 'r', status: 'failed', flows }), '2 flows');
  });

  test('the score is how many passed', () => {
    assert.equal(runScore({ id: 'r', status: 'failed', flows: [flow('a.md', 'passed'), flow('b.md', 'failed')] }), '1/2');
    assert.equal(runScore({ id: 'r', status: 'failed' } as any), '0/0');
  });
});

describe('elapsed', () => {
  test('is the duration once over, and the time so far until then', () => {
    assert.equal(elapsed({ start: 1000, end: 4000, duration: 2500 }), 2500);
    assert.equal(elapsed({ start: 1000, end: 4000 }), 3000);
    assert.equal(elapsed({ start: 1000 }, 1600), 600);
    assert.equal(elapsed({}), undefined);
    assert.equal(elapsed(undefined), undefined);
  });
});
