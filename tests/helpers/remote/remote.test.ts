jest.mock('yargs-parser', () => () => ({}));

jest.mock('../../../src/helpers/config', () => {
  let stored = {};
  return {
    load: jest.fn(async () => stored),
    save: jest.fn(async (name, data) => { stored = data; return data; }),
    __set: (value) => { stored = value; }
  };
});

jest.mock('../../../src/helpers/env', () => {
  let stored: Record<string, string> = {};
  return {
    read: jest.fn(async (key) => stored[key]),
    write: jest.fn(async (key, value) => { stored[key] = String(value); }),
    __set: (value) => { stored = value; }
  };
});

jest.mock('../../../src/helpers/paths');
jest.mock('../../../src/helpers/git');
jest.mock('../../../src/helpers/applications');
jest.mock('../../../src/helpers/envTransfer');

import fs from 'fs';
import os from 'os';
import path from 'path';

import * as configHelper from '../../../src/helpers/config';
import * as paths from '../../../src/helpers/paths';
import * as git from '../../../src/helpers/git';
import * as applications from '../../../src/helpers/applications';
import * as envTransfer from '../../../src/helpers/envTransfer';
import * as crypto from '../../../src/helpers/remote/crypto';
import * as topics from '../../../src/helpers/remote/topics';
import * as agentModule from '../../../src/helpers/remote/agent';
import * as client from '../../../src/helpers/remote/client';
import { createBus, flush } from './fakeBus';
import type { FakeConnection } from './fakeBus';

/**
 * The agent and the person's side, on one in-memory bus, with the runner
 * replaced by a fake that emits what a run emits.
 */

const FLOW = '# Refund\n\n```step\napplication: payments\nmethod: refund\n```\n';

let root: string;
let agentContext: string;
let localContext: string;
let bus: ReturnType<typeof createBus>;
let identity;

/** What the fake runner does when the agent starts a flow. */
let script: (io: { emit: (event: string, payload: any) => void }) => void;

const fakeFlows = {
  resolveWithinFlows: jest.fn(async (relativePath: string) => ({
    flowsDir: path.join(agentContext, 'flows'),
    absolute: path.join(agentContext, 'flows', relativePath),
    relative: relativePath
  })),
  start: jest.fn(async (body, { io }) => {
    setImmediate(() => script(io));
    return { execution: { id: 'exec-1' } };
  })
};

const fakeTestRuns = {
  runsRoot: jest.fn(async () => path.join(agentContext, 'test-runs')),
  startFolderRun: jest.fn(async ({ io }) => {
    setImmediate(() => script(io));
    return { id: 'run-view' };
  }),
  prepareFolderRun: jest.fn(async () => ({
    targets: [{ file: 'a.md', content: FLOW, title: 'A' }, { file: 'b.md', content: FLOW, title: 'B' }],
    view: 'Smoke'
  }))
};

const localTestRuns = {
  runsRoot: jest.fn(async () => path.join(localContext, 'test-runs')),
  prepareFolderRun: fakeTestRuns.prepareFolderRun
};

const localFlows = {
  resolveWithinFlows: jest.fn(async (relativePath: string) => ({
    flowsDir: path.join(localContext, 'flows'),
    absolute: path.join(localContext, 'flows', relativePath),
    relative: relativePath
  }))
};

const fakeInputs = { answer: jest.fn(() => true), cancel: jest.fn(() => true) };

const agentDeps = (): agentModule.AgentDeps => ({
  flows: () => fakeFlows,
  testRuns: () => fakeTestRuns,
  git: git as any,
  envTransfer: envTransfer as any,
  inputs: fakeInputs as any
});

const clientDeps = (): client.ClientDeps => ({
  connect: bus.connect as any,
  testRuns: () => localTestRuns,
  flows: () => localFlows,
  statusWaitMs: 50
});

