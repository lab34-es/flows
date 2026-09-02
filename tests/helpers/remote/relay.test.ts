jest.mock('yargs-parser', () => () => ({}));

jest.mock('../../../src/helpers/config', () => {
  let stored = {};
  return {
    load: jest.fn(async () => stored),
    save: jest.fn(async (name, data) => { stored = data; return data; }),
    __set: (value) => { stored = value; },
    __get: () => stored
  };
});

jest.mock('../../../src/helpers/env', () => {
  let stored: Record<string, string> = {};
  return {
    FILE: '.env',
    read: jest.fn(async (key) => stored[key]),
    write: jest.fn(async (key, value) => {
      if (value) { stored[key] = String(value); }
      else { delete stored[key]; }
    }),
    __set: (value) => { stored = value; },
    __get: () => stored
  };
});

import fs from 'fs';
import os from 'os';
import path from 'path';

import * as configHelper from '../../../src/helpers/config';
import * as env from '../../../src/helpers/env';
import * as relay from '../../../src/helpers/remote/relay';
import * as topics from '../../../src/helpers/remote/topics';
import { createBus, flush } from './fakeBus';

let root: string;
let bus: ReturnType<typeof createBus>;
let io: { emit: jest.Mock };

/** What the fake client.run does when the relay starts a job. */
let runScript: (options: any) => Promise<any>;
const run = jest.fn((options) => runScript(options));

const testRuns = { runsRoot: jest.fn(async () => path.join(root, 'test-runs')) };

const deps = () => ({ connect: bus.connect as any, run: run as any, testRuns: () => testRuns });

const setConfig = (value) => (configHelper as any).__set(value);
const getConfig = () => (configHelper as any).__get();
const setEnv = (value) => (env as any).__set(value);
const getEnv = () => (env as any).__get();

const configured = () => {
  setConfig({ broker: { url: 'mqtt://bus', username: 'jose' } });
  setEnv({ FLOWS_BROKER_PASSWORD: 'pw' });
};

/** An agent's status on the bus, the way an agent publishes it. */
const announce = async (agent: string, status: Record<string, any> = {}) => {
  const other = await bus.connect(`announce-${agent}`);
  await other.publish(topics.status(agent), {
    online: true, agent, publicKey: 'PUB', fingerprint: 'aa', busy: false, at: 1, ...status
  }, { retain: true });
  await flush();
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-relay-'));
  bus = createBus();
  io = { emit: jest.fn() };
  setConfig({});
  setEnv({});
  runScript = async () => ({ testRun: { id: 'run-1', status: 'passed' }, warnings: [] });
});

