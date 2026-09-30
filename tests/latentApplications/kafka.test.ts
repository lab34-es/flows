// A fake cluster: the library's Consumer is an EventEmitter whose calls are
// spies, and consume() hands back a stream the test pushes messages into, so
// start/test/stop can be driven without a network. `cluster` is how a test
// makes it answer differently.
const consumers: any[] = [];
const cluster: {
  listOffsets?: (consumer: any) => Promise<any>;
  consume?: (consumer: any) => Promise<any>;
} = {};

jest.mock('@platformatic/kafka', () => {
  const { EventEmitter } = require('events');

  class Consumer extends EventEmitter {
    options: any;
    stream: any = null;

    listOffsets = jest.fn(async ({ topics }) => (cluster.listOffsets
      ? cluster.listOffsets(this)
      : new Map(topics.map(topic => [topic, [5n, 7n]]))));

    consume = jest.fn(async () => {
      if (cluster.consume) { return cluster.consume(this); }

      this.stream = Object.assign(new EventEmitter(), { close: jest.fn(async () => undefined) });
      return this.stream;
    });

    close = jest.fn(async () => undefined);

    constructor(options) {
      super();
      this.options = options;
      consumers.push(this);
    }
  }

  return {
    Consumer,
    MessagesStreamModes: { LATEST: 'latest', EARLIEST: 'earliest', COMMITTED: 'committed', MANUAL: 'manual' },
    GroupProtocols: { CLASSIC: 'classic', CONSUMER: 'consumer' }
  };
});

import avsc from 'avsc';

import * as latentKafka from '../../src/latentApplications/kafka';

const connection = { brokers: ['localhost:9092'] };
const lastConsumer = () => consumers[consumers.length - 1];

/** What the wire delivers: bytes, bigints and a Map of headers. */
const wire = (overrides: Record<string, any> = {}) => ({
  topic: 'shop.orders',
  partition: 1,
  offset: 7n,
  key: Buffer.from('order-1'),
  value: Buffer.from(JSON.stringify({ id: 'order-1', status: 'created', lines: [{ sku: 'A', qty: 2 }] })),
  headers: new Map([[Buffer.from('event-type'), Buffer.from('OrderCreated')], [Buffer.from('version'), Buffer.from('2')]]),
  timestamp: 1790000000000n,
  ...overrides
});

/** Start a listener on shop.orders and deliver what it is given. */
const listen = async (client: string, ...messages: Record<string, any>[]) => {
  await latentKafka.start({}, { client, connection, subscribe: [{ topic: 'shop.orders' }] });
  messages.forEach(message => lastConsumer().stream.emit('data', wire(message)));
};

beforeEach(() => {
  consumers.length = 0;
  delete cluster.listOffsets;
  delete cluster.consume;
});

