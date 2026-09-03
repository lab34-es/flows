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
    __set: (value) => { stored = value; }
  };
});

import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

import * as configHelper from '../../../src/helpers/config';
import * as env from '../../../src/helpers/env';
import * as broker from '../../../src/helpers/remote/broker';
import * as remoteConfig from '../../../src/helpers/remote/config';
import * as relay from '../../../src/helpers/remote/relay';

/**
 * What AWS IoT Core asks of the transport: a certificate instead of a
 * password, ALPN on 443, and messages that fit in 128 KB.
 */

const setConfig = (value) => (configHelper as any).__set(value);
const getConfig = () => (configHelper as any).__get();
const setEnv = (value) => (env as any).__set(value);

let dir: string;
let certFile: string;
let keyFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flows-aws-'));
  certFile = path.join(dir, 'agent.pem.crt');
  keyFile = path.join(dir, 'agent.pem.key');
  fs.writeFileSync(certFile, 'CERT');
  fs.writeFileSync(keyFile, 'KEY');
  setConfig({});
  setEnv({});
  delete process.env.FLOWS_BROKER_PROVIDER;
  delete process.env.FLOWS_BROKER_CERT;
  delete process.env.FLOWS_BROKER_KEY;
  delete process.env.FLOWS_BROKER_CA;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('config for AWS IoT Core', () => {
  test('a certificate and key are stored with the broker, and the packet limit follows', async () => {
    const settings = await remoteConfig.brokerSettings({
      url: 'mqtts://abc-ats.iot.eu-west-1.amazonaws.com:443', provider: 'aws-iot', cert: certFile, key: keyFile
    });

    expect(settings).toEqual({
      url: 'mqtts://abc-ats.iot.eu-west-1.amazonaws.com:443',
      provider: 'aws-iot',
      tls: { cert: certFile, key: keyFile },
      maxPacketSize: remoteConfig.AWS_IOT_MAX_PACKET
    });
    expect(getConfig().broker).toEqual({
      url: 'mqtts://abc-ats.iot.eu-west-1.amazonaws.com:443',
      provider: 'aws-iot',
      tls: { cert: certFile, key: keyFile }
    });

    // Next time, nothing has to be typed; a CA can be added later
    await expect(remoteConfig.brokerSettings()).resolves.toEqual(settings);
    const withCa = await remoteConfig.brokerSettings({ ca: '/etc/ssl/AmazonRootCA1.pem' });
    expect(withCa.tls).toEqual({ cert: certFile, key: keyFile, ca: '/etc/ssl/AmazonRootCA1.pem' });
  });

  test('AWS without a certificate is refused, unless a custom authorizer password is there', async () => {
    await expect(remoteConfig.brokerSettings({ url: 'mqtts://x:443', provider: 'aws-iot' }))
      .rejects.toThrow('AWS IoT Core needs a client certificate');

    setConfig({});
    await expect(remoteConfig.brokerSettings({ url: 'wss://x/mqtt', provider: 'aws-iot', username: 'u', password: 'p' }))
      .resolves.toMatchObject({ provider: 'aws-iot', password: 'p' });
  });

  test('an unknown provider is refused; the environment can name one', async () => {
    await expect(remoteConfig.brokerSettings({ url: 'mqtts://x:443', provider: 'azure' }))
      .rejects.toThrow('Unknown broker type "azure"');

    process.env.FLOWS_BROKER_PROVIDER = 'aws-iot';
    process.env.FLOWS_BROKER_CERT = certFile;
    process.env.FLOWS_BROKER_KEY = keyFile;
    await expect(remoteConfig.brokerSettings({ url: 'mqtts://x:8883' }))
      .resolves.toMatchObject({ provider: 'aws-iot', tls: { cert: certFile, key: keyFile } });
  });

  test('a generic broker stays as it was', async () => {
    const settings = await remoteConfig.brokerSettings({ url: 'mqtts://mqtt.example:443', username: 'jose' });
    expect(settings).toEqual({ url: 'mqtts://mqtt.example:443', username: 'jose', provider: 'generic' });
    expect(getConfig().broker).toEqual({ url: 'mqtts://mqtt.example:443', username: 'jose' });
  });

  test('connectOptions offers ALPN only for AWS on 443 with a certificate', () => {
    const aws = { url: 'mqtts://x:443', provider: 'aws-iot' as const, tls: { cert: 'c', key: 'k' }, maxPacketSize: 1000 };
    expect(remoteConfig.connectOptions(aws, { clientId: 'id' })).toEqual({
      url: 'mqtts://x:443', username: undefined, password: undefined,
      tls: { cert: 'c', key: 'k' }, alpn: ['x-amzn-mqtt-ca'], maxPacketSize: 1000, clientId: 'id'
    });

    expect(remoteConfig.connectOptions({ ...aws, url: 'mqtts://x:8883' }, { clientId: 'id' }).alpn).toBeUndefined();
    expect(remoteConfig.connectOptions({ ...aws, tls: undefined }, { clientId: 'id' }).alpn).toBeUndefined();
    expect(remoteConfig.connectOptions({ ...aws, url: 'not a url' }, { clientId: 'id' }).alpn).toBeUndefined();
    expect(remoteConfig.connectOptions({ url: 'mqtts://x:443', provider: 'generic' }, { clientId: 'id' }).alpn)
      .toBeUndefined();
  });

  test('cleanTls keeps what is not mentioned and drops what is emptied', () => {
    expect(remoteConfig.cleanTls({ cert: '' }, { cert: 'c', key: 'k' })).toEqual({ key: 'k' });
    expect(remoteConfig.cleanTls({}, {})).toBeUndefined();
    expect(remoteConfig.cleanProvider(undefined)).toBeUndefined();
    expect(remoteConfig.cleanProvider('')).toBeUndefined();
  });
});

