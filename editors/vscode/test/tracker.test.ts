import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { failuresOf, resultOf, show, Tracker } from '../src/core/tracker';
import type { Sink } from '../src/core/tracker';

/**
 * What `ronsel --ipc` said for a run of two flows: scratch/fail.md, whose
 * first step's assertion fails and whose second step is never reached, and
 * examples/01-welcome.md, which passes. Recorded from the CLI, with the
 * request and response bodies left out.
 */
const RECORDED: any[] = require('../../test/run-events.json');

/** A sink that writes down what it was told, in order. */
const notes = () => {
  const said: any[] = [];
  const sink: Sink = {
    runUpdated: (run) => said.push(['run', run.status]),
    flowStarted: (file) => said.push(['flowStarted', file]),
    stepStarted: (file, step) => said.push(['stepStarted', file, step.index, step.id]),
    stepFinished: (file, step, result) => said.push(['stepFinished', file, step.index, result.status, result]),
    flowFinished: (file, result, reported) => said.push(['flowFinished', file, result, [...reported].sort()]),
    inputRequested: (file, request) => said.push(['input', file, request]),
    inputResolved: (id) => said.push(['resolved', id])
  };
  return { said, sink, of: (kind: string) => said.filter(entry => entry[0] === kind) };
};

const play = (tracker: Tracker, messages: any[]) => messages
  .filter(message => message.type === 'event')
  .forEach(message => tracker.handle(message.event, message.payload));

describe('Tracker, on a recorded run', () => {
  test('follows each flow and each step, in order', () => {
    const { said, sink } = notes();

    play(new Tracker(sink), RECORDED);

    const order = said
      .filter(entry => entry[0] !== 'run')
      .map(entry => entry.slice(0, entry[0] === 'flowFinished' ? 2 : 4).map(String).join(' '));

    assert.deepEqual(order, [
      'flowStarted scratch/fail.md',
      'stepStarted scratch/fail.md 0 calculator-add-0',
      'stepFinished scratch/fail.md 0 failed',
      'flowFinished scratch/fail.md',
      'flowStarted examples/01-welcome.md',
      'stepStarted examples/01-welcome.md 0 calculator-add',
      'stepFinished examples/01-welcome.md 0 passed',
      'stepStarted examples/01-welcome.md 1 calculator-multiply',
      'stepFinished examples/01-welcome.md 1 passed',
      'stepStarted examples/01-welcome.md 2 calculator-divide',
      'stepFinished examples/01-welcome.md 2 passed',
      'flowFinished examples/01-welcome.md'
    ]);
  });

  test('a failed assertion is one failure, with what was expected and what came', () => {
    const { of, sink } = notes();

    play(new Tracker(sink), RECORDED);

    const failed = of('stepFinished').find(entry => entry[1] === 'scratch/fail.md');
    assert.equal(failed[4].status, 'failed');
    assert.deepEqual(failed[4].failures, [{ message: 'body: Value mismatch at result', expected: '5', actual: '4' }]);
    assert.ok(failed[4].duration >= 0);
  });

  test('says which steps ended, so the ones never reached can be told apart', () => {
    const { of, sink } = notes();

    play(new Tracker(sink), RECORDED);

    const [fail, welcome] = of('flowFinished');
    assert.equal(fail[2].status, 'failed');
    assert.match(fail[2].error, /Test failed for step calculator-add-0/);
    assert.deepEqual(fail[3], [0]);
    assert.equal(welcome[2].status, 'passed');
    assert.deepEqual(welcome[3], [0, 1, 2]);
    assert.ok(welcome[2].duration >= 0);
  });

  test('passes every update of the run on', () => {
    const { of, sink } = notes();

    play(new Tracker(sink), RECORDED);

    assert.deepEqual(of('run').at(-1), ['run', 'failed']);
  });
});

/** The events of one flow, made up: what a case needs and nothing else. */
const run = (flows: Array<[string, string, string?]>) => ({
  id: 'r1',
  run: { id: 'r1', status: 'running', flows: flows.map(([file, status, error]) => ({ file, status, ...(error ? { error } : {}) })) }
});

const step = (index: number, id: string, execution: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 'e1', topic: 'step', data: { id, data: { id, stepIndex: index, execution, ...extra } }
});