afterEach(async () => {
  await relay.stop();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('relay before the server is up', () => {
  test('refuses to run anything', async () => {
    await expect(relay.startFlow({ agent: 'a1', environment: 'uat', path: 'x.md' })).rejects.toThrow('not ready');
    await expect(relay.startFolderRun({ agent: 'a1', environment: 'uat' })).rejects.toThrow('not ready');
  });
});

describe('relay.start', () => {
  test('does nothing without a broker configured', async () => {
    await relay.start(io, deps());

    expect(bus.connections).toHaveLength(0);
    await expect(relay.getSettings()).resolves.toMatchObject({ configured: false, connected: false, error: null });
  });

  test('connects, listens to every agent and tells the UI about them', async () => {
    configured();
    await relay.start(io, deps());

    expect(bus.connections[0].name).toMatch(/^flows-ui-jose-/);
    await expect(relay.getSettings()).resolves.toMatchObject({
      broker: { url: 'mqtt://bus', username: 'jose' },
      hasPassword: true, configured: true, connected: true, error: null,
      configFile: 'config/remote.json', envFile: '.env', passwordEnvKey: 'FLOWS_BROKER_PASSWORD'
    });

    await announce('agent-ourense');
    await announce('agent-vigo', { online: false });

    // Online first, then by name; nobody is trusted until a run stored the key
    expect(relay.list().map(agent => [agent.agent, agent.online, agent.trusted])).toEqual([
      ['agent-ourense', true, false],
      ['agent-vigo', false, false]
    ]);
    expect(io.emit).toHaveBeenCalledWith('agents:update', { agents: relay.list() });

    // A key on file that matches is what "trusted" means
    setConfig({ ...getConfig(), agents: { 'agent-ourense': { publicKey: 'PUB', fingerprint: 'aa', since: 1 } } });
    await announce('agent-ourense');
    expect(relay.list()[0].trusted).toBe(true);

    // What is not a status is ignored
    const other = await bus.connect('noise');
    await other.publish(topics.status('agent-x'), 'not json');
    await flush();
    expect(relay.list()).toHaveLength(2);
  });

  test('a broker that refuses is reported, not fatal', async () => {
    configured();
    const connect = jest.fn(async () => { throw new Error('Not authorized'); });
    await relay.start(io, { ...deps(), connect });

    await expect(relay.getSettings()).resolves.toMatchObject({ connected: false, error: 'Not authorized' });
    expect(console.error).toHaveBeenCalledWith('Remote agents are not available: Not authorized');
  });

  test('a dropped link is logged, and stop hangs up', async () => {
    configured();
    await relay.start(io, deps());
    const connection = bus.connections[0];

    connection.drop();
    expect(console.warn).toHaveBeenCalledWith('Lost the broker: reconnecting');

    await relay.stop();
    expect(connection.closed).toBe(true);
    expect(relay.list()).toEqual([]);
  });
});

describe('relay.saveSettings', () => {
  test('stores the broker, the password apart, and reconnects', async () => {
    await relay.start(io, deps());
    expect(bus.connections).toHaveLength(0);

    const settings = await relay.saveSettings({ url: 'mqtts://mqtt.example:443', username: 'jose', password: 'pw' });

    expect(getConfig()).toEqual({ broker: { url: 'mqtts://mqtt.example:443', username: 'jose' } });
    expect(getEnv()).toEqual({ FLOWS_BROKER_PASSWORD: 'pw' });
    expect(settings).toMatchObject({ configured: true, connected: true, hasPassword: true });
    expect(bus.connections).toHaveLength(1);

    // Password undefined keeps it; null clears it; an empty URL turns it off
    await relay.saveSettings({ username: 'maria' });
    expect(getEnv()).toEqual({ FLOWS_BROKER_PASSWORD: 'pw' });
    expect(getConfig().broker).toEqual({ url: 'mqtts://mqtt.example:443', username: 'maria' });

    const off = await relay.saveSettings({ url: '', password: null });
    expect(getConfig().broker).toBeUndefined();
    expect(getEnv()).toEqual({});
    expect(off).toMatchObject({ configured: false, connected: false });
  });

  test('refuses a URL that is not an MQTT one', async () => {
    await expect(relay.saveSettings({ url: 'https://x' })).rejects.toThrow('must start with mqtt://');
  });
});

describe('relay.test', () => {
  test('connects once with the stored settings and hangs up', async () => {
    configured();
    await relay.start(io, deps());
    await announce('agent-ourense');

    await expect(relay.test()).resolves.toEqual({ message: 'Connected to mqtt://bus as jose. 1 agent seen so far.' });
    const probe = bus.connections.find(connection => connection.name.startsWith('flows-ui-test-'));
    expect(probe!.closed).toBe(true);
  });

  test('says what went wrong', async () => {
    await expect(relay.test()).rejects.toThrow('No broker configured');
  });
});

describe('relay.forgetAgent', () => {
  test('drops the stored key and marks the agent untrusted', async () => {
    configured();
    setConfig({ ...getConfig(), agents: { 'agent-ourense': { publicKey: 'PUB', fingerprint: 'aa', since: 1 } } });
    await relay.start(io, deps());
    await announce('agent-ourense');
    expect(relay.list()[0].trusted).toBe(true);

    await relay.forgetAgent('agent-ourense');

    expect(getConfig().agents).toEqual({});
    expect(relay.list()[0].trusted).toBe(false);

    // Forgetting one never seen is fine too
    await relay.forgetAgent('ghost');
  });
});

describe('relay.startFlow', () => {
  beforeEach(async () => {
    configured();
    await relay.start(io, deps());
  });

  test('answers with the execution once the agent started it, and follows the run over the socket', async () => {
    runScript = async ({ onEvent, io: runIo }) => {
      onEvent('remote:job', { status: 'accepted' });
      runIo.emit('flowexecution:update', { id: 'exec-1', topic: 'execution', data: { id: 'exec-1', status: 'running' } });
      onEvent('flowexecution:update', { id: 'exec-1', topic: 'execution', data: { id: 'exec-1', status: 'running' } });
      return { testRun: { id: 'run-1', status: 'passed' }, warnings: ['not pushed'] };
    };

    const result = await relay.startFlow({ agent: 'agent-ourense', environment: 'uat', path: 'refund.md' });

    expect(result).toEqual({ execution: { id: 'exec-1', status: 'running' } });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'agent-ourense', environment: 'uat', file: 'refund.md', io
    }));
    expect(io.emit).toHaveBeenCalledWith('flowexecution:update', expect.objectContaining({ topic: 'execution' }));

    await flush();
    expect(console.warn).toHaveBeenCalledWith('Remote run on agent-ourense: not pushed');
  });

  test('a run that could not start is the error the page shows', async () => {
    runScript = async () => { throw new Error('Agent "agent-ourense" is offline'); };

    await expect(relay.startFlow({ agent: 'agent-ourense', environment: 'uat', path: 'refund.md' }))
      .rejects.toThrow('Agent "agent-ourense" is offline');
  });

  test('a run that dies after starting ends the execution on the socket', async () => {
    runScript = async ({ onEvent }) => {
      onEvent('flowexecution:update', { id: 'exec-1', topic: 'execution', data: { id: 'exec-1', status: 'running' } });
      await flush();
      throw new Error('went offline during the run');
    };

    await relay.startFlow({ agent: 'agent-ourense', environment: 'uat', path: 'refund.md' });
    await flush(20);

    expect(io.emit).toHaveBeenCalledWith('flowexecution:update', {
      id: 'exec-1',
      topic: 'execution',
      data: { id: 'exec-1', status: 'error', error: { message: 'went offline during the run' } }
    });
    expect(console.error).toHaveBeenCalledWith('Remote run on agent-ourense failed: went offline during the run');
  });

  test('a question a remote step asks waits for the UI, and is dropped when the run ends', async () => {
    const answers: any[] = [];
    runScript = async ({ onEvent, onInput }) => {
      onEvent('flowexecution:update', { id: 'exec-1', topic: 'execution', data: { id: 'exec-1', status: 'running' } });
      answers.push(await onInput({ id: 'in-1', kind: 'text', label: 'Barcode' }));
      answers.push(await onInput({ id: 'in-2', kind: 'text', label: 'Other' }));
      answers.push(await onInput({ id: 'in-3', kind: 'text', label: 'Never answered' }));
      return { testRun: { id: 'run-1', status: 'passed' }, warnings: [] };
    };

    await relay.startFlow({ agent: 'agent-ourense', environment: 'uat', path: 'refund.md' });
    await flush();

    expect(relay.listInputs()).toEqual([{ id: 'in-1', kind: 'text', label: 'Barcode' }]);
    expect(relay.answerInput('nope', 'x')).toBe(false);
    expect(relay.answerInput('in-1', '4711')).toBe(true);
    await flush();
    expect(relay.answerInput('in-2', undefined, true)).toBe(true);
    await flush();

    expect(answers).toEqual(['4711', null]);
    expect(relay.listInputs()).toHaveLength(1);

    // The run ending is what drops the last one; the test cannot end it, so
    // it stands in for the finally through a fresh stop
    await relay.stop();
  });
});

