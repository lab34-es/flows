import * as latent from '../../src/helpers/latent';

describe('latent.decode', () => {
  test('JSON arrives parsed, anything else as text, and no payload as null', () => {
    expect(latent.decode(Buffer.from('{"a":1}'))).toEqual({ a: 1 });
    expect(latent.decode(Buffer.from('not json'))).toBe('not json');
    expect(latent.decode(Buffer.from(''))).toBe('');
    expect(latent.decode(null)).toBeNull();
    expect(latent.decode(undefined)).toBeNull();
  });
});

describe('latent.interpolate', () => {
  test('fills in what the flow remembered, and leaves the rest as written', () => {
    const flow = { memory: { device: 1234, order: { id: 'o-1' } } };

    expect(latent.interpolate('msg/{{ memory.device }}/{{memory.order.id}}', flow)).toBe('msg/1234/o-1');
    expect(latent.interpolate('msg/{{ memory.nobody }}', flow)).toBe('msg/{{ memory.nobody }}');
    expect(latent.interpolate('msg/{{ memory.device }}', undefined)).toBe('msg/{{ memory.device }}');
  });

  test('anything that is not a template is returned as it is', () => {
    expect(latent.interpolate('plain', {})).toBe('plain');
    expect(latent.interpolate(42, {})).toBe(42);
    expect(latent.interpolate(undefined, {})).toBeUndefined();
  });
});

describe('latent.matches', () => {
  test('an expression sees the value, the memory and the flow', () => {
    const flow = { memory: { id: 7 }, environment: 'local' };

    expect(latent.matches('$expr: value === memory.id && flow.environment === "local"', 7, flow)).toBe(true);
    expect(latent.matches('$expr: value === memory.id', 7)).toBe(false);
  });

  test('a list is matched item by item, and needs at least as many items', () => {
    expect(latent.matches([{ a: 1 }], [{ a: 1, b: 2 }, { a: 3 }])).toBe(true);
    expect(latent.matches([{ a: 1 }, { a: 3 }], [{ a: 1 }])).toBe(false);
    expect(latent.matches([1], 'not a list')).toBe(false);
  });

  test('an object needs an object, and null is a value like any other', () => {
    expect(latent.matches({ a: 1 }, null)).toBe(false);
    expect(latent.matches({ a: 1 }, 'text')).toBe(false);
    expect(latent.matches(null, null)).toBe(true);
    expect(latent.matches({ a: null }, { a: null })).toBe(true);
  });
});

describe('latent.check', () => {
  const found = { found: true as const, scope: { message: { id: 'o-1' } } };

  test('an empty list of expectations passes; no list at all does not', async () => {
    await expect(latent.check({}, [], undefined, () => found)).resolves.toEqual([]);
    await expect(latent.check({}, undefined, undefined, () => found, 'mqtt'))
      .rejects.toThrow('The mqtt assertion lists no messages');
  });

  test('a find that throws fails the check with its error, even from a later look', async () => {
    jest.useFakeTimers();
    let looks = 0;

    const pending = latent.check({}, [{ topic: 't' }], { attempts: 3, delay: 1 }, () => {
      looks++;
      if (looks === 2) { throw new Error('listener gone'); }
      return { found: false, missing: { topic: 't' } };
    });

    // Attached before the timer fires, or the rejection would count as unhandled
    const failed = expect(pending).rejects.toThrow('listener gone');
    await jest.advanceTimersByTimeAsync(1000);
    await failed;
    jest.useRealTimers();
  });

  test('a memory mapping needs a flow to write to', async () => {
    await expect(latent.check(null, [{ memory: { id: '{{ message.id }}' } }], undefined, () => found)).resolves.toEqual([]);

    const flow: any = {};
    await latent.check(flow, [{ memory: { id: '{{ message.id }}' } }], undefined, () => found);
    expect(flow.memory).toEqual({ id: 'o-1' });
  });
});

describe('latent.connectionSource and connectionOverrides', () => {
  test('an application is named on its own, or inside the connection', () => {
    expect(latent.connectionSource('orders')).toBe('orders');
    expect(latent.connectionSource({ application: ' orders ', groupId: 'qa' })).toBe('orders');
    expect(latent.connectionSource({ brokers: ['a:1'] })).toBeNull();
    expect(latent.connectionSource('  ')).toBeNull();
    expect(latent.connectionSource(undefined)).toBeNull();
  });

  test('what the flow wrote itself, without the application it named', () => {
    expect(latent.connectionOverrides({ application: 'orders', groupId: 'qa' })).toEqual({ groupId: 'qa' });
    expect(latent.connectionOverrides({ brokers: ['a:1'] })).toEqual({ brokers: ['a:1'] });
    expect(latent.connectionOverrides('orders')).toEqual({});
    expect(latent.connectionOverrides(null)).toEqual({});
  });
});
