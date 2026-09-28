// A fake cluster: the library's Producer records what it was built with and
// what it was asked to send, so the helper can be driven without a network.
// `cluster` is how a test makes it answer differently: `publish` sends before
// it ever hands control back, so the producer cannot be reached in time.
const producers: any[] = [];
const cluster: { send?: () => Promise<any>; close?: () => Promise<any> } = {};

jest.mock('@platformatic/kafka', () => {
  class Producer {
    options: any;
    send = jest.fn(async () => (cluster.send ? cluster.send() : { offsets: [{ topic: 'orders', partition: 2, offset: 41n }] }));
    close = jest.fn(async () => (cluster.close ? cluster.close() : undefined));

    constructor(options) {
      this.options = options;
      producers.push(this);
    }
  }

  return {
    Producer,
    ProduceAcks: { ALL: -1, LEADER: 1, NO_RESPONSE: 0 },
    stringSerializer: (value?: string) => (typeof value === 'string' ? Buffer.from(value) : undefined),
    compatibilityPartitioner: function compatibilityPartitioner() { return 0; }
  };
});

import fs from 'fs';
import * as kafkaClient from '../../src/helpers/kafkaClient';

const lastProducer = () => producers[producers.length - 1];
const sent = () => lastProducer().send.mock.calls[0][0];
const env = (extra: Record<string, string> = {}) => ({ env: { KAFKA_BROKERS: 'localhost:9092', ...extra } });

beforeEach(() => {
  producers.length = 0;
  delete cluster.send;
  delete cluster.close;
});

describe('kafkaClient.publish - the connection', () => {
  test('connects to the brokers of the environment, as ronsel', async () => {
    await kafkaClient.publish(env({ KAFKA_BROKERS: 'a:9092, b:9092' }), 'orders', {});

    expect(lastProducer().options).toEqual(expect.objectContaining({
      clientId: 'ronsel',
      bootstrapBrokers: ['a:9092', 'b:9092']
    }));
    expect(lastProducer().options.tls).toBeUndefined();
    expect(lastProducer().options.sasl).toBeUndefined();
  });

  test('keys are hashed to partitions the way the Java client does it', async () => {
    await kafkaClient.publish(env(), 'orders', {}, { key: 'order-1' });

    expect(lastProducer().options.partitioner.name).toBe('compatibilityPartitioner');
  });

  test('an application with no cluster configured says so, and connects to nothing', async () => {
    await expect(kafkaClient.publish({ env: {} }, 'orders', {})).rejects.toThrow('KAFKA_BROKERS is not set');
    await expect(kafkaClient.publish({}, 'orders', {})).rejects.toThrow('KAFKA_BROKERS is not set');
    expect(producers).toHaveLength(0);
  });

  test('a certificate makes the connection TLS, read off disk', async () => {
    const read = jest.spyOn(fs, 'readFileSync').mockReturnValue('PEM' as any);

    await kafkaClient.publish(env({ KAFKA_CA: '/ca.pem', KAFKA_CERT: '/c.pem', KAFKA_KEY: '/k.pem' }), 'orders', {});

    expect(lastProducer().options.tls).toEqual({ ca: 'PEM', cert: 'PEM', key: 'PEM' });
    expect(read).toHaveBeenCalledTimes(3);
  });

  test('KAFKA_SSL asks for TLS on its own, and a self-signed broker can be accepted', async () => {
    await kafkaClient.publish(env({ KAFKA_SSL: 'true' }), 'orders', {});
    expect(lastProducer().options.tls).toEqual({});

    await kafkaClient.publish(env({ KAFKA_REJECT_UNAUTHORIZED: 'false' }), 'orders', {});
    expect(lastProducer().options.tls).toEqual({ rejectUnauthorized: false });
  });

  test('credentials are sent with PLAIN unless the environment names a mechanism', async () => {
    await kafkaClient.publish(env({ KAFKA_USERNAME: 'u', KAFKA_PASSWORD: 'p', KAFKA_CLIENT_ID: 'shop' }), 'orders', {});

    expect(lastProducer().options).toEqual(expect.objectContaining({
      clientId: 'shop',
      sasl: { mechanism: 'PLAIN', username: 'u', password: 'p' }
    }));

    await kafkaClient.publish(env({ KAFKA_USERNAME: 'u', KAFKA_PASSWORD: 'p', KAFKA_SASL_MECHANISM: 'scram-sha-512' }), 'orders', {});
    expect(lastProducer().options.sasl.mechanism).toBe('SCRAM-SHA-512');
  });
});