describe('kafka.start', () => {
  afterEach(() => latentKafka.stop('orders'));

  test('pins the end of every partition, and reads from exactly there', async () => {
    await latentKafka.start({}, { client: 'orders', connection, subscribe: [{ topic: 'shop.orders' }] });

    expect(lastConsumer().consume).toHaveBeenCalledWith({
      topics: ['shop.orders'],
      mode: 'manual',
      offsets: [
        { topic: 'shop.orders', partition: 0, offset: 5n },
        { topic: 'shop.orders', partition: 1, offset: 7n }
      ],
      autocommit: false
    });
  });

  test('joins a group of its own with the consumer protocol, committing nothing', async () => {
    await latentKafka.start({}, { client: 'orders', connection, subscribe: [{ topic: 'shop.orders' }] });

    expect(lastConsumer().options).toEqual(expect.objectContaining({
      clientId: 'ronsel',
      bootstrapBrokers: ['localhost:9092'],
      groupId: expect.stringMatching(/^ronsel-orders-[0-9a-f-]{36}$/),
      groupProtocol: 'consumer',
      autocommit: false,
      autocreateTopics: true
    }));
  });

  test('a group the cluster ACLs name, and credentials, are taken as written', async () => {
    await latentKafka.start({}, {
      client: 'orders',
      groupId: 'qa-ronsel',
      connection: { brokers: 'b1:9093,b2:9093', ssl: true, sasl: { mechanism: 'scram-sha-256', username: 'u', password: 'p' } },
      subscribe: { topic: 'shop.orders' }
    });

    expect(lastConsumer().options).toEqual(expect.objectContaining({
      bootstrapBrokers: ['b1:9093', 'b2:9093'],
      groupId: 'qa-ronsel',
      tls: {},
      sasl: { mechanism: 'SCRAM-SHA-256', username: 'u', password: 'p' }
    }));
  });

  test('topics can be written bare, and one named twice is subscribed to once', async () => {
    await latentKafka.start({}, { client: 'orders', connection, subscribe: ['shop.orders', { topic: 'shop.payments' }, 'shop.orders'] });

    expect(lastConsumer().listOffsets).toHaveBeenCalledWith({ topics: ['shop.orders', 'shop.payments'] });
  });

  test('a listener with nothing to listen to says so, and connects to nothing', async () => {
    await expect(latentKafka.start({}, { client: 'orders', connection }))
      .rejects.toThrow("Kafka client 'orders' has nothing to listen to");
    await expect(latentKafka.start({}, { client: 'orders', connection, subscribe: [{}] }))
      .rejects.toThrow('has nothing to listen to');
    expect(consumers).toHaveLength(0);
  });

  test('a cluster before Kafka 4 is joined the classic way', async () => {
    cluster.consume = async (consumer) => {
      if (consumer.options.groupProtocol === 'consumer') { throw new Error('The version of API is not supported.'); }
      consumer.stream = Object.assign(new (require('events').EventEmitter)(), { close: jest.fn() });
      return consumer.stream;
    };

    await latentKafka.start({}, { client: 'orders', connection, subscribe: ['shop.orders'] });

    expect(consumers).toHaveLength(2);
    expect(consumers[0].close).toHaveBeenCalledWith(true);
    expect(consumers[1].options.groupProtocol).toBe('classic');
    // Both read from the offsets pinned before either tried to join
    expect(consumers[0].listOffsets).toHaveBeenCalledTimes(1);
    expect(consumers[1].listOffsets).not.toHaveBeenCalled();
  });

  test('a group that cannot be joined either way fails the flow, saying which listener', async () => {
    cluster.consume = async () => { throw new Error('Group authorization failed.'); };

    await expect(latentKafka.start({}, { client: 'orders', connection, subscribe: ['shop.orders'] }))
      .rejects.toThrow("Kafka client 'orders' could not listen to shop.orders: Group authorization failed.");
    expect(consumers.every(consumer => consumer.close.mock.calls.length > 0)).toBe(true);
  });

  test('a cluster that cannot be reached fails with the reason at the bottom of it', async () => {
    cluster.listOffsets = async () => {
      throw new AggregateError([new AggregateError([new Error('Connection to localhost:9092 failed.')], 'Cannot connect to any broker.')], 'metadata failed 4 times.');
    };

    const error: any = await latentKafka.start({}, { client: 'orders', connection, subscribe: ['shop.orders'] }).catch(e => e);

    expect(error.message).toBe("Kafka client 'orders' could not listen to shop.orders: Connection to localhost:9092 failed.");
    expect(error.cause.message).toBe('metadata failed 4 times.');
    expect(lastConsumer().close).toHaveBeenCalled();
  });

  test('a listener with no broker to talk to says so', async () => {
    await expect(latentKafka.start({}, { client: 'orders', subscribe: ['shop.orders'] }))
      .rejects.toThrow('could not listen to shop.orders: No Kafka brokers configured');
  });

  test('starting the same client again reuses the listener', async () => {
    await latentKafka.start({}, { client: 'orders', connection, subscribe: ['shop.orders'] });
    await latentKafka.start({}, { client: 'orders', connection, subscribe: ['shop.orders'] });

    expect(consumers).toHaveLength(1);
  });
});