/** A run that passes: one step, then the summary that closes the run. */
const passingRun = (id = 'run-1') => (io) => {
  const dir = path.join(agentContext, 'test-runs', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ id, status: 'passed' }));
  fs.writeFileSync(path.join(dir, 'refund.md'), '# Refund\n\n```step-result\nok\n```\n');

  io.emit('flowexecution:update', { id: 'exec-1', topic: 'execution', data: { status: 'running' } });
  io.emit('testrun:update', { id, run: { id, status: 'running', flows: [{ file: 'refund.md', status: 'running' }] } });
  io.emit('flowexecution:update', {
    id: 'exec-1', topic: 'step', data: { id: 's1', data: { id: 's1', execution: { status: 'passed' } } }
  });
  io.emit('testrun:update', { id, run: { id, status: 'passed', flows: [{ file: 'refund.md', status: 'passed' }] } });
};

const startAgent = async (name = 'agent-ourense') => {
  identity = { id: name, ...crypto.generateKeyPair(), fingerprint: '' };
  identity.fingerprint = crypto.fingerprint(identity.publicKey);

  const connection = await bus.connect({ url: 'mqtt://bus', clientId: `flows-agent-${name}`, will: agentModule.will(name) });
  const running = await agentModule.start({ identity, connection }, agentDeps());
  return { connection: connection as FakeConnection, running };
};