/** What mqtt.connect would return, driven by the test. */
const fakeClient = () => {
  const client: any = new EventEmitter();
  client.publish = jest.fn((topic, payload, options, callback) => callback(null));
  client.subscribe = jest.fn((filter, options, callback) => callback(null, [{ topic: filter, qos: 1 }]));
  client.unsubscribe = jest.fn((filter, callback) => callback());
  client.end = jest.fn((force, options, callback) => { if (callback) { callback(); } });
  return client;
};

describe('broker with a certificate', () => {
  test('reads the PEM files and offers ALPN', async () => {
    const client = fakeClient();
    const factory = jest.fn(() => client);
    const pending = broker.connect({
      url: 'mqtts://x:443', tls: { cert: certFile, key: keyFile }, alpn: ['x-amzn-mqtt-ca']
    }, factory as any);
    client.emit('connect');
    await pending;

    const options = (factory.mock.calls[0] as any)[1];
    expect(options.cert.toString()).toBe('CERT');
    expect(options.key.toString()).toBe('KEY');
    expect(options.ca).toBeUndefined();
    expect(options.ALPNProtocols).toEqual(['x-amzn-mqtt-ca']);
  });

  test('a file that cannot be read is the error, before anything connects', async () => {
    const factory = jest.fn();
    await expect(broker.connect({ url: 'mqtts://x:443', tls: { cert: '/nope/agent.crt' } }, factory as any))
      .rejects.toThrow('Could not read the cert file /nope/agent.crt');
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('broker with a packet limit', () => {
  let client;
  let connection: broker.Connection;

  beforeEach(async () => {
    client = fakeClient();
    const pending = broker.connect({ url: 'mqtt://x', maxPacketSize: 1024 }, (() => client) as any);
    client.emit('connect');
    connection = await pending;
  });

  test('a small message goes as it is', async () => {
    await connection.publish('t', { a: 1 });
    expect(client.publish).toHaveBeenCalledTimes(1);
    expect(client.publish.mock.calls[0][1]).toBe('{"a":1}');
  });

  test('a large message goes in chunks that the other side puts back together', async () => {
    const big = { bundle: 'x'.repeat(5000) };
    await connection.publish('flows/agents/a1/jobs/j1/result', big);

    const sent = client.publish.mock.calls.map(call => JSON.parse(call[1]));
    expect(sent.length).toBeGreaterThan(1);
    sent.forEach((chunk, index) => {
      expect(chunk).toMatchObject({ __chunk: 1, index, total: sent.length, id: sent[0].id });
      expect(client.publish.mock.calls[index][1].length).toBeLessThanOrEqual(1024);
    });

    // Received on another connection, out of order and with a duplicate
    const other = fakeClient();
    const pending = broker.connect({ url: 'mqtt://x', maxPacketSize: 1024 }, (() => other) as any);
    other.emit('connect');
    const receiver = await pending;
    const handler = jest.fn();
    await receiver.subscribe('flows/agents/+/jobs/+/result', handler);

    const shuffled = [...sent].reverse();
    shuffled.push(sent[0]);
    shuffled.forEach(chunk => {
      other.emit('message', 'flows/agents/a1/jobs/j1/result', Buffer.from(JSON.stringify(chunk)), {});
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(handler.mock.calls[0][0].payload.toString())).toEqual(big);
  });

  test('a retained message cannot be chunked', async () => {
    await expect(connection.publish('t', { big: 'x'.repeat(5000) }, { retain: true }))
      .rejects.toThrow('A retained message cannot exceed 1024 bytes');
  });

  test('a chunk that makes no sense is dropped, and ordinary JSON is left alone', async () => {
    const handler = jest.fn();
    await connection.subscribe('t', handler);

    client.emit('message', 't', Buffer.from(JSON.stringify({ __chunk: 1, id: 'a', index: 5, total: 2, data: '' })), {});
    client.emit('message', 't', Buffer.from(JSON.stringify({ __chunk: 1, id: 'b', index: 0, total: 2, data: 'eA==' })), {});
    client.emit('message', 't', Buffer.from(JSON.stringify({ __chunk: 1, id: 'b', index: 0, total: 3, data: 'eA==' })), {});
    expect(handler).not.toHaveBeenCalled();

    client.emit('message', 't', Buffer.from('{"__chunk":"no","plain":true}'), {});
    client.emit('message', 't', Buffer.from('not json at all'), {});
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('split and reassemble round-trip any bytes', () => {
    const bytes = Buffer.from(Array.from({ length: 3000 }, (_, index) => index % 256));
    const chunks = broker.split(bytes, 1024);
    const put = broker.reassembler();

    let whole: Buffer | null = null;
    chunks.forEach(chunk => { whole = put('t', chunk) || whole; });

    expect(whole).not.toBeNull();
    expect(Buffer.compare(whole!, bytes)).toBe(0);
    expect(broker.isChunk({ __chunk: 1, id: 'x', index: 0, total: 1, data: '' })).toBe(true);
    expect(broker.isChunk({ __chunk: 2 })).toBe(false);
  });
});

describe('relay settings for AWS IoT Core', () => {
  const connect = jest.fn(async () => ({
    publish: jest.fn(), subscribe: jest.fn(async () => async () => {}),
    onClose: jest.fn(), onReconnect: jest.fn(), end: jest.fn()
  }));

  afterEach(async () => { await relay.stop(); });

  test('stores the provider, the files and a packet limit, and connects with them', async () => {
    await relay.start({ emit: jest.fn() }, { connect: connect as any });

    const settings = await relay.saveSettings({
      url: 'mqtts://abc-ats.iot.eu-west-1.amazonaws.com:443', provider: 'aws-iot', cert: certFile, key: keyFile
    });

    expect(settings.broker).toEqual({
      url: 'mqtts://abc-ats.iot.eu-west-1.amazonaws.com:443',
      username: '',
      provider: 'aws-iot',
      tls: { cert: certFile, key: keyFile, ca: '' },
      maxPacketSize: null
    });
    expect(settings.providers).toEqual(['generic', 'aws-iot']);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({
      tls: { cert: certFile, key: keyFile }, alpn: ['x-amzn-mqtt-ca'], maxPacketSize: remoteConfig.AWS_IOT_MAX_PACKET
    }));

    const limited = await relay.saveSettings({ maxPacketSize: 65536, ca: '/etc/ssl/ca.pem' });
    expect(limited.broker.maxPacketSize).toBe(65536);
    expect(limited.broker.tls.ca).toBe('/etc/ssl/ca.pem');
    expect(getConfig().broker.maxPacketSize).toBe(65536);

    const cleared = await relay.saveSettings({ maxPacketSize: null, cert: '', key: '', ca: '', provider: 'generic' });
    expect(cleared.broker).toMatchObject({ provider: 'generic', tls: { cert: '', key: '', ca: '' }, maxPacketSize: null });
    expect(getConfig().broker).toEqual({ url: 'mqtts://abc-ats.iot.eu-west-1.amazonaws.com:443' });
  });

  test('refuses what makes no sense', async () => {
    await expect(relay.saveSettings({ url: 'mqtts://x:443', provider: 'azure' })).rejects.toThrow('Unknown broker type');
    await expect(relay.saveSettings({ url: 'mqtts://x:443', maxPacketSize: 12 })).rejects.toThrow('at least 1024');
    await expect(relay.saveSettings({ url: 'mqtts://x:443', maxPacketSize: 'many' })).rejects.toThrow('whole number');
  });
});
