jest.mock('yargs-parser', () => () => ({}));
jest.mock('../../src/helpers/paths');

import fs from 'fs';

import * as paths from '../../src/helpers/paths';
import * as tester from '../../src/helpers/runner/tester';

describe('tester.test - status assertions', () => {
  test('a matching single status produces no errors', async () => {
    const report = await tester.test({}, { status: 200 }, { status: 200 });
    expect(report.hasErrors).toBe(false);
    expect(report.status).toEqual([]);
  });

  test('a status within a list of accepted ones passes', async () => {
    const report = await tester.test({}, { status: [200, 201, 204] }, { status: 201 });
    expect(report.hasErrors).toBe(false);
  });

  test('a mismatch reports what was expected and what arrived', async () => {
    const report = await tester.test({}, { status: 200 }, { status: 500 });
    expect(report.hasErrors).toBe(true);
    expect(report.status).toEqual([{
      message: 'Expected status does not match actual status',
      expected: [200],
      actual: 500
    }]);
  });

  test('a status outside the accepted list fails', async () => {
    const report = await tester.test({}, { status: [200, 201] }, { status: 404 });
    expect(report.status[0].expected).toEqual([200, 201]);
    expect(report.status[0].actual).toBe(404);
  });
});

describe('tester.test - body assertions', () => {
  test('matching scalars pass', async () => {
    const report = await tester.test({}, { body: { a: 1 } }, { body: { a: 1 } });
    expect(report.hasErrors).toBe(false);
  });

  test('extra keys in the actual body are ignored', async () => {
    const report = await tester.test({}, { body: { a: 1 } }, { body: { a: 1, b: 2 } });
    expect(report.hasErrors).toBe(false);
  });

  test('a differing value is reported with its path', async () => {
    const report = await tester.test({}, { body: { a: 1 } }, { body: { a: 2 } });
    expect(report.body).toEqual([{ message: 'Value mismatch at a', expected: 1, actual: 2 }]);
  });

  test('a missing key is reported with its path', async () => {
    const report = await tester.test({}, { body: { a: 1 } }, { body: {} });
    expect(report.body[0].message).toBe("Missing key 'a' in actual object");
    expect(report.body[0].actual).toBeUndefined();
  });

  test('nested objects are compared recursively and paths are dotted', async () => {
    const report = await tester.test(
      {},
      { body: { user: { address: { city: 'Ghent' } } } },
      { body: { user: { address: { city: 'Mons' } } } }
    );
    expect(report.body[0].message).toBe('Value mismatch at user.address.city');
  });

  test('a missing nested key names the full path', async () => {
    const report = await tester.test({}, { body: { user: { id: 1 } } }, { body: { user: {} } });
    expect(report.body[0].message).toBe("Missing key 'user.id' in actual object");
  });

  test('several mismatches are all collected', async () => {
    const report = await tester.test({}, { body: { a: 1, b: 2 } }, { body: { a: 9, b: 8 } });
    expect(report.body).toHaveLength(2);
  });
});

describe('tester.test - $expr: assertions', () => {
  test('a satisfied expression passes', async () => {
    const report = await tester.test({}, { body: { n: '$expr:value > 5' } }, { body: { n: 10 } });
    expect(report.hasErrors).toBe(false);
  });

  test('an unsatisfied expression reports the expression and the value', async () => {
    const report = await tester.test({}, { body: { n: '$expr:value > 5' } }, { body: { n: 1 } });
    expect(report.body).toEqual([{
      message: 'Expression evaluation failed at n',
      expression: 'value > 5',
      actualValue: 1
    }]);
  });

  test('an expression can assert on the whole body', async () => {
    const report = await tester.test(
      {},
      { body: '$expr:Array.isArray(value) && value.length === 2' },
      { body: [1, 2] }
    );
    expect(report.hasErrors).toBe(false);
  });

  test('an expression that throws counts as a failure rather than crashing', async () => {
    const report = await tester.test({}, { body: { n: '$expr:value.nope.deep' } }, { body: { n: null } });
    expect(report.hasErrors).toBe(true);
    expect(report.body[0].message).toBe('Expression evaluation failed at n');
  });

  test('a syntactically invalid expression counts as a failure', async () => {
    const report = await tester.test({}, { body: { n: '$expr:!!!' } }, { body: { n: 1 } });
    expect(report.hasErrors).toBe(true);
  });

  test('expressions can be nested inside objects', async () => {
    const report = await tester.test(
      {},
      { body: { user: { age: '$expr:value >= 18' } } },
      { body: { user: { age: 21 } } }
    );
    expect(report.hasErrors).toBe(false);
  });
});