describe('kafka.test - what has to match', () => {
  beforeEach(() => listen('orders', {}));
  afterEach(() => latentKafka.stop('orders'));

  const expect_ = (expected: Record<string, any>, flow: any = {}) =>
    latentKafka.test(flow, { client: 'orders', test: [expected] }, {});

  test('the topic, key, headers and message a test names', async () => {
    await expect(expect_({
      topic: 'shop.orders',
      key: 'order-1',
      headers: { 'event-type': 'OrderCreated' },
      message: { status: 'created' }
    })).resolves.toEqual([]);
  });

  test('a message on another topic is not the one', async () => {
    await expect(expect_({ topic: 'shop.payments' })).resolves.toEqual([{ topic: 'shop.payments' }]);
  });

  test('the key is filled in from what the flow remembered, as the topic is', async () => {
    const flow = { memory: { orderId: 'order-1', domain: 'shop' } };

    await expect(expect_({ topic: '{{ memory.domain }}.orders', key: '{{ memory.orderId }}' }, flow)).resolves.toEqual([]);
    await expect(expect_({ topic: 'shop.orders', key: '{{ memory.nobody }}' }, flow))
      .resolves.toEqual([{ topic: 'shop.orders', key: '{{ memory.nobody }}' }]);
  });

  test('a number written in YAML is compared as the text Kafka carries', async () => {
    lastConsumer().stream.emit('data', wire({ key: Buffer.from('42') }));

    await expect(expect_({ topic: 'shop.orders', key: 42, headers: { version: 2 } })).resolves.toEqual([]);
  });

  test('a key can be an expression', async () => {
    await expect(expect_({ topic: 'shop.orders', key: "$expr: value.startsWith('order-')" })).resolves.toEqual([]);
    await expect(expect_({ topic: 'shop.orders', key: "$expr: value.startsWith('refund-')" })).resolves.toHaveLength(1);
  });

  test('headers and message are matched by what they name, at any depth', async () => {
    await expect(expect_({ topic: 'shop.orders', headers: { version: '3' } })).resolves.toHaveLength(1);
    await expect(expect_({ topic: 'shop.orders', message: { lines: [{ sku: 'A' }] } })).resolves.toEqual([]);
    await expect(expect_({ topic: 'shop.orders', message: { lines: [{ sku: 'B' }] } })).resolves.toHaveLength(1);
  });

  test('value is read as the message, which is what Kafka calls it', async () => {
    await expect(expect_({ topic: 'shop.orders', value: { status: 'created' } })).resolves.toEqual([]);
    await expect(expect_({ topic: 'shop.orders', value: { status: 'paid' } }))
      .resolves.toEqual([{ topic: 'shop.orders', message: { status: 'paid' } }]);
  });

  test('without a message, any payload will do -- text, and a tombstone too', async () => {
    lastConsumer().stream.emit('data', wire({ topic: 'shop.audit', key: null, value: Buffer.from('plain text'), headers: undefined }));
    lastConsumer().stream.emit('data', wire({ topic: 'shop.deleted', value: null }));

    await expect(expect_({ topic: 'shop.audit' })).resolves.toEqual([]);
    await expect(expect_({ topic: 'shop.audit', message: '$expr: value === "plain text"' })).resolves.toEqual([]);
    await expect(expect_({ topic: 'shop.deleted', key: 'order-1', message: null })).resolves.toEqual([]);
  });

  test('a message without a topic is refused, rather than reported as never arriving', async () => {
    await expect(expect_({ key: 'order-1' })).rejects.toThrow('was asked for a message without a topic');
  });

  test('what never arrived is reported with only what the test asked', async () => {
    await expect(expect_({ topic: 'shop.orders', key: 'order-9', headers: { 'event-type': 'OrderPaid' }, message: { id: 'order-9' } }))
      .resolves.toEqual([{ topic: 'shop.orders', key: 'order-9', headers: { 'event-type': 'OrderPaid' }, message: { id: 'order-9' } }]);
  });
});

