jest.mock('yargs-parser', () => () => ({}));

// The context every run here resolves against
jest.mock('../../src/helpers/paths', () => ({
  contextRoot: jest.fn(async () => '/ctx'),
  contextDir: jest.fn(async (parts) => require('path').join('/ctx', ...(parts || [])))
}));

import { EventEmitter } from 'events';

import * as packageJson from '../../package.json';
import * as ipc from '../../src/helpers/ipc';

/**
 * Both ends of a channel, in memory: what the CLI sent, and a way to talk to
 * it the way an editor would.
 */
const link = () => {
  const sent: any[] = [];
  const editor = new EventEmitter();

  const channel: ipc.Channel = {
    send: jest.fn(async (message) => { sent.push(message); }),
    onMessage: (listener) => { editor.on('message', listener); },
    onDisconnect: (listener) => { editor.on('disconnect', listener); }
  };

  return {
    channel,
    sent,
    of: (type: string) => sent.filter(message => message.type === type),
    tell: (message: unknown) => editor.emit('message', message),
    drop: () => editor.emit('disconnect')
  };
};

/** The modules a run goes through, faked: a run that passes unless told otherwise. */
const fakes = (overrides: { status?: string; execute?: (run: any) => Promise<void> } = {}) => {
  const run: any = { id: 'run-1', dir: '/ctx/test-runs/run-1', io: null, summary: null };

  const testRuns = {
    prepareFolderRun: jest.fn(async ({ files, view }) => ({
      targets: (files || ['smoke/a.md', 'smoke/b.md']).map(file => ({ file, content: `# ${file}`, title: file })),
      view
    })),
    create: jest.fn(async (options) => {
      run.io = options.io;
      run.summary = {
        id: 'run-1',
        status: 'running',
        flows: options.flows.map(flow => ({ file: flow.file, title: flow.title, status: 'pending' }))
      };
      return run;
    }),
    executeFolderRun: jest.fn(overrides.execute || (async (current) => {
      current.io.emit('flowexecution:update', { id: 'e1', topic: 'step', data: { id: 'calculator-add' } });
      current.summary.status = overrides.status || 'passed';
      current.io.emit('testrun:update', { id: 'run-1', run: current.summary });
    })),
    abandon: jest.fn()
  };

  const bases = {
    load: jest.fn(async () => ({
      views: [{ name: 'All flows', slug: 'all-flows' }, { name: 'Smoke tests', slug: 'smoke-tests' }]
    })),
    findView: jest.fn((views, wanted) => views.find(view => view.slug === wanted || view.name === wanted) || null)
  };

  const deps: ipc.IpcDeps = {
    testRuns: () => testRuns,
    applications: () => ({ loadAll: jest.fn(async () => {}) }),
    bases: () => bases,
    inputs: { answer: jest.fn(() => true), cancel: jest.fn(() => true), cancelAll: jest.fn() },
    exit: jest.fn()
  };

  return { run, testRuns, bases, deps };
};

/** Let every promise that is ready settle. */
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('ipc.channel', () => {
  test('is null for a process nobody started with a channel', () => {
    expect(ipc.channel({ on: jest.fn() })).toBeNull();
  });

  test('is null once the channel is closed', () => {
    expect(ipc.channel({ send: jest.fn(), connected: false, on: jest.fn() })).toBeNull();
  });

  test('sends, and resolves once the message has left', async () => {
    let done: (error: Error | null) => void = () => {};
    const send = jest.fn((_message, callback) => { done = callback; return true; });
    const proc = { send, connected: true, on: jest.fn() };
    const channel = ipc.channel(proc)!;

    let resolved = false;
    const sending = channel.send({ type: 'error', message: 'x' }).then(() => { resolved = true; });
    await settle();
    expect(resolved).toBe(false);

    done(null);
    await sending;
    expect(proc.send).toHaveBeenCalledWith({ type: 'error', message: 'x' }, expect.any(Function));
  });

  test('a channel that broke under it is not a reason to fail', async () => {
    const proc = { send: jest.fn(() => { throw new Error('channel closed'); }), on: jest.fn() };

    await expect(ipc.channel(proc)!.send({ type: 'error', message: 'x' })).resolves.toBeUndefined();
  });

  test('listens for messages and for the other end going away', () => {
    const proc = { send: jest.fn(), on: jest.fn() };
    const channel = ipc.channel(proc)!;
    const onMessage = jest.fn();
    const onDisconnect = jest.fn();

    channel.onMessage(onMessage);
    channel.onDisconnect(onDisconnect);

    expect(proc.on).toHaveBeenCalledWith('message', onMessage);
    expect(proc.on).toHaveBeenCalledWith('disconnect', onDisconnect);
  });
});