const retainedStatus = (name = 'agent-ourense') => JSON.parse(bus.retained.get(topics.status(name))!.toString());

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-remote-'));
  agentContext = path.join(root, 'agent');
  localContext = path.join(root, 'local');
  fs.mkdirSync(path.join(agentContext, 'flows'), { recursive: true });
  fs.mkdirSync(path.join(localContext, 'flows'), { recursive: true });
  fs.writeFileSync(path.join(agentContext, 'flows', 'refund.md'), FLOW);
  fs.writeFileSync(path.join(localContext, 'flows', 'refund.md'), FLOW);

  bus = createBus();
  script = passingRun();

  (configHelper as any).__set({ broker: { url: 'mqtt://bus', username: 'jose' } });
  (paths.contextRoot as jest.Mock).mockImplementation(async () => localContext);
  (git.info as jest.Mock).mockResolvedValue({ changes: [], ahead: 0 });
  (git.run as jest.Mock).mockImplementation(async (args) => (args[0] === 'rev-parse' ? 'abcdef1234567890' : ''));
  (applications.applicationsOf as jest.Mock).mockReturnValue(['payments']);
  (envTransfer.exportSelection as jest.Mock).mockResolvedValue({
    yaml: 'version: 1\napplications:\n  payments:\n    uat:\n      API_KEY: secret\n'
  });
  (envTransfer.importDocument as jest.Mock).mockResolvedValue({ summary: { files: 1 } });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('a flow on an agent', () => {
  test('runs there, its events play back here and the results land in this test-runs', async () => {
    const { connection: agentConnection } = await startAgent();

    const events: Array<[string, any]> = [];
    const io = { emit: jest.fn() };

    const result = await client.run({
      agent: 'agent-ourense', environment: 'uat', file: 'refund.md', io,
      onEvent: (event, payload) => events.push([event, payload])
    }, clientDeps());

    // The agent ran the same flow through the ordinary start
    expect(fakeFlows.start).toHaveBeenCalledWith(
      { value: FLOW, environment: 'uat', path: 'refund.md' }, expect.anything()
    );

    // ...after checking out the commit this context is on
    expect(git.run).toHaveBeenCalledWith(['fetch', '--all'], localContext);
    expect(git.run).toHaveBeenCalledWith(['checkout', '--detach', 'abcdef1234567890'], localContext);

    // ...and importing the variables, which travelled sealed
    expect(envTransfer.importDocument).toHaveBeenCalledWith(expect.stringContaining('API_KEY: secret'));
    const request = bus.log.find(entry => entry.topic.endsWith('/request'));
    expect(JSON.stringify(request!.payload)).not.toContain('secret');
    expect(request!.payload.env.v).toBe(1);

    // The events reached both listeners
    expect(events.map(([event]) => event))
      .toEqual(expect.arrayContaining(['remote:job', 'flowexecution:update', 'testrun:update']));
    expect(io.emit).toHaveBeenCalledWith('flowexecution:update', expect.objectContaining({ topic: 'step' }));

    // The run folder was copied over
    expect(result.testRun).toEqual({ id: 'run-1', status: 'passed', flows: [{ file: 'refund.md', status: 'passed' }] });
    expect(result.dir).toBe(path.join(localContext, 'test-runs', 'run-1'));
    expect(fs.readFileSync(path.join(result.dir, 'run.json'), 'utf8')).toBe('{"id":"run-1","status":"passed"}');
    expect(fs.existsSync(path.join(result.dir, 'refund.md'))).toBe(true);
    expect(result.warnings).toEqual([]);

    // The agent is free again, and its key is now trusted here
    expect(retainedStatus()).toMatchObject({ online: true, busy: false, agent: 'agent-ourense', publicKey: identity.publicKey });
    expect((configHelper as any).save).toHaveBeenCalledWith('remote', expect.objectContaining({
      agents: { 'agent-ourense': expect.objectContaining({ publicKey: identity.publicKey }) }
    }));

    expect(agentConnection.closed).toBe(false);
  });

  test('a view runs through startFolderRun', async () => {
    await startAgent();
    script = passingRun('run-view');

    const result = await client.run({
      agent: 'agent-ourense', environment: 'uat', view: 'smoke', folder: 'payments'
    }, clientDeps());

    expect(fakeTestRuns.startFolderRun).toHaveBeenCalledWith(
      expect.objectContaining({ view: 'smoke', folder: 'payments', environment: 'uat' })
    );
    expect(localTestRuns.prepareFolderRun).toHaveBeenCalledWith({ folder: 'payments', view: 'smoke', environment: 'uat' });
    expect(result.testRun.id).toBe('run-view');
  });

  test('a step that asks for a value is answered from here', async () => {
    await startAgent();
    script = (io) => {
      io.emit('flowexecution:update', {
        id: 'exec-1', topic: 'input', data: { id: 'in-1', kind: 'text', label: 'Barcode', status: 'pending' }
      });
      io.emit('flowexecution:update', {
        id: 'exec-1', topic: 'input', data: { id: 'in-2', kind: 'text', label: 'Other', status: 'pending' }
      });
      setTimeout(() => passingRun()(io), 20);
    };

    const onInput = jest.fn(async (request) => (request.id === 'in-1' ? '4711' : null));

    await client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md', onInput }, clientDeps());

    expect(onInput).toHaveBeenCalledTimes(2);
    expect(fakeInputs.answer).toHaveBeenCalledWith('in-1', '4711');
    expect(fakeInputs.cancel).toHaveBeenCalledWith('in-2', 'Input was cancelled');
  });

  test('what would not make it to the agent is a warning, not a stop', async () => {
    await startAgent();
    (git.info as jest.Mock).mockResolvedValue({ changes: [{ path: 'flows/x.md' }], ahead: 2 });
    (envTransfer.exportSelection as jest.Mock).mockRejectedValue(new Error('Nothing to export'));

    const result = await client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md' }, clientDeps());

    expect(result.warnings).toEqual([
      '1 uncommitted change(s) in the context will not run on the agent',
      '2 commit(s) not pushed: the agent cannot fetch abcdef123456 until they are',
      'No environment variables sent: Nothing to export'
    ]);
    expect(envTransfer.importDocument).not.toHaveBeenCalled();
  });

  test('a context that is not a repository sends no commit', async () => {
    await startAgent();
    (git.info as jest.Mock).mockResolvedValue(null);
    (applications.applicationsOf as jest.Mock).mockReturnValue([]);

    const result = await client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md' }, clientDeps());

    expect(result.warnings).toEqual([
      'The context is not a git repository: the agent runs whatever copy of the flows it has'
    ]);
    expect(git.run).not.toHaveBeenCalledWith(['fetch', '--all'], expect.anything());

    (git.info as jest.Mock).mockResolvedValue({ changes: [], ahead: 0 });
    (git.run as jest.Mock).mockRejectedValue(new Error('no HEAD'));
    const empty = await client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md' }, clientDeps());
    expect(empty.warnings[0]).toContain('has no commits yet');
  });
});