describe('tester.test - expressions and the memory', () => {
  test('an expression reads what an earlier step remembered', async () => {
    const flow = { memory: { barcode: '3232999' } };

    const report = await tester.test(
      flow,
      { body: { barcode: '$expr: value === memory.barcode' } },
      { body: { barcode: '3232999' } }
    );

    expect(report.hasErrors).toBe(false);
  });

  test('the flow itself is in scope too', async () => {
    const flow = { memory: { acCode: '42108' } };

    const report = await tester.test(
      flow,
      { body: { data: '$expr: value.some(i => i.ac === flow.memory.acCode)' } },
      { body: { data: [{ ac: '42108' }] } }
    );

    expect(report.hasErrors).toBe(false);
  });

  test('a flow with nothing in memory still evaluates', async () => {
    const report = await tester.test(
      {},
      { body: { barcode: '$expr: value === memory.barcode' } },
      { body: { barcode: '3232999' } }
    );

    expect(report.hasErrors).toBe(true);
  });
});

describe('tester.test - latent applications', () => {
  test('collects the errors a latent application reports', async () => {
    const code = { test: jest.fn().mockResolvedValue(['boom']) };
    const flow = { latentApplications: [{ application: 'mqtt', code }] };

    const report = await tester.test(
      flow,
      { latentApplications: [{ application: 'mqtt', messages: [] }] },
      { status: 200 }
    );

    expect(code.test).toHaveBeenCalled();
    expect(report.latentApplications).toEqual([{ application: 'mqtt', errors: ['boom'] }]);
    expect(report.hasErrors).toBe(true);
  });

  test('an application that reports nothing falsy is skipped', async () => {
    const code = { test: jest.fn().mockResolvedValue(null) };
    const flow = { latentApplications: [{ application: 'mqtt', code }] };

    const report = await tester.test(
      flow,
      { latentApplications: [{ application: 'mqtt' }] },
      {}
    );

    expect(report.latentApplications).toEqual([]);
    expect(report.hasErrors).toBe(false);
  });

  test('an application that reports an empty list of errors passes the step', async () => {
    const code = { test: jest.fn().mockResolvedValue([]) };
    const flow = { latentApplications: [{ application: 'mqtt', code }] };

    const report = await tester.test(
      flow,
      { latentApplications: [{ application: 'mqtt' }] },
      {}
    );

    expect(report.latentApplications).toEqual([]);
    expect(report.hasErrors).toBe(false);
  });

  test('an empty latentApplications list is not evaluated at all', async () => {
    const report = await tester.test({}, { latentApplications: [] }, {});
    expect(report.latentApplications).toBeUndefined();
  });
});

describe('tester.test - report shape', () => {
  test('a test with no assertions reports no errors and no cases', async () => {
    expect(await tester.test({}, {}, {})).toEqual({ hasErrors: false });
  });

  test('status and body assertions are reported side by side', async () => {
    const report = await tester.test(
      {},
      { status: 200, body: { a: 1 } },
      { status: 200, body: { a: 1 } }
    );
    expect(report).toEqual({ hasErrors: false, status: [], body: [] });
  });

  test('one failing case is enough to set hasErrors', async () => {
    const report = await tester.test(
      {},
      { status: 200, body: { a: 1 } },
      { status: 200, body: { a: 2 } }
    );
    expect(report.hasErrors).toBe(true);
    expect(report.status).toEqual([]);
  });
});