describe('ipc.plain', () => {
  test('keeps what JSON keeps, and drops functions', () => {
    expect(ipc.plain({ a: 1, b: 'two', c: [true, null], d: () => 1 })).toEqual({ a: 1, b: 'two', c: [true, null] });
  });

  test('cuts a reference back to an object it is inside of', () => {
    const step: any = { id: 's1' };
    step.self = step;
    const flow = { steps: [step] };

    expect(ipc.plain(flow)).toEqual({ steps: [{ id: 's1', self: '[Circular]' }] });
  });

  test('keeps an object the payload holds twice, which is not a cycle', () => {
    // The runner keeps a step's parameters and its request as the same object
    const params = { body: { a: 1 } };

    expect(ipc.plain({ parameters: params, request: params })).toEqual({ parameters: params, request: params });
  });

  test('writes a bigint as text', () => {
    expect(ipc.plain({ offset: BigInt(42) })).toEqual({ offset: '42' });
  });

  test('says nothing for nothing, and null for what cannot be written', () => {
    expect(ipc.plain(undefined)).toBeUndefined();
    expect(ipc.plain(() => 1)).toBeNull();
    expect(ipc.plain({ toJSON: () => { throw new Error('no'); } })).toBeNull();
  });
});

describe('ipc.run', () => {
  test('says hello first: the protocol, the version and the context', async () => {
    const { channel, sent } = link();
    const { deps } = fakes();

    await ipc.run({ files: ['flows/smoke/a.md'], environment: 'local' }, channel, deps);

    expect(sent[0]).toEqual({ type: 'hello', protocol: ipc.PROTOCOL, version: packageJson.version, context: '/ctx' });
  });

  test('runs the files named as one test run, and passes', async () => {
    const { channel, of } = link();
    const { deps, testRuns, run } = fakes();

    const code = await ipc.run({
      files: ['flows/smoke/a.md', '/ctx/flows/smoke/b.md'],
      environment: 'local'
    }, channel, deps);

    expect(code).toBe(0);
    // Relative to the flows directory, which is how a run records them,
    // whether they were named relative to the context or absolutely
    expect(testRuns.prepareFolderRun).toHaveBeenCalledWith(expect.objectContaining({
      files: ['smoke/a.md', 'smoke/b.md'],
      environment: 'local'
    }));
    expect(testRuns.create).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'cli',
      environment: 'local',
      flows: [expect.objectContaining({ file: 'smoke/a.md' }), expect.objectContaining({ file: 'smoke/b.md' })]
    }));
    expect(testRuns.create.mock.calls[0][0]).not.toHaveProperty('folder');
    expect(testRuns.executeFolderRun).toHaveBeenCalledWith(run, expect.any(Array), { environment: 'local' });
    expect(of('done')).toEqual([{ type: 'done', run: expect.objectContaining({ id: 'run-1', status: 'passed' }) }]);
  });

  test('forwards what the run emits, as the UI gets it', async () => {
    const { channel, of } = link();
    const { deps } = fakes();

    await ipc.run({ files: ['flows/a.md'], environment: 'local' }, channel, deps);

    expect(of('event')).toEqual([
      { type: 'event', event: 'flowexecution:update', payload: { id: 'e1', topic: 'step', data: { id: 'calculator-add' } } },
      { type: 'event', event: 'testrun:update', payload: { id: 'run-1', run: expect.objectContaining({ status: 'passed' }) } }
    ]);
  });

  test('a run that failed ends with 1', async () => {
    const { channel, of } = link();
    const { deps } = fakes({ status: 'failed' });

    await expect(ipc.run({ files: ['flows/a.md'], environment: 'local' }, channel, deps)).resolves.toBe(1);
    expect(of('done')[0].run.status).toBe('failed');
  });

  test('runs a view, found by its slug, scoped to a folder', async () => {
    const { channel } = link();
    const { deps, testRuns, bases } = fakes();

    const code = await ipc.run({ files: [], view: 'smoke-tests', folder: 'payments', environment: 'uat' }, channel, deps);

    expect(code).toBe(0);
    expect(bases.findView).toHaveBeenCalledWith(expect.any(Array), 'smoke-tests');
    expect(testRuns.prepareFolderRun).toHaveBeenCalledWith({
      files: undefined, folder: 'payments', view: 'Smoke tests', environment: 'uat'
    });
    expect(testRuns.create).toHaveBeenCalledWith(expect.objectContaining({ folder: 'payments', view: 'Smoke tests' }));
  });

  test('a bare view is the first one, over every flow', async () => {
    const { channel } = link();
    const { deps, testRuns } = fakes();
    deps.bases().findView.mockImplementation((views) => views[0]);

    await ipc.run({ files: [], view: '', environment: 'uat' }, channel, deps);

    expect(testRuns.prepareFolderRun).toHaveBeenCalledWith(expect.objectContaining({ folder: '', view: 'All flows' }));
  });

  test('a view that does not exist is refused, naming the ones that do', async () => {
    const { channel, of } = link();
    const { deps, testRuns } = fakes();

    const code = await ipc.run({ files: [], view: 'nightly', environment: 'uat' }, channel, deps);

    expect(code).toBe(1);
    expect(of('error')[0].message).toBe('View not found: nightly. 2 available: all-flows, smoke-tests');
    expect(testRuns.create).not.toHaveBeenCalled();
  });

  test('refuses to start without an environment', async () => {
    const { channel, of } = link();
    const { deps, testRuns } = fakes();

    const code = await ipc.run({ files: ['flows/a.md'], environment: null }, channel, deps);

    expect(code).toBe(1);
    expect(of('error')[0].message).toContain('--env');
    expect(testRuns.prepareFolderRun).not.toHaveBeenCalled();
  });

  test('refuses to start with nothing to run', async () => {
    const { channel, of } = link();
    const { deps } = fakes();

    const code = await ipc.run({ files: [], view: null, environment: 'local' }, channel, deps);

    expect(code).toBe(1);
    expect(of('error')[0].message).toContain('--file');
  });

  test('a run that cannot start says why, and records nothing', async () => {
    const { channel, of } = link();
    const { deps, testRuns } = fakes();
    testRuns.prepareFolderRun.mockRejectedValueOnce(new Error('Missing environment file for "uat": payments'));

    const code = await ipc.run({ files: ['flows/a.md'], environment: 'uat' }, channel, deps);

    expect(code).toBe(1);
    expect(of('error')).toEqual([{ type: 'error', message: 'Missing environment file for "uat": payments' }]);
    expect(testRuns.create).not.toHaveBeenCalled();
    expect(of('done')).toEqual([]);
  });

  test('something thrown that is not an error is still said', async () => {
    const { channel, of } = link();
    const { deps, testRuns } = fakes();
    testRuns.prepareFolderRun.mockRejectedValueOnce('busy');

    await ipc.run({ files: ['flows/a.md'], environment: 'uat' }, channel, deps);

    expect(of('error')[0].message).toBe('busy');
  });

  test('answers what a step asked with what the editor said', async () => {
    const { channel, tell } = link();
    const { deps } = fakes({
      execute: async (current) => {
        tell({ type: 'input', id: 'q1', value: '  4006381333931 ' });
        tell({ type: 'input', id: 'q2' });
        tell({ type: 'input', id: 'q3', cancel: true });
        current.summary.status = 'passed';
      }
    });

    await ipc.run({ files: ['flows/a.md'], environment: 'local' }, channel, deps);

    expect(deps.inputs.answer).toHaveBeenCalledWith('q1', '  4006381333931 ');
    expect(deps.inputs.answer).toHaveBeenCalledWith('q2', '');
    expect(deps.inputs.cancel).toHaveBeenCalledWith('q3', 'Input was cancelled');
  });

  test('ignores what it does not understand', async () => {
    const { channel, tell } = link();
    const { deps } = fakes({
      execute: async (current) => {
        tell(null);
        tell('hello');
        tell({ type: 'input' });
        tell({ type: 'shrug' });
        current.summary.status = 'passed';
      }
    });

    await expect(ipc.run({ files: ['flows/a.md'], environment: 'local' }, channel, deps)).resolves.toBe(0);
    expect(deps.inputs.answer).not.toHaveBeenCalled();
    expect(deps.exit).not.toHaveBeenCalled();
  });

  test('a cancel closes the run as failed, with the documents, and ends the process', async () => {
    const { channel, tell } = link();
    let release: () => void = () => {};
    const { deps, testRuns, run } = fakes({ execute: () => new Promise<void>(resolve => { release = resolve; }) });

    void ipc.run({ files: ['flows/smoke/a.md'], environment: 'local' }, channel, deps);
    await settle();

    tell({ type: 'cancel' });
    tell({ type: 'cancel', reason: 'again' });

    expect(deps.inputs.cancelAll).toHaveBeenCalledWith('The run was cancelled');
    expect(testRuns.abandon).toHaveBeenCalledTimes(1);
    expect(testRuns.abandon).toHaveBeenCalledWith(run, 'The run was cancelled', { 'smoke/a.md': '# smoke/a.md' });
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(ipc.CANCELLED);

    release();
  });

  test('a cancel says why when it was told', async () => {
    const { channel, tell } = link();
    const { deps, testRuns } = fakes({ execute: () => new Promise<void>(() => {}) });

    void ipc.run({ files: ['flows/a.md'], environment: 'local' }, channel, deps);
    await settle();
    tell({ type: 'cancel', reason: 'Stopped from the editor' });

    expect(testRuns.abandon).toHaveBeenCalledWith(expect.anything(), 'Stopped from the editor', expect.anything());
  });

  test('a cancel before anything was recorded only ends the process', async () => {
    const { channel, tell } = link();
    const { deps, testRuns } = fakes();
    testRuns.prepareFolderRun.mockImplementationOnce(() => new Promise(() => {}));

    void ipc.run({ files: ['flows/a.md'], environment: 'local' }, channel, deps);
    await settle();
    tell({ type: 'cancel' });

    expect(testRuns.abandon).not.toHaveBeenCalled();
    expect(deps.exit).toHaveBeenCalledWith(ipc.CANCELLED);
  });

  test('the editor going away stops the run like a cancel', async () => {
    const { channel, drop } = link();
    const { deps, testRuns } = fakes({ execute: () => new Promise<void>(() => {}) });

    void ipc.run({ files: ['flows/a.md'], environment: 'local' }, channel, deps);
    await settle();
    drop();

    expect(testRuns.abandon).toHaveBeenCalledWith(expect.anything(), 'The program that started the run went away', expect.anything());
    expect(deps.exit).toHaveBeenCalledWith(ipc.CANCELLED);
  });

  test('a run that cannot be recorded as cancelled still ends', async () => {
    const { channel, tell } = link();
    const { deps, testRuns } = fakes({ execute: () => new Promise<void>(() => {}) });
    testRuns.abandon.mockImplementation(() => { throw new Error('disk full'); });

    void ipc.run({ files: ['flows/a.md'], environment: 'local' }, channel, deps);
    await settle();
    tell({ type: 'cancel' });

    expect((console.error as jest.Mock).mock.calls.join(' ')).toContain('Could not record the cancelled run');
    expect(deps.exit).toHaveBeenCalledWith(ipc.CANCELLED);
  });
});

describe('ipc.flush', () => {
  test('waits until every stream has let go of what it was given', async () => {
    const callbacks: Array<() => void> = [];
    const stream = () => ({ write: jest.fn((_chunk, callback) => { callbacks.push(callback); return true; }) });
    const streams = [stream(), stream()];

    let flushed = false;
    const flushing = ipc.flush(streams as any).then(() => { flushed = true; });
    await settle();
    expect(flushed).toBe(false);

    callbacks.forEach(callback => callback());
    await flushing;
    expect(flushed).toBe(true);
  });

  test('a stream that cannot be written to does not hold the exit up', async () => {
    const broken = { write: jest.fn(() => { throw new Error('EPIPE'); }) };

    await expect(ipc.flush([broken] as any)).resolves.toBeUndefined();
  });

  test('flushes the terminal streams by default', async () => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(((_chunk, callback) => { callback(); return true; }) as any);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(((_chunk, callback) => { callback(); return true; }) as any);

    await ipc.flush();

    expect(stdout).toHaveBeenCalledWith('', expect.any(Function));
    expect(stderr).toHaveBeenCalledWith('', expect.any(Function));
  });
});
