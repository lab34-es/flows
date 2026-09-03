// A fake broker: connect() hands back a client whose publish/end are spies, so
// the helper can be driven without a network.
const clients: any[] = [];

const makeClient = (opts: any) => {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  const client: any = {
    opts,
    on: jest.fn((event, fn) => { (handlers[event] ||= []).push(fn); return client; }),
    emit: (event: string, ...args: any[]) => (handlers[event] || []).forEach(fn => fn(...args)),
    publish: jest.fn((_topic, _payload, _options, cb) => cb(null)),
    end: jest.fn()
  };
  clients.push(client);
  // Settle on the next tick so the caller can attach its handlers first.
  setImmediate(() => client.emit(client.failWith ? 'error' : 'connect', client.failWith));
  return client;
};

jest.mock('mqtt', () => ({ connect: jest.fn((opts) => makeClient(opts)) }));

import fs from 'fs';
import mqtt from 'mqtt';
import * as mqttClient from '../../src/helpers/mqttClient';

const lastClient = () => clients[clients.length - 1];
const connectOptions = () => (mqtt.connect as jest.Mock).mock.calls[0][0];

beforeEach(() => {
  jest.clearAllMocks();
  clients.length = 0;
});

describe('mqttClient.publish - the connection', () => {
  test('connects to the host of the environment, as a generated client', async () => {
    await mqttClient.publish({ env: { MQTT_HOST: 'broker' } }, 'a/b', { hello: 1 });

    expect(connectOptions()).toEqual(expect.objectContaining({ host: 'broker', protocol: 'mqtt' }));
    expect(connectOptions().clientId).toMatch(/^lab34-flows-/);
  });

  test('an application with no broker configured says so', async () => {
    await expect(mqttClient.publish({ env: {} }, 'a/b', {}))
      .rejects.toThrow('MQTT_HOST is not set');
  });

  test('a configured certificate makes the connection mqtts by default', async () => {
    const read = jest.spyOn(fs, 'readFileSync').mockReturnValue('PEM' as any);

    await mqttClient.publish({
      env: { MQTT_HOST: 'b', MQTT_KEY: '/k.pem', MQTT_CERT: '/c.pem', MQTT_CA: '/ca.pem' }
    }, 'a/b', {});

    expect(connectOptions()).toEqual(expect.objectContaining({
      protocol: 'mqtts', key: 'PEM', cert: 'PEM', ca: 'PEM'
    }));
    expect(read).toHaveBeenCalledTimes(3);
    read.mockRestore();
  });

  test('port, credentials, client id and certificate checking are taken as configured', async () => {
    await mqttClient.publish({
      env: {
        MQTT_HOST: 'b',
        MQTT_PORT: '8883',
        MQTT_PROTOCOL: 'wss',
        MQTT_CLIENT_ID: 'device-1',
        MQTT_USERNAME: 'u',
        MQTT_PASSWORD: 'p',
        MQTT_REJECT_UNAUTHORIZED: 'false'
      }
    }, 'a/b', {});

    expect(connectOptions()).toEqual(expect.objectContaining({
      port: 8883, protocol: 'wss', clientId: 'device-1',
      username: 'u', password: 'p', rejectUnauthorized: false
    }));
  });
});

describe('mqttClient.publish - the message', () => {
  test('answers with what was published, and closes the connection', async () => {
    const message = { hdf: { cat: 'barcode' } };
    const result = await mqttClient.publish({ env: { MQTT_HOST: 'b' } }, 'msg/device/1/request', message);

    expect(result).toEqual([null, null, { topic: 'msg/device/1/request', qos: 1, message }]);
    expect(lastClient().publish).toHaveBeenCalledWith(
      'msg/device/1/request',
      JSON.stringify(message),
      { qos: 1, retain: false },
      expect.any(Function)
    );
    expect(lastClient().end).toHaveBeenCalled();
  });

  test('the quality of service comes from the environment, and the call wins over it', async () => {
    await mqttClient.publish({ env: { MQTT_HOST: 'b', MQTT_QOS: '0' } }, 't', {});
    expect(lastClient().publish.mock.calls[0][2]).toEqual({ qos: 0, retain: false });

    await mqttClient.publish({ env: { MQTT_HOST: 'b', MQTT_QOS: '0' } }, 't', {}, { qos: 2, retain: true });
    expect(lastClient().publish.mock.calls[0][2]).toEqual({ qos: 2, retain: true });
  });

  test('an encoder replaces JSON, so a binary dialect needs no change here', async () => {
    await mqttClient.publish({ env: { MQTT_HOST: 'b' } }, 't', { a: 1 }, {
      encode: () => Buffer.from([0x81])
    });

    expect(lastClient().publish.mock.calls[0][1]).toEqual(Buffer.from([0x81]));
  });

  test('a broker that refuses the publish fails the step, naming the topic', async () => {
    (mqtt.connect as jest.Mock).mockImplementationOnce((opts) => {
      const client = makeClient(opts);
      client.publish = jest.fn((_t, _p, _o, cb) => cb(new Error('not authorised')));
      return client;
    });

    await expect(mqttClient.publish({ env: { MQTT_HOST: 'b' } }, 'a/b', {}))
      .rejects.toThrow('Could not publish to a/b: not authorised');
  });

  test('a broker that cannot be reached fails the step too, only once', async () => {
    (mqtt.connect as jest.Mock).mockImplementationOnce((opts) => {
      const client = makeClient(opts);
      client.failWith = new Error('ECONNREFUSED');
      return client;
    });

    await expect(mqttClient.publish({ env: { MQTT_HOST: 'b' } }, 'a/b', {}))
      .rejects.toThrow('Could not publish to a/b: ECONNREFUSED');

    lastClient().emit('error', new Error('again'));
    expect(lastClient().end).toHaveBeenCalledTimes(1);
  });
});