describe('kafka.test - keeping what arrived', () => {
  beforeEach(() => listen('orders', {}));
  afterEach(() => latentKafka.stop('orders'));

  test('the memory mapping reads the message and where it was', async () => {
    const flow: any = { memory: { orderId: 'order-1' } };

    await latentKafka.test(flow, {
      client: 'orders',
      test: [{
        topic: 'shop.orders',
        key: '{{ memory.orderId }}',
        memory: {
          status: '{{ message.status }}',
          sameStatus: '{{ value.status }}',
          firstSku: '{{ message.lines.0.sku }}',
          eventType: '{{ headers.event-type }}',
          partition: '{{ partition }}',
          offset: '{{ offset }}',
          key: '{{ key }}',
          publishedAt: '{{ timestamp }}',
          onTopic: '{{ topic }}'
        }
      }]
    }, {});

    expect(flow.memory).toEqual({
      orderId: 'order-1',
      status: 'created',
      sameStatus: 'created',
      firstSku: 'A',
      eventType: 'OrderCreated',
      partition: 1,
      offset: 7,
      key: 'order-1',
      publishedAt: 1790000000000,
      onTopic: 'shop.orders'
    });
  });

  test('a message that never arrived writes nothing', async () => {
    const flow: any = { memory: {} };

    await latentKafka.test(flow, {
      client: 'orders',
      test: [{ topic: 'shop.orders', key: 'order-9', memory: { status: '{{ message.status }}' } }]
    }, {});

    expect(flow.memory).toEqual({});
  });
});

describe('kafka.test - waiting, and failing', () => {
  afterEach(() => latentKafka.stop('orders'));

  test('looks again, as many times as the retry says, until it arrives', async () => {
    await listen('orders');
    jest.useFakeTimers();

    const pending = latentKafka.test({}, {
      client: 'orders',
      test: [{ topic: 'shop.orders', key: 'order-1' }],
      retry: { attempts: 5, delay: 1 }
    }, {});

    await jest.advanceTimersByTimeAsync(1000);
    lastConsumer().stream.emit('data', wire());
    await jest.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual([]);
    jest.useRealTimers();
  });

  test('an unknown client rejects', async () => {
    await expect(latentKafka.test({}, { client: 'ghost', test: [] }, {}))
      .rejects.toThrow("Kafka client 'ghost' does not exist or is not connected");
  });

  test('an assertion without a test list rejects rather than passing', async () => {
    await listen('orders');

    await expect(latentKafka.test({}, { client: 'orders' }, {}))
      .rejects.toThrow('The kafka assertion lists no messages');
  });

  test('a listener that broke fails what it has not seen, with why', async () => {
    await listen('orders', {});

    lastConsumer().emit('error', new AggregateError([new Error('Coordinator not available.')], 'joinGroup failed 4 times.'));

    expect(console.error).toHaveBeenCalledWith("Kafka client 'orders' stopped listening: Coordinator not available.");

    // What it saw before it broke still counts
    await expect(latentKafka.test({}, { client: 'orders', test: [{ topic: 'shop.orders' }] }, {})).resolves.toEqual([]);
    await expect(latentKafka.test({}, { client: 'orders', test: [{ topic: 'shop.payments' }] }, {}))
      .rejects.toThrow("Kafka client 'orders' stopped listening: Coordinator not available.");
  });

  test('a stream that broke is kept the same way', async () => {
    await listen('orders');

    lastConsumer().stream.emit('error', new Error('Failed to deserialize a message.'));

    await expect(latentKafka.test({}, { client: 'orders', test: [{ topic: 'shop.orders' }] }, {}))
      .rejects.toThrow('stopped listening: Failed to deserialize a message.');
  });

  test('a consumer that had to be replaced cannot fail the listener that replaced it', async () => {
    cluster.consume = async (consumer) => {
      if (consumer.options.groupProtocol === 'consumer') { throw new Error('The version of API is not supported.'); }
      consumer.stream = Object.assign(new (require('events').EventEmitter)(), { close: jest.fn() });
      return consumer.stream;
    };
    await latentKafka.start({}, { client: 'orders', connection, subscribe: ['shop.orders'] });

    consumers[0].emit('error', new Error('late news from the first consumer'));

    await expect(latentKafka.test({}, { client: 'orders', test: [{ topic: 'shop.orders' }] }, {})).resolves.toHaveLength(1);
  });

  test('a busy topic keeps only the latest messages, and says so once', async () => {
    await listen('orders');
    const stream = lastConsumer().stream;

    for (let offset = 0; offset <= 13_000; offset++) {
      stream.emit('data', wire({ offset: BigInt(offset), key: Buffer.from(`order-${offset}`) }));
    }

    expect((console.log as jest.Mock).mock.calls.filter(([line]) => String(line).includes('only the latest 10000 are kept')))
      .toHaveLength(1);
    await expect(latentKafka.test({}, { client: 'orders', test: [{ topic: 'shop.orders', key: 'order-13000' }] }, {})).resolves.toEqual([]);
    await expect(latentKafka.test({}, { client: 'orders', test: [{ topic: 'shop.orders', key: 'order-0' }] }, {})).resolves.toHaveLength(1);
  });
});