describe('when things go wrong', () => {
  test('an agent that never connected', async () => {
    await expect(client.run({ agent: 'ghost', environment: 'uat', file: 'refund.md' }, clientDeps()))
      .rejects.toThrow('Agent "ghost" has never connected to this broker');
  });

  test('an agent that is offline', async () => {
    const { connection } = await startAgent();
    connection.drop();

    await expect(client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md' }, clientDeps()))
      .rejects.toThrow('Agent "agent-ourense" is offline');
  });

  test('an agent that is busy, seen from its status and from its answer', async () => {
    await startAgent();
    script = (io) => { setTimeout(() => passingRun()(io), 100); };

    const first = client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md' }, clientDeps());
    await flush();

    await expect(client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md' }, clientDeps()))
      .rejects.toThrow('is busy with job');

    // A request that slipped past the status is rejected by the agent itself
    const sneaky = await bus.connect('sneaky');
    const answers: any[] = [];
    await sneaky.subscribe(
      topics.job('agent-ourense', 'sneaky-job', 'events'),
      message => answers.push(JSON.parse(message.payload.toString()))
    );
    await sneaky.publish(topics.job('agent-ourense', 'sneaky-job', 'request'), { environment: 'uat', flow: { path: 'refund.md' } });
    await flush();
    expect(answers[0]).toMatchObject({ event: 'remote:job', payload: { status: 'rejected' } });

    await expect(first).resolves.toMatchObject({ testRun: { status: 'passed' } });
  });

  test('a flow the agent does not have', async () => {
    await startAgent();
    fakeFlows.resolveWithinFlows.mockResolvedValueOnce({
      flowsDir: '', absolute: path.join(agentContext, 'nope.md'), relative: 'nope.md'
    });

    await expect(client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md' }, clientDeps()))
      .rejects.toThrow('Flow not found on the agent: refund.md');
  });

  test('a flow this context does not have', async () => {
    await startAgent();
    await expect(client.run({ agent: 'agent-ourense', environment: 'uat', file: 'missing.md' }, clientDeps()))
      .rejects.toThrow('Flow not found: missing.md');
  });

  test('an agent whose key changed', async () => {
    await startAgent();
    (configHelper as any).__set({
      broker: { url: 'mqtt://bus' },
      agents: { 'agent-ourense': { publicKey: crypto.generateKeyPair().publicKey, fingerprint: 'old', since: 1 } }
    });

    await expect(client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md' }, clientDeps()))
      .rejects.toThrow('has changed');
  });

  test('an agent that dies during the run', async () => {
    const { connection } = await startAgent();
    script = () => { setTimeout(() => connection.drop(), 10); };

    await expect(client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md' }, clientDeps()))
      .rejects.toThrow('went offline during the run');
  });

  test('a result that never comes, with a timeout', async () => {
    await startAgent();
    script = () => {};

    await expect(client.run({
      agent: 'agent-ourense', environment: 'uat', file: 'refund.md', timeoutMs: 30
    }, clientDeps())).rejects.toThrow('No result from agent "agent-ourense" after 30 ms');
  });

  test('what the client refuses before touching the broker', async () => {
    await expect(client.run({ agent: '', environment: 'uat', file: 'x' } as any, clientDeps()))
      .rejects.toThrow('No agent named');
    await expect(client.run({ agent: 'a', environment: '', file: 'x' } as any, clientDeps()))
      .rejects.toThrow('No environment specified');
    await expect(client.run({ agent: 'a', environment: 'uat' } as any, clientDeps()))
      .rejects.toThrow('Name a flow (--file) or a view (--view)');
    await expect(client.run({ agent: 'bad/name', environment: 'uat', file: 'x' }, clientDeps()))
      .rejects.toThrow('not usable');
  });
});

describe('the agent on its own', () => {
  test('ignores what is not a job, and a request the broker kept from before it connected', async () => {
    const other = await bus.connect('other');

    // Left on the broker while no agent was there: it must not run on the
    // next one to connect
    await other.publish(
      topics.job('agent-ourense', 'j2', 'request'),
      { environment: 'uat', flow: { path: 'refund.md' } },
      { retain: true }
    );

    await startAgent();

    await other.publish(topics.job('agent-ourense', 'j1', 'request'), 'not json');
    await other.publish(topics.job('agent-ourense', 'j3', 'input'), 'not json');
    await other.publish(topics.job('agent-ourense', 'j3', 'input'), { value: 'no id' });
    await flush();

    expect(fakeFlows.start).not.toHaveBeenCalled();
    expect(fakeInputs.answer).not.toHaveBeenCalled();
  });

  test('a job with nothing to run fails on its events topic', async () => {
    await startAgent();
    const other = await bus.connect('other');
    const answers: any[] = [];
    await other.subscribe(topics.jobs('agent-ourense', 'events'), message => answers.push(JSON.parse(message.payload.toString())));

    await other.publish(topics.job('agent-ourense', 'j1', 'request'), { flow: { path: 'refund.md' } });
    await flush();
    expect(answers.pop()).toMatchObject({ payload: { status: 'failed', message: 'The job names no environment' } });

    await other.publish(topics.job('agent-ourense', 'j2', 'request'), { environment: 'uat' });
    await flush();
    expect(answers.pop()).toMatchObject({ payload: { status: 'failed', message: 'The job names neither a flow nor a view' } });

    await other.publish(
      topics.job('agent-ourense', 'j3', 'request'),
      { environment: 'uat', flow: { path: 'refund.md' }, ref: 'not-a-commit' }
    );
    await flush();
    expect(answers.pop()).toMatchObject({ payload: { status: 'failed', message: '"not-a-commit" is not a commit id' } });

    (git.info as jest.Mock).mockResolvedValueOnce(null);
    await other.publish(
      topics.job('agent-ourense', 'j4', 'request'),
      { environment: 'uat', flow: { path: 'refund.md' }, ref: 'abcdef1' }
    );
    await flush();
    expect(answers.pop()).toMatchObject({
      payload: { status: 'failed', message: expect.stringContaining('not a git repository') }
    });
  });

  test('a document sealed to someone else does not open', async () => {
    await startAgent();
    const other = await bus.connect('other');
    const answers: any[] = [];
    await other.subscribe(topics.jobs('agent-ourense', 'events'), message => answers.push(JSON.parse(message.payload.toString())));

    const stranger = crypto.generateKeyPair();
    await other.publish(topics.job('agent-ourense', 'j1', 'request'), {
      environment: 'uat', flow: { path: 'refund.md' }, env: crypto.seal(stranger.publicKey, 'x')
    });
    await flush();

    expect(answers.pop()).toMatchObject({
      payload: { status: 'failed', message: expect.stringContaining('not sealed for this agent') }
    });
    expect(envTransfer.importDocument).not.toHaveBeenCalled();
  });

  test('says it is back after a reconnection, and goodbye when stopped', async () => {
    const { connection, running } = await startAgent();

    connection.drop();
    expect(console.warn).toHaveBeenCalledWith('Lost the broker: reconnecting');
    expect(retainedStatus()).toMatchObject({ online: false });

    connection.reconnect();
    await flush();
    expect(retainedStatus()).toMatchObject({ online: true, busy: false });

    await running.stop();
    expect(retainedStatus()).toMatchObject({ online: false });
    expect(connection.closed).toBe(true);
  });

  test('a publish that fails is logged, not fatal', async () => {
    const { connection } = await startAgent();
    const publish = connection.publish;
    (connection as any).publish = jest.fn(async (topic, payload, options) => {
      if (topic.endsWith('/events') && payload.event === 'remote:job' && payload.payload.status === 'accepted') {
        throw new Error('flaky');
      }
      return publish(topic, payload, options);
    });

    await expect(client.run({ agent: 'agent-ourense', environment: 'uat', file: 'refund.md' }, clientDeps()))
      .resolves.toBeTruthy();
    expect(console.error).toHaveBeenCalledWith('Could not publish remote:job:', 'flaky');
  });
});