describe('kafkaClient.publish - the message', () => {
  test('answers with what was published and where it landed, and closes the connection', async () => {
    const message = { id: 'order-1', status: 'created' };
    const result = await kafkaClient.publish(env(), 'orders', message);

    expect(result).toEqual([null, null, {
      topic: 'orders', partition: 2, offset: 41, key: null, headers: {}, message
    }]);
    expect(sent()).toEqual({
      messages: [{ topic: 'orders', key: undefined, value: Buffer.from(JSON.stringify(message)), headers: {}, partition: undefined }],
      acks: -1,
      autocreateTopics: true
    });
    expect(lastProducer().close).toHaveBeenCalledWith(true);
  });

  test('a key, headers and a partition travel with the message, as text', async () => {
    const [, , body] = await kafkaClient.publish(env(), 'orders', {}, {
      key: 'order-1',
      headers: { 'event-type': 'OrderCreated', version: 2 as any },
      partition: 1
    });

    expect(sent().messages[0]).toEqual(expect.objectContaining({
      key: 'order-1',
      headers: { 'event-type': 'OrderCreated', version: '2' },
      partition: 1
    }));
    expect(body).toEqual(expect.objectContaining({ key: 'order-1', headers: { 'event-type': 'OrderCreated', version: '2' } }));
  });

  test('a message that is not there is refused before anything connects', async () => {
    await expect(kafkaClient.publish(env(), 'orders', undefined)).rejects.toThrow('Nothing to publish to orders');
    expect(producers).toHaveLength(0);
  });

  test('an encoder replaces JSON, and bytes are sent as they are', async () => {
    await kafkaClient.publish(env(), 'orders', { a: 1 }, { encode: () => 'a=1' });
    expect(sent().messages[0].value).toEqual(Buffer.from('a=1'));

    await kafkaClient.publish(env(), 'orders', Buffer.from([0x81]));
    expect(sent().messages[0].value).toEqual(Buffer.from([0x81]));
  });

  test('a publish nobody acknowledged has no offset to report', async () => {
    cluster.send = async () => ({});
    await expect(kafkaClient.publish(env(), 'orders', {}, { partition: 3 }))
      .resolves.toEqual([null, null, expect.objectContaining({ partition: 3, offset: null })]);

    cluster.send = async () => ({ offsets: [] });
    await expect(kafkaClient.publish(env(), 'orders', {}))
      .resolves.toEqual([null, null, expect.objectContaining({ partition: null, offset: null })]);
  });

  test('a cluster that refuses fails the step with the reason at the bottom of it, and still closes', async () => {
    const refused = Object.assign(new AggregateError([
      Object.assign(new AggregateError([new Error('Connection to localhost:9092 failed.')], 'Cannot connect to any broker.'))
    ], 'metadata failed 4 times.'));

    cluster.send = async () => { throw refused; };

    const error: any = await kafkaClient.publish(env(), 'orders', {}).catch(e => e);
    expect(error.message).toBe('Could not publish to orders: Connection to localhost:9092 failed.');
    expect(error.cause).toBe(refused);
    expect(lastProducer().close).toHaveBeenCalled();
  });

  test('a producer that will not close does not fail a publish that went through', async () => {
    cluster.close = async () => { throw new Error('already closed'); };

    await expect(kafkaClient.publish(env(), 'orders', {})).resolves.toEqual([null, null, expect.objectContaining({ topic: 'orders' })]);
  });
});