describe('kafka.start - a connection taken from an application', () => {
  afterEach(() => latentKafka.stop('shop'));

  test('the cluster and credentials come from its env file', async () => {
    await latentKafka.start({}, {
      client: 'shop',
      connection: 'orders',
      env: { KAFKA_BROKERS: 'kafka.staging:9093', KAFKA_SASL_MECHANISM: 'SCRAM-SHA-512', KAFKA_USERNAME: 'u', KAFKA_PASSWORD: 'p' },
      subscribe: ['shop.orders']
    });

    expect(lastConsumer().options).toEqual(expect.objectContaining({
      bootstrapBrokers: ['kafka.staging:9093'],
      sasl: { mechanism: 'SCRAM-SHA-512', username: 'u', password: 'p' }
    }));
  });

  test('what the flow writes wins over the env file', async () => {
    await latentKafka.start({}, {
      client: 'shop',
      connection: { application: 'orders', brokers: ['localhost:9092'], groupId: 'ignored-here' },
      groupId: 'qa-ronsel',
      env: { KAFKA_BROKERS: 'kafka.staging:9093' },
      subscribe: ['shop.orders']
    });

    expect(lastConsumer().options).toEqual(expect.objectContaining({ bootstrapBrokers: ['localhost:9092'], groupId: 'qa-ronsel' }));
  });

  test('an env file with no brokers says so, naming the listener', async () => {
    await expect(latentKafka.start({}, { client: 'shop', connection: 'orders', env: {}, subscribe: ['shop.orders'] }))
      .rejects.toThrow("Kafka client 'shop' could not listen to shop.orders: No Kafka brokers configured");
  });
});

