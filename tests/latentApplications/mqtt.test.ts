jest.mock('yargs-parser', () => () => ({}));

// A fake broker: connect() hands back an EventEmitter-ish client whose
// subscribe/end are spies, so start/stop/test can be driven without a network.
const clients: any[] = [];

const makeClient = (opts: any, subscribeImpl?: any, failWith?: Error) => {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  const client: any = {
    opts,
    on: jest.fn((event, fn) => { (handlers[event] ||= []).push(fn); return client; }),
    emit: (event: string, ...args: any[]) => (handlers[event] || []).forEach(fn => fn(...args)),
    subscribe: jest.fn(subscribeImpl || ((topic: string, cb: (error: Error | null) => void) => cb(null))),
    end: jest.fn()
  };
  clients.push(client);
  // Settle on the next tick so the caller can attach its handlers first.
  setImmediate(() => (failWith ? client.emit('error', failWith) : client.emit('connect')));
  return client;
};

jest.mock('mqtt', () => ({ connect: jest.fn((opts) => makeClient(opts)) }));

import fs from 'fs';
import mqtt from 'mqtt';
import * as latentMqtt from '../../src/latentApplications/mqtt';

const lastClient = () => clients[clients.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  clients.length = 0;
});

describe('mqtt.start', () => {
  test('connects with the host, client id and default protocol', async () => {
    await latentMqtt.start({}, { client: 'c1', connection: { host: 'broker' } });

    expect(mqtt.connect).toHaveBeenCalledWith(expect.objectContaining({
      host: 'broker', clientId: 'c1', protocol: 'mqtt'
    }));
  });

  test('an explicit protocol wins', async () => {
    await latentMqtt.start({}, { client: 'c2', connection: { host: 'b', protocol: 'mqtts' } });
    expect((mqtt.connect as jest.Mock).mock.calls[0][0].protocol).toBe('mqtts');
  });

  test('TLS material is read off disk when configured', async () => {
    const read = jest.spyOn(fs, 'readFileSync').mockReturnValue('PEM' as any);

    await latentMqtt.start({}, {
      client: 'c3',
      connection: { host: 'b', key: '/k.pem', cert: '/c.pem', ca: '/ca.pem' }
    });

    const opts = (mqtt.connect as jest.Mock).mock.calls[0][0];
    expect(opts).toEqual(expect.objectContaining({ key: 'PEM', cert: 'PEM', ca: 'PEM' }));
    expect(read).toHaveBeenCalledTimes(3);
    read.mockRestore();
  });

  test('port, credentials and certificate checking are passed through', async () => {
    await latentMqtt.start({}, {
      client: 'c3b',
      connection: { host: 'b', port: 8883, username: 'u', password: 'p', rejectUnauthorized: false }
    });

    expect((mqtt.connect as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({
      port: 8883, username: 'u', password: 'p', rejectUnauthorized: false
    }));
  });

  test('subscribes to a single topic', async () => {
    await latentMqtt.start({}, {
      client: 'c4', connection: { host: 'b' }, subscribe: { topic: 'orders' }
    });
    expect(lastClient().subscribe).toHaveBeenCalledWith('orders', expect.any(Function));
  });

  test('subscribes to a list of topics', async () => {
    await latentMqtt.start({}, {
      client: 'c5', connection: { host: 'b' }, subscribe: [{ topic: 'a' }, { topic: 'b' }]
    });
    expect(lastClient().subscribe).toHaveBeenCalledTimes(2);
  });

  test('a failing subscription rejects', async () => {
    (mqtt.connect as jest.Mock).mockImplementationOnce((opts) =>
      makeClient(opts, (topic: string, cb: (error: Error | null) => void) => cb(new Error('denied'))));

    await expect(latentMqtt.start({}, {
      client: 'c6', connection: { host: 'b' }, subscribe: { topic: 'x' }
    })).rejects.toThrow('denied');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Error subscribing'));
  });

  test('a connection error rejects and is logged', async () => {
    (mqtt.connect as jest.Mock).mockImplementationOnce((opts) =>
      makeClient(opts, undefined, new Error('refused')));

    await expect(latentMqtt.start({}, { client: 'c7', connection: { host: 'b' } }))
      .rejects.toThrow('refused');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Error connecting'));
  });

  test('starting the same client id again reuses the instance', async () => {
    await latentMqtt.start({}, { client: 'shared', connection: { host: 'b' } });
    (mqtt.connect as jest.Mock).mockClear();

    await latentMqtt.start({}, { client: 'shared', connection: { host: 'b' } });
    expect(mqtt.connect).not.toHaveBeenCalled();

    latentMqtt.stop('shared');
  });
});

describe('mqtt.test', () => {
  beforeEach(async () => {
    await latentMqtt.start({}, { client: 'tester', connection: { host: 'b' } });
    lastClient().emit('message', 'orders', Buffer.from(JSON.stringify({ id: 1, status: 'paid' })));
  });

  afterEach(() => latentMqtt.stop('tester'));

  test('resolves with nothing unmatched when the message arrived', async () => {
    await expect(latentMqtt.test({}, {
      client: 'tester', test: [{ topic: 'orders', message: { id: 1 } }]
    }, {})).resolves.toEqual([]);
  });

  test('matches on a subset of the payload keys', async () => {
    await expect(latentMqtt.test({}, {
      client: 'tester', test: [{ topic: 'orders', message: { status: 'paid' } }]
    }, {})).resolves.toEqual([]);
  });

  test('reports a message that never arrived', async () => {
    const notMatched: any = await latentMqtt.test({}, {
      client: 'tester', test: [{ topic: 'shipments', message: { id: 9 } }]
    }, {});
    expect(notMatched).toEqual([{ topic: 'shipments', message: { id: 9 } }]);
  });

  test('a payload mismatch on the right topic is reported', async () => {
    const notMatched: any = await latentMqtt.test({}, {
      client: 'tester', test: [{ topic: 'orders', message: { id: 999 } }]
    }, {});
    expect(notMatched).toHaveLength(1);
  });

  test('an unknown client rejects', async () => {
    await expect(latentMqtt.test({}, { client: 'ghost', test: [] }, {}))
      .rejects.toThrow(/does not exist or is not connected/);
  });

  test('retries the configured number of times before giving up', async () => {
    jest.useFakeTimers();
    const pending = latentMqtt.test({}, {
      client: 'tester',
      test: [{ topic: 'never', message: {} }],
      retry: { attempts: 3, delay: 1 }
    }, {});

    await jest.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toHaveLength(1);
    jest.useRealTimers();
  });
});

describe('mqtt.test - topics', () => {
  beforeEach(async () => {
    await latentMqtt.start({}, { client: 'topics', connection: { host: 'b' } });
    lastClient().emit(
      'message',
      'msg/cloud/1234/command',
      Buffer.from(JSON.stringify({ hdf: { cat: 'order-status' }, bdy: [{ id: 'o1', cmp: 'c1' }] }))
    );
  });

  afterEach(() => latentMqtt.stop('topics'));

  test('a single-level wildcard stands for the part the flow does not know', async () => {
    await expect(latentMqtt.test({}, {
      client: 'topics', test: [{ topic: 'msg/cloud/+/command', message: { hdf: { cat: 'order-status' } } }]
    }, {})).resolves.toEqual([]);
  });

  test('a multi-level wildcard covers the rest of the topic', async () => {
    await expect(latentMqtt.test({}, {
      client: 'topics', test: [{ topic: 'msg/cloud/#', message: {} }]
    }, {})).resolves.toEqual([]);
  });

  test('a wildcard does not match a topic of a different depth', async () => {
    await expect(latentMqtt.test({}, {
      client: 'topics', test: [{ topic: 'msg/cloud/+', message: {} }]
    }, {})).resolves.toHaveLength(1);
  });

  test('the topic is interpolated against the memory as it stands', async () => {
    const flow = { memory: { device: '1234' } };

    await expect(latentMqtt.test(flow, {
      client: 'topics', test: [{ topic: 'msg/cloud/{{ memory.device }}/request', message: {} }]
    }, {})).resolves.toEqual([]);
  });

  test('a topic naming something nothing has remembered yet is reported as written', async () => {
    const notMatched: any = await latentMqtt.test({ memory: {} }, {
      client: 'topics', test: [{ topic: 'msg/cloud/{{ memory.device }}/request', message: {} }]
    }, {});

    expect(notMatched[0].topic).toBe('msg/cloud/{{ memory.device }}/request');
  });
});

describe('mqtt.test - what the message has to say', () => {
  beforeEach(async () => {
    await latentMqtt.start({}, { client: 'deep', connection: { host: 'b' } });
    lastClient().emit(
      'message',
      'msg/cloud/1234/command',
      Buffer.from(JSON.stringify({
        hdf: { cat: 'order-status', tms: 12 },
        bdy: [{ id: 'order-1', cmp: 'compartment-1', sta: 'created' }]
      }))
    );
  });

  afterEach(() => latentMqtt.stop('deep'));

  test('a nested expectation is compared value by value', async () => {
    await expect(latentMqtt.test({}, {
      client: 'deep',
      test: [{ topic: 'msg/cloud/1234/command', message: { hdf: { cat: 'order-status' } } }]
    }, {})).resolves.toEqual([]);
  });

  test('a nested expectation that differs is reported', async () => {
    await expect(latentMqtt.test({}, {
      client: 'deep',
      test: [{ topic: 'msg/cloud/1234/command', message: { hdf: { cat: 'barcode' } } }]
    }, {})).resolves.toHaveLength(1);
  });

  test('an expression is evaluated over the actual value', async () => {
    await expect(latentMqtt.test({}, {
      client: 'deep',
      test: [{ topic: 'msg/cloud/1234/command', message: { bdy: '$expr: value.some(b => b.cmp)' } }]
    }, {})).resolves.toEqual([]);
  });

  test('an expression that throws does not take the run down', async () => {
    await expect(latentMqtt.test({}, {
      client: 'deep',
      test: [{ topic: 'msg/cloud/1234/command', message: { bdy: '$expr: value.nope()' } }]
    }, {})).resolves.toHaveLength(1);
  });

  test('an expression reads what an earlier step remembered', async () => {
    const flow = { memory: { orderId: 'order-1' } };

    await expect(latentMqtt.test(flow, {
      client: 'deep',
      test: [{
        topic: 'msg/cloud/1234/command',
        message: { bdy: '$expr: value.some(b => b.id === memory.orderId)' }
      }]
    }, {})).resolves.toEqual([]);
  });

  test('a list expectation is matched item by item', async () => {
    await expect(latentMqtt.test({}, {
      client: 'deep',
      test: [{ topic: 'msg/cloud/1234/command', message: { bdy: [{ sta: 'created' }] } }]
    }, {})).resolves.toEqual([]);
  });

  test('a payload that is not JSON is kept as text rather than thrown away', async () => {
    lastClient().emit('message', 'raw', Buffer.from('not json'));

    await expect(latentMqtt.test({}, {
      client: 'deep', test: [{ topic: 'raw', message: '$expr: value === "not json"' }]
    }, {})).resolves.toEqual([]);
  });
});

describe('mqtt.test - keeping what arrived', () => {
  let flow: any;

  beforeEach(async () => {
    flow = { memory: { barcode: '3232' } };
    await latentMqtt.start({}, { client: 'keeper', connection: { host: 'b' } });
    lastClient().emit(
      'message',
      'msg/cloud/1234/command',
      Buffer.from(JSON.stringify({
        hdf: { cat: 'order-status' },
        bdy: [{ id: 'order-1', cmp: 'compartment-1' }]
      }))
    );
  });

  afterEach(() => latentMqtt.stop('keeper'));

  test('writes what the mapping names into the flow memory', async () => {
    await latentMqtt.test(flow, {
      client: 'keeper',
      test: [{
        topic: 'msg/cloud/+/command',
        message: { hdf: { cat: 'order-status' } },
        memory: {
          orderId: '{{ message.bdy.0.id }}',
          compartmentId: '{{ message.bdy.0.cmp }}',
          onTopic: '{{ topic }}'
        }
      }]
    }, {});

    expect(flow.memory).toEqual({
      barcode: '3232',
      orderId: 'order-1',
      compartmentId: 'compartment-1',
      onTopic: 'msg/cloud/1234/command'
    });
  });

  test('a message that never arrived writes nothing', async () => {
    await latentMqtt.test(flow, {
      client: 'keeper',
      test: [{ topic: 'never', message: {}, memory: { orderId: '{{ message.bdy.0.id }}' } }]
    }, {});

    expect(flow.memory.orderId).toBeUndefined();
  });
});

describe('mqtt.stop', () => {
  test('ends the connection and forgets the instance', async () => {
    await latentMqtt.start({}, { client: 'closer', connection: { host: 'b' } });
    const client = lastClient();

    latentMqtt.stop('closer');

    expect(client.end).toHaveBeenCalled();
    await expect(latentMqtt.test({}, { client: 'closer', test: [] }, {})).rejects.toThrow();
  });

  test('stopping an unknown client is a no-op', () => {
    expect(() => latentMqtt.stop('never-started')).not.toThrow();
  });
});
