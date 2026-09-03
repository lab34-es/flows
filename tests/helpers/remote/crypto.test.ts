import * as crypto from '../../../src/helpers/remote/crypto';

describe('remote/crypto', () => {
  test('what is sealed to a key opens with its private half, and only that', () => {
    const agent = crypto.generateKeyPair();
    const other = crypto.generateKeyPair();

    const box = crypto.seal(agent.publicKey, 'API_KEY=secret\n');

    expect(box.v).toBe(1);
    expect(box.ct).not.toContain('secret');
    expect(crypto.open(agent.privateKey, box)).toBe('API_KEY=secret\n');
    expect(() => crypto.open(other.privateKey, box)).toThrow('not sealed for this agent');
  });

  test('a box altered on the way does not open', () => {
    const agent = crypto.generateKeyPair();
    const box = crypto.seal(agent.publicKey, 'hello');

    const flipped = Buffer.from(box.ct, 'base64');
    flipped[0] = flipped[0] ^ 0xff;

    expect(() => crypto.open(agent.privateKey, { ...box, ct: flipped.toString('base64') }))
      .toThrow('altered on the way');
  });

  test('every seal uses a fresh throwaway key', () => {
    const agent = crypto.generateKeyPair();
    const first = crypto.seal(agent.publicKey, 'same');
    const second = crypto.seal(agent.publicKey, 'same');

    expect(first.epk).not.toBe(second.epk);
    expect(first.ct).not.toBe(second.ct);
  });

  test('refuses what is not a sealed box', () => {
    const agent = crypto.generateKeyPair();
    expect(() => crypto.open(agent.privateKey, null as any)).toThrow('Not a sealed document');
    expect(() => crypto.open(agent.privateKey, { v: 2 } as any)).toThrow('Not a sealed document');
  });

  test('fingerprints read like ssh ones and are stable', () => {
    const agent = crypto.generateKeyPair();
    const fingerprint = crypto.fingerprint(agent.publicKey);

    expect(fingerprint).toMatch(/^([0-9a-f]{2}:){15}[0-9a-f]{2}$/);
    expect(crypto.fingerprint(agent.publicKey)).toBe(fingerprint);
    expect(crypto.fingerprint(crypto.generateKeyPair().publicKey)).not.toBe(fingerprint);
  });
});