describe('tester.getReady', () => {
  test('gives a flow without latent applications an empty list', async () => {
    const flow: any = {};
    await tester.getReady(flow);
    expect(flow.latentApplications).toEqual([]);
  });

  test('loads each latent application module and starts it', async () => {
    const flow: any = { latentApplications: [{ application: 'mqtt', connection: {} }] };
    const mqtt = require('../../src/latentApplications/mqtt');
    const start = jest.spyOn(mqtt, 'start').mockResolvedValue(undefined);

    await tester.getReady(flow);

    expect(flow.latentApplications[0].code).toBeDefined();
    expect(start).toHaveBeenCalledWith(flow, flow.latentApplications[0]);
    start.mockRestore();
  });

  describe('a connection taken from an application', () => {
    let start: jest.SpyInstance;

    beforeEach(() => {
      (paths.contextDir as jest.Mock).mockImplementation(async (parts: string[]) => `/ctx/${parts.join('/')}`);
      start = jest.spyOn(require('../../src/latentApplications/kafka'), 'start').mockResolvedValue(undefined);
    });

    afterEach(() => start.mockRestore());

    test('reads that application\'s env file for the environment the flow runs against', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const read = jest.spyOn(fs, 'readFileSync').mockReturnValue('KAFKA_BROKERS=b:9092\nKAFKA_PASSWORD=s3cret\n' as any);
      const flow: any = {
        latentApplications: [
          { application: 'kafka', client: 'shop', connection: 'orders' },
          { application: 'kafka', client: 'audit', connection: { application: 'orders', groupId: 'qa' } }
        ]
      };

      await tester.getReady(flow, 'staging');

      expect(read).toHaveBeenCalledWith('/ctx/applications/orders/env/staging.env');
      expect(flow.latentApplications[0].env).toEqual({ KAFKA_BROKERS: 'b:9092', KAFKA_PASSWORD: 's3cret' });
      expect(flow.latentApplications[1].env).toEqual({ KAFKA_BROKERS: 'b:9092', KAFKA_PASSWORD: 's3cret' });
      expect(start).toHaveBeenCalledTimes(2);
    });

    test('an application with no env file for the environment stops the flow before it starts', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const flow: any = { latentApplications: [{ application: 'kafka', client: 'shop', connection: 'orders' }] };

      await expect(tester.getReady(flow, 'prod'))
        .rejects.toThrow("The kafka client 'shop' connects the way 'orders' does, but applications/orders/env/prod.env does not exist");
      expect(start).not.toHaveBeenCalled();
    });

    test('without an environment there is no env file to read', async () => {
      const flow: any = { latentApplications: [{ application: 'kafka', client: 'shop', connection: 'orders' }] };

      await expect(tester.getReady(flow)).rejects.toThrow('applications/orders/env/<environment>.env does not exist');
    });
  });
});

describe('tester.shutdown', () => {
  test('stops every latent application the flow started, by its client', async () => {
    const mqtt = { stop: jest.fn() };
    const kafka = { stop: jest.fn().mockResolvedValue(undefined) };
    const flow = {
      latentApplications: [
        { application: 'mqtt', client: 'devices', code: mqtt },
        { application: 'kafka', client: 'orders', code: kafka }
      ]
    };

    await tester.shutdown(flow);

    expect(mqtt.stop).toHaveBeenCalledWith('devices');
    expect(kafka.stop).toHaveBeenCalledWith('orders');
  });

  test('skips what never got as far as being loaded, and a flow with none', async () => {
    await expect(tester.shutdown({ latentApplications: [{ application: 'kafka', client: 'c' }] })).resolves.toBeUndefined();
    await expect(tester.shutdown({ latentApplications: [{ application: 'x', code: {} }] })).resolves.toBeUndefined();
    await expect(tester.shutdown({})).resolves.toBeUndefined();
  });

  test('a listener that will not hang up is logged, and the others are still stopped', async () => {
    const stuck = { stop: jest.fn().mockRejectedValue(new Error('broker gone')) };
    const next = { stop: jest.fn() };

    await expect(tester.shutdown({
      latentApplications: [
        { application: 'kafka', client: 'a', code: stuck },
        { application: 'mqtt', client: 'b', code: next }
      ]
    })).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith("Could not stop the kafka client 'a':", expect.any(Error));
    expect(next.stop).toHaveBeenCalledWith('b');
  });
});