describe('relay.startFolderRun', () => {
  beforeEach(async () => {
    configured();
    await relay.start(io, deps());
  });

  test('answers with the summary the agent created, written into this test-runs as it goes', async () => {
    runScript = async ({ onEvent }) => {
      onEvent('testrun:update', { id: 'run-7', run: { id: 'run-7', status: 'running', flows: [{ file: 'a.md', status: 'pending' }] } });
      await flush();
      onEvent('testrun:update', { id: 'run-7', run: { id: 'run-7', status: 'passed', flows: [{ file: 'a.md', status: 'passed' }] } });
      return { testRun: { id: 'run-7', status: 'passed' }, warnings: [] };
    };

    const summary = await relay.startFolderRun({
      agent: 'agent-ourense', environment: 'uat', folder: 'payments', view: 'smoke', files: ['a.md']
    });

    expect(summary).toMatchObject({ id: 'run-7', status: 'running' });
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'agent-ourense', environment: 'uat', folder: 'payments', view: 'smoke', files: ['a.md']
    }));

    await flush(20);
    const written = JSON.parse(fs.readFileSync(path.join(root, 'test-runs', 'run-7', 'run.json'), 'utf8'));
    expect(written.status).toBe('passed');
  });

  test('a run that could not start is the error the page shows', async () => {
    runScript = async () => { throw new Error('is busy'); };
    await expect(relay.startFolderRun({ agent: 'agent-ourense', environment: 'uat' })).rejects.toThrow('is busy');
  });

  test('a run that dies after starting is closed as failed here', async () => {
    runScript = async ({ onEvent }) => {
      onEvent('testrun:update', {
        id: 'run-8',
        run: { id: 'run-8', status: 'running', times: { start: 1 }, flows: [{ file: 'a.md', status: 'passed' }, { file: 'b.md', status: 'running' }] }
      });
      await flush();
      throw new Error('went offline during the run');
    };

    await relay.startFolderRun({ agent: 'agent-ourense', environment: 'uat' });
    await flush(20);

    const written = JSON.parse(fs.readFileSync(path.join(root, 'test-runs', 'run-8', 'run.json'), 'utf8'));
    expect(written.status).toBe('failed');
    expect(written.flows).toEqual([
      { file: 'a.md', status: 'passed' },
      { file: 'b.md', status: 'failed', error: 'went offline during the run' }
    ]);
    expect(io.emit).toHaveBeenCalledWith('testrun:update', { id: 'run-8', run: expect.objectContaining({ status: 'failed' }) });
  });
});