describe('Tracker', () => {
  test('a step that threw is an error, with what it said', () => {
    const { of, sink } = notes();
    const tracker = new Tracker(sink);

    tracker.handle('testrun:update', run([['a.md', 'running']]));
    tracker.handle('flowexecution:update', step(0, 'db-query', { status: 'running' }));
    tracker.handle('flowexecution:update', step(0, 'db-query', {
      status: 'error', times: { start: 1000, end: 1250 }, error: { name: 'Error', message: 'Error executing step db-query: connect ECONNREFUSED' }
    }));

    const [finished] = of('stepFinished');
    assert.equal(finished[3], 'errored');
    assert.deepEqual(finished[4], { status: 'errored', duration: 250, failures: [{ message: 'Error executing step db-query: connect ECONNREFUSED' }] });
  });

  test('a step turned off is skipped', () => {
    const { of, sink } = notes();
    const tracker = new Tracker(sink);

    tracker.handle('testrun:update', run([['a.md', 'running']]));
    tracker.handle('flowexecution:update', step(1, 'a-b', { status: 'skipped' }));

    assert.deepEqual(of('stepFinished').map(entry => entry[3]), ['skipped']);
  });

  test('a step retried is started once', () => {
    const { of, sink } = notes();
    const tracker = new Tracker(sink);

    tracker.handle('testrun:update', run([['a.md', 'running']]));
    tracker.handle('flowexecution:update', step(0, 'a-b', { status: 'running' }));
    tracker.handle('flowexecution:update', step(0, 'a-b', { status: 'running', attempt: 1 }));
    tracker.handle('flowexecution:update', step(0, 'a-b', { status: 'passed', times: { duration: 0.5 } }));

    assert.equal(of('stepStarted').length, 1);
    assert.equal(of('stepFinished')[0][4].duration, 500);
  });

  test('a failure nobody followed with an error is still said when the flow ends', () => {
    const { of, sink } = notes();
    const tracker = new Tracker(sink);

    tracker.handle('testrun:update', run([['a.md', 'running']]));
    tracker.handle('flowexecution:update', step(0, 'a-b', { status: 'running' }));
    tracker.handle('flowexecution:update', step(0, 'a-b', { status: 'failed', error: { name: 'TestFailed', message: 'Test failed' } }, {
      testReport: { hasErrors: true, status: [{ message: 'Expected status does not match actual status', expected: [200], actual: 404 }] }
    }));
    assert.equal(of('stepFinished').length, 0);

    tracker.handle('testrun:update', run([['a.md', 'failed', 'Test failed']]));

    const [finished] = of('stepFinished');
    assert.equal(finished[3], 'failed');
    assert.deepEqual(finished[4].failures, [{
      message: 'status: Expected status does not match actual status', expected: '[\n  200\n]', actual: '404'
    }]);
    assert.deepEqual(of('flowFinished')[0][3], [0]);
  });

  test('close says a failure that was left open, when the run ends without the flow', () => {
    const { of, sink } = notes();
    const tracker = new Tracker(sink);

    tracker.handle('testrun:update', run([['a.md', 'running']]));
    tracker.handle('flowexecution:update', step(0, 'a-b', { status: 'running' }));
    tracker.handle('flowexecution:update', step(1, 'a-c', { status: 'running' }));
    tracker.handle('flowexecution:update', step(0, 'a-b', { status: 'failed', error: { message: 'no' } }));
    assert.equal(tracker.running, 'a.md');

    tracker.close();

    // Only the step that had said how it ended: the other is the caller's
    assert.deepEqual(of('stepFinished').map(entry => [entry[2], entry[3]]), [[0, 'failed']]);
  });

  test('a flow that fails before it starts has no step to report', () => {
    const { of, sink } = notes();
    const tracker = new Tracker(sink);

    tracker.handle('testrun:update', run([['a.md', 'pending'], ['b.md', 'pending']]));
    tracker.handle('testrun:update', run([['a.md', 'failed', 'Invalid markdown flow'], ['b.md', 'pending']]));

    assert.deepEqual(of('flowStarted'), []);
    assert.deepEqual(of('flowFinished'), [['flowFinished', 'a.md', { status: 'failed', error: 'Invalid markdown flow' }, []]]);
  });

  test('passes on what a step asks, and when it no longer does', () => {
    const { of, sink } = notes();
    const tracker = new Tracker(sink);

    tracker.handle('testrun:update', run([['a.md', 'running']]));
    tracker.handle('flowexecution:update', {
      id: 'e1', topic: 'input',
      data: { id: 'q1', kind: 'text', label: 'Barcode', stepId: 'desk-ask', secret: false, defaultValue: 'abc', status: 'pending' }
    });
    tracker.handle('flowexecution:update', { id: 'e1', topic: 'input', data: { id: 'q1', status: 'resolved' } });

    assert.deepEqual(of('input'), [['input', 'a.md', { id: 'q1', label: 'Barcode', stepId: 'desk-ask', secret: false, defaultValue: 'abc' }]]);
    assert.deepEqual(of('resolved'), [['resolved', 'q1']]);
  });

  test('ignores steps of no flow, and events it does not know', () => {
    const { said, sink } = notes();
    const tracker = new Tracker(sink);

    tracker.handle('flowexecution:update', step(0, 'a-b', { status: 'running' }));
    tracker.handle('flowexecution:update', { topic: 'diagram', data: {} });
    tracker.handle('flowexecution:update', undefined);
    tracker.handle('testrun:update', { run: null });
    tracker.handle('remote:job', { status: 'accepted' });
    tracker.close();

    assert.deepEqual(said, []);
  });

  test('works with a sink that does not care about inputs or the run', () => {
    const tracker = new Tracker({
      flowStarted: () => {}, stepStarted: () => {}, stepFinished: () => {}, flowFinished: () => {}
    });

    tracker.handle('testrun:update', run([['a.md', 'running']]));
    tracker.handle('flowexecution:update', { topic: 'input', data: { id: 'q1', status: 'pending' } });
    tracker.handle('flowexecution:update', { topic: 'input', data: { id: 'q1', status: 'resolved' } });
    assert.equal(tracker.running, 'a.md');
  });
});

