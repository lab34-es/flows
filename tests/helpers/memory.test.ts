import * as memory from '../../src/helpers/memory';

describe('memory.at', () => {
  test('reads a path off a value', () => {
    expect(memory.at({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1);
  });

  test('a path that runs out returns nothing rather than throwing', () => {
    expect(memory.at({ a: null }, 'a.b.c')).toBeUndefined();
    expect(memory.at(undefined, 'a')).toBeUndefined();
  });
});

describe('memory.resolve', () => {
  test('a lone expression keeps the type it had', () => {
    const resolved = memory.resolve(
      { count: '{{ body.count }}', token: '{{ body.token }}' },
      { body: { count: 7, token: 'a.b=' } }
    );

    expect(resolved).toEqual({ count: 7, token: 'a.b=' });
  });

  test('an expression mixed into text is rendered as text', () => {
    expect(memory.resolve({ header: 'Bearer {{ body.token }}' }, { body: { token: 'x' } }))
      .toEqual({ header: 'Bearer x' });
  });

  test('a value that is not a template is kept as written', () => {
    expect(memory.resolve({ environment: 'local', attempts: 2 }, {}))
      .toEqual({ environment: 'local', attempts: 2 });
  });

  test('a key that resolves to nothing is not written, and says so', () => {
    const resolved = memory.resolve({ missing: '{{ body.nope }}' }, { body: {} }, 'Latent memory');

    expect(resolved).toEqual({});
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Latent memory: "missing"'));
  });
});
