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
    read: jest.fn(async (key) => stored[key]),
    write: jest.fn(async (key, value) => {
      if (value) { stored[key] = String(value); }
      else { delete stored[key]; }
    }),
    __set: (value) => { stored = value; },
    __get: () => stored
  };
});

import * as configHelper from '../../../src/helpers/config';
import * as env from '../../../src/helpers/env';
import * as crypto from '../../../src/helpers/remote/crypto';
import * as remoteConfig from '../../../src/helpers/remote/config';

const setConfig = (value) => (configHelper as any).__set(value);
const getConfig = () => (configHelper as any).__get();
const setEnv = (value) => (env as any).__set(value);
const getEnv = () => (env as any).__get();

beforeEach(() => {
  setConfig({});
  setEnv({});
  delete process.env.FLOWS_BROKER_URL;
  delete process.env.FLOWS_BROKER_USERNAME;
  delete process.env.FLOWS_BROKER_PASSWORD;
  delete process.env.FLOWS_AGENT_ID;
});

describe('remote/config.brokerSettings', () => {
  test('needs a broker from somewhere', async () => {
    await expect(remoteConfig.brokerSettings()).rejects.toThrow('No broker configured');
  });

  test('flags are stored: the URL and username in config, the password in .env', async () => {
    const settings = await remoteConfig.brokerSettings({ url: 'mqtts://mqtt.example:443', username: 'jose', password: 'pw' });

    expect(settings).toEqual({ url: 'mqtts://mqtt.example:443', username: 'jose', password: 'pw', provider: 'generic' });
    expect(getConfig()).toEqual({ broker: { url: 'mqtts://mqtt.example:443', username: 'jose' } });
    expect(getEnv()).toEqual({ FLOWS_BROKER_PASSWORD: 'pw' });

    // Next time, nothing has to be typed
    await expect(remoteConfig.brokerSettings()).resolves.toEqual(settings);
  });

  test('the environment wins over what is stored, and flags over both', async () => {
    setConfig({ broker: { url: 'mqtts://stored:443', username: 'stored' } });
    process.env.FLOWS_BROKER_URL = 'wss://env.example/mqtt';
    process.env.FLOWS_BROKER_PASSWORD = 'env-pw';

    await expect(remoteConfig.brokerSettings()).resolves.toEqual({
      url: 'wss://env.example/mqtt', username: 'stored', password: 'env-pw', provider: 'generic'
    });

    await expect(remoteConfig.brokerSettings({ url: 'mqtt://flag:1883' })).resolves.toMatchObject({ url: 'mqtt://flag:1883' });
    expect(getConfig().broker.url).toBe('mqtt://flag:1883');
  });

  test('refuses a URL that is not an MQTT one', async () => {
    await expect(remoteConfig.brokerSettings({ url: 'https://mqtt.example' })).rejects.toThrow('must start with mqtt://');
  });
});

describe('remote/config.agentIdentity', () => {
  test('needs a name the first time', async () => {
    await expect(remoteConfig.agentIdentity()).rejects.toThrow('No agent name');
    await expect(remoteConfig.agentIdentity('bad name')).rejects.toThrow('not usable');
  });

  test('creates a key pair once and keeps it', async () => {
    const first = await remoteConfig.agentIdentity('agent-ourense');

    expect(first.id).toBe('agent-ourense');
    expect(first.fingerprint).toBe(crypto.fingerprint(first.publicKey));
    expect(getEnv().FLOWS_AGENT_PRIVATE_KEY).toBe(first.privateKey);
    expect(getConfig()).toEqual({ agentId: 'agent-ourense', publicKey: first.publicKey });

    const second = await remoteConfig.agentIdentity();
    expect(second).toEqual(first);

    // The name can change; the key does not
    const renamed = await remoteConfig.agentIdentity('agent-vigo');
    expect(renamed.id).toBe('agent-vigo');
    expect(renamed.publicKey).toBe(first.publicKey);
    expect(getConfig().agentId).toBe('agent-vigo');
  });

  test('the name can come from the environment', async () => {
    process.env.FLOWS_AGENT_ID = 'from-env';
    await expect(remoteConfig.agentIdentity()).resolves.toMatchObject({ id: 'from-env' });
  });
});

describe('remote/config.trustAgent', () => {
  test('stores a key the first time and accepts the same one after', async () => {
    const pair = crypto.generateKeyPair();

    const first = await remoteConfig.trustAgent('agent-ourense', pair.publicKey);
    expect(first).toMatchObject({ publicKey: pair.publicKey, fingerprint: crypto.fingerprint(pair.publicKey) });
    expect(getConfig().agents['agent-ourense']).toEqual(first);

    await expect(remoteConfig.trustAgent('agent-ourense', pair.publicKey)).resolves.toEqual(first);
  });

  test('refuses a key that changed', async () => {
    const pair = crypto.generateKeyPair();
    await remoteConfig.trustAgent('agent-ourense', pair.publicKey);

    await expect(remoteConfig.trustAgent('agent-ourense', crypto.generateKeyPair().publicKey))
      .rejects.toThrow('The key of agent "agent-ourense" has changed');
  });

  test('refuses an agent that announced no key', async () => {
    await expect(remoteConfig.trustAgent('agent-ourense', '')).rejects.toThrow('announced no public key');
  });
});