describe('failuresOf', () => {
  test('one failure per mismatch, of every aspect', () => {
    assert.deepEqual(failuresOf({
      hasErrors: true,
      status: [{ message: 'Expected status does not match actual status', expected: [200, 201], actual: 500 }],
      body: [
        { message: "Missing key 'id' in actual object", expected: 'x', actual: undefined },
        { message: 'Expression evaluation failed at email', expression: "value.includes('@')", actualValue: 'nobody' }
      ],
      latentApplications: [{ application: 'mqtt', errors: [{ message: 'No message on devices/1' }, 'timed out', 42] }]
    }), [
      { message: 'status: Expected status does not match actual status', expected: '[\n  200,\n  201\n]', actual: '500' },
      { message: "body: Missing key 'id' in actual object", expected: 'x', actual: 'undefined' },
      { message: "body: Expression evaluation failed at email -- $expr: value.includes('@')", actual: 'nobody' },
      { message: 'mqtt: No message on devices/1' },
      { message: 'mqtt: timed out' },
      { message: 'mqtt: 42' }
    ]);
  });

  test('reads nothing into what is not a report', () => {
    assert.deepEqual(failuresOf(null), []);
    assert.deepEqual(failuresOf({ hasErrors: false, body: 'nope', status: [null, 3, {}] }), [
      { message: 'status: Assertion failed', expected: 'undefined', actual: 'undefined' }
    ]);
  });
});

describe('resultOf', () => {
  test('a failed assertion without a report still says something', () => {
    assert.deepEqual(resultOf({ execution: { status: 'failed' } }), {
      status: 'failed', duration: undefined, failures: [{ message: 'The step failed' }]
    });
    assert.deepEqual(resultOf({ execution: { status: 'error', error: { name: 'TestFailed', message: 'Test failed for step x' } } }).failures, [
      { message: 'Test failed for step x' }
    ]);
  });

  test('an error without a message, or a step without an execution, is still an error', () => {
    assert.deepEqual(resultOf({ execution: { status: 'error' } }).failures, [{ message: 'The step failed' }]);
    assert.equal(resultOf({}).status, 'errored');
  });
});

describe('show', () => {
  test('writes a value the way a diff shows it', () => {
    assert.equal(show('text'), 'text');
    assert.equal(show(undefined), 'undefined');
    assert.equal(show({ a: 1 }), '{\n  "a": 1\n}');
    assert.equal(show(() => 1), String(() => 1));

    const circular: any = {};
    circular.self = circular;
    assert.equal(show(circular), '[object Object]');
  });
});
