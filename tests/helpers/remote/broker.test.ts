import { EventEmitter } from 'events';

import * as broker from '../../../src/helpers/remote/broker';

/** What mqtt.connect would return, driven by the test. */
const fakeClient = () => {
  const client: any = new EventEmitter();
  client.publish = jest.fn((topic, payload, options, callback) => callback(null));
  client.subscribe = jest.fn((filter, options, callback) => callback(null, [{ topic: filter, qos: 1 }]));
  client.unsubscribe = jest.fn((filter, callback) => callback());
  client.end = jest.fn((force, options, callback) => { if (callback) { callback(); } });
  return client;
};

const connectWith = (client) => {
  const factory = jest.fn(() => client);
  const pending = broker.connect({ url: 'mqtts://mqtt.example:443', username: 'jose', password: 'pw' }, factory as any);
  return { factory, pending };
};

describe('remote/broker.connect', () => {
  test('resolves once the broker accepts, with the options mqtt.js needs', async () => {
    const client = fakeClient();
    const { factory, pending } = connectWith(client);

    client.emit('connect');
    await pending;

    expect(factory).toHaveBeenCalledWith('mqtts://mqtt.example:443', expect.objectContaining({
      username: 'jose', password: 'pw', protocolVersion: 5, keepalive: 30
    }));
  });

  test('rejects on an error before the connection is up, and ends the client', async () => {
    const client = fakeClient();
    const { pending } = connectWith(client);

    client.emit('error', new Error('Not authorized'));

    await expect(pending).rejects.toThrow('Could not connect to mqtts://mqtt.example:443: Not authorized');
    expect(client.end).toHaveBeenCalledWith(true);
  });

  test('an error after the connection is up is only logged', async () => {
    const client = fakeClient();
    const { pending } = connectWith(client);
    client.emit('connect');
    await pending;

    client.emit('error', new Error('later'));
    expect(console.error).toHaveBeenCalledWith('Broker error: later');
  });

  test('carries the last will as bytes', async () => {
    const client = fakeClient();
    const factory = jest.fn(() => client);
    const pending = broker.connect({
      url: 'mqtt://x', will: { topic: 'flows/agents/a1/status', payload: { online: false }, retain: true }
    }, factory as any);
    client.emit('connect');
    await pending;

    const options = (factory.mock.calls[0] as any)[1];
    expect(options.will.topic).toBe('flows/agents/a1/status');
    expect(options.will.retain).toBe(true);
    expect(JSON.parse(options.will.payload.toString())).toEqual({ online: false });
  });
});

describe('remote/broker connection', () => {
  let client;
  let connection: broker.Connection;

  beforeEach(async () => {
    client = fakeClient();
    const { pending } = connectWith(client);
    client.emit('connect');
    connection = await pending;
  });

  test('publishes objects as JSON at QoS 1, strings and buffers as they are', async () => {
    await connection.publish('t', { a: 1 }, { retain: true });
    await connection.publish('t', 'plain');
    await connection.publish('t', Buffer.from('raw'));

    expect(client.publish).toHaveBeenNthCalledWith(1, 't', '{"a":1}', { qos: 1, retain: true }, expect.any(Function));
    expect(client.publish).toHaveBeenNthCalledWith(2, 't', 'plain', { qos: 1, retain: false }, expect.any(Function));
    expect(Buffer.isBuffer(client.publish.mock.calls[2][1])).toBe(true);
  });

  test('a publish the broker refuses rejects', async () => {
    client.publish.mockImplementationOnce((topic, payload, options, callback) => callback(new Error('nope')));
    await expect(connection.publish('t', {})).rejects.toThrow('nope');
  });

  test('delivers messages to the handlers whose filter matches', async () => {
    const status = jest.fn();
    const events = jest.fn();
    await connection.subscribe('flows/agents/+/status', status);
    await connection.subscribe('flows/agents/a1/jobs/+/events', events);

    client.emit('message', 'flows/agents/a1/status', Buffer.from('{"online":true}'), { retain: true });
    client.emit('message', 'flows/agents/a1/jobs/j1/events', Buffer.from('{}'), { retain: false });

    expect(status).toHaveBeenCalledTimes(1);
    expect(status.mock.calls[0][0]).toMatchObject({ topic: 'flows/agents/a1/status', retain: true });
    expect(events).toHaveBeenCalledTimes(1);
    expect(events.mock.calls[0][0].retain).toBe(false);
  });

  test('a handler that throws does not stop the others', async () => {
    const bad = jest.fn(() => { throw new Error('boom'); });
    const good = jest.fn();
    await connection.subscribe('t', bad);
    await connection.subscribe('t', good);

    client.emit('message', 't', Buffer.from('x'), {});

    expect(good).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('Error handling t:', expect.any(Error));
  });

  test('unsubscribing the last handler of a filter unsubscribes from the broker', async () => {
    const first = await connection.subscribe('t', jest.fn());
    const second = await connection.subscribe('t', jest.fn());

    await first();
    expect(client.unsubscribe).not.toHaveBeenCalled();

    await second();
    expect(client.unsubscribe).toHaveBeenCalledWith('t', expect.any(Function));
  });

  test('a subscription the ACL refuses is an error, not silence', async () => {
    client.subscribe.mockImplementationOnce((filter, options, callback) =>
      callback(null, [{ topic: filter, qos: 128 }]));
    await expect(connection.subscribe('flows/agents/other/jobs/+/request', jest.fn()))
      .rejects.toThrow('refused the subscription to flows/agents/other/jobs/+/request');

    client.subscribe.mockImplementationOnce((filter, options, callback) => callback(new Error('down')));
    await expect(connection.subscribe('t', jest.fn())).rejects.toThrow('down');
  });

  test('says when the link drops and when it is back', async () => {
    const closed = jest.fn();
    const back = jest.fn();
    connection.onClose(closed);
    connection.onReconnect(back);

    client.emit('close');
    client.emit('connect');

    expect(closed).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  test('ends cleanly', async () => {
    await connection.end();
    expect(client.end).toHaveBeenCalledWith(false, {}, expect.any(Function));
  });
});

describe('remote/broker.decode', () => {
  test('reads JSON and shrugs at anything else', () => {
    expect(broker.decode(Buffer.from('{"a":1}'))).toEqual({ a: 1 });
    expect(broker.decode(Buffer.from('nope'))).toBeNull();
  });
});