describe('kafka - Avro', () => {
  const SCHEMA: any = { type: 'record', name: 'OrderPlaced', fields: [{ name: 'orderId', type: 'string' }, { name: 'total', type: 'double' }] };

  /** The Confluent wire format: a zero, the schema id, the Avro bytes. */
  const framed = (id: number, value: any) => {
    const header = Buffer.alloc(5);
    header.writeInt32BE(id, 1);
    return Buffer.concat([header, avsc.Type.forSchema(SCHEMA).toBuffer(value)]);
  };

  let fetch: jest.SpyInstance;

  beforeEach(async () => {
    fetch = jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).endsWith('/schemas/ids/3')) {
        return { ok: true, json: async () => ({ schema: JSON.stringify(SCHEMA) }) } as any;
      }
      return { ok: false, status: 404 } as any;
    });

    await latentKafka.start({}, {
      client: 'shop',
      connection: 'orders',
      env: { KAFKA_BROKERS: 'localhost:9092', KAFKA_SCHEMA_REGISTRY_URL: 'http://registry:8081' },
      subscribe: ['shop.orders']
    });
  });

  afterEach(() => latentKafka.stop('shop'));

  /** Deliver, and wait for what the registry has to say about it. */
  const deliver = async (...messages: Record<string, any>[]) => {
    messages.forEach(message => lastConsumer().stream.emit('data', wire(message)));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setImmediate(resolve));
  };

  test('an Avro message is asserted on and remembered like a JSON one, and a JSON one still is', async () => {
    await deliver(
      { key: Buffer.from('ord-1'), value: framed(3, { orderId: 'ord-1', total: 29 }) },
      { key: Buffer.from('ord-2'), value: Buffer.from(JSON.stringify({ orderId: 'ord-2', total: 12 })) }
    );
    const flow: any = { memory: {} };

    await expect(latentKafka.test(flow, {
      client: 'shop',
      test: [
        { topic: 'shop.orders', key: 'ord-1', message: { total: 29 }, memory: { total: '{{ message.total }}' } },
        { topic: 'shop.orders', key: 'ord-2', message: { total: 12 } }
      ],
      retry: { attempts: 3, delay: 0.01 }
    }, {})).resolves.toEqual([]);

    expect(flow.memory.total).toBe(29);
    expect(fetch).toHaveBeenCalledWith('http://registry:8081/schemas/ids/3', expect.anything());
  });

  test('an Avro key is decoded too', async () => {
    const KEY: any = { type: 'record', name: 'OrderKey', fields: [{ name: 'id', type: 'string' }] };
    fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ schema: JSON.stringify(KEY) }) }) as any);
    const header = Buffer.alloc(5);
    header.writeInt32BE(4, 1);

    await deliver({ key: Buffer.concat([header, avsc.Type.forSchema(KEY).toBuffer({ id: 'ord-9' })]) });

    await expect(latentKafka.test({}, {
      client: 'shop', test: [{ topic: 'shop.orders', key: '$expr: value.id === "ord-9"' }], retry: { attempts: 3, delay: 0.01 }
    }, {})).resolves.toEqual([]);
  });

  test('a schema the registry does not know keeps the message, as text, and says why once', async () => {
    await deliver({ key: Buffer.from('ord-5'), value: framed(5, { orderId: 'ord-5', total: 1 }) }, { key: Buffer.from('ord-6'), value: framed(5, { orderId: 'ord-6', total: 1 }) });

    await expect(latentKafka.test({}, {
      client: 'shop', test: [{ topic: 'shop.orders', key: 'ord-5', message: '$expr: typeof value === "string"' }]
    }, {})).resolves.toEqual([]);

    expect((console.error as jest.Mock).mock.calls.filter(([line]) => String(line).includes('could not decode an Avro message'))).toHaveLength(1);
  });
});

describe('kafka.stop', () => {
  test('closes the stream, leaves the group and forgets the listener', async () => {
    await listen('orders');
    const consumer = lastConsumer();

    await latentKafka.stop('orders');

    expect(consumer.stream.close).toHaveBeenCalled();
    expect(consumer.close).toHaveBeenCalledWith(true);
    await expect(latentKafka.test({}, { client: 'orders', test: [] }, {})).rejects.toThrow('does not exist');
  });

  test('a listener that will not close is logged, and forgotten all the same', async () => {
    await listen('orders');
    const consumer = lastConsumer();
    consumer.stream.close.mockRejectedValue(new Error('stream gone'));
    consumer.close.mockRejectedValue(new Error('coordinator gone'));

    await expect(latentKafka.stop('orders')).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith("Kafka client 'orders' did not close cleanly: stream gone");
    expect(console.error).toHaveBeenCalledWith("Kafka client 'orders' did not leave its group cleanly: coordinator gone");
    await expect(latentKafka.test({}, { client: 'orders', test: [] }, {})).rejects.toThrow('does not exist');
  });

  test('what a listener says while it is being closed is not taken for a failure', async () => {
    await listen('orders');
    const consumer = lastConsumer();

    await latentKafka.stop('orders');
    consumer.emit('error', new Error('left the group'));
    consumer.stream.emit('error', new Error('stream closed'));

    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('stopped listening'));
  });

  test('stopping an unknown client is a no-op', async () => {
    await expect(latentKafka.stop('never-started')).resolves.toBeUndefined();
  });
});
