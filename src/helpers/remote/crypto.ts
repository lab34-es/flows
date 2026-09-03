import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes
} from 'crypto';

/**
 * Sealing the environment variables for one agent.
 *
 * The broker sees every message, and TLS only protects the wire. The values of
 * the env files are the one thing a job carries that the broker's operator
 * must not be able to read, so they are encrypted to the agent's own key
 * before they leave: an X25519 agreement between a throwaway key and the
 * agent's, HKDF to an AES-256-GCM key, and the ciphertext with its tag. All
 * of it is Node's own crypto module -- no dependency to keep patched.
 *
 * Keys travel as base64 DER, which is what the agent prints at startup and
 * what the person's side stores next to the agent's name.
 */

const INFO = 'lab34-flows remote env v1';

/** What a sealed document looks like on the wire. */
interface SealedBox {
  v: 1;
  /** The throwaway public key, base64 DER */
  epk: string;
  /** AES-GCM nonce, base64 */
  iv: string;
  /** Ciphertext, base64 */
  ct: string;
  /** GCM tag, base64 */
  tag: string;
}

/**
 * A fresh X25519 pair, both halves as base64 DER.
 * @returns {{publicKey: string, privateKey: string}}
 */
const generateKeyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');

  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
  };
};

const publicKeyOf = (base64: string) =>
  createPublicKey({ key: Buffer.from(base64, 'base64'), type: 'spki', format: 'der' });

const privateKeyOf = (base64: string) =>
  createPrivateKey({ key: Buffer.from(base64, 'base64'), type: 'pkcs8', format: 'der' });

/**
 * The AES key both sides derive from the agreement.
 * @param {Buffer} secret - The X25519 shared secret
 * @param {string} epk - The throwaway public key, base64, so a key is bound to its exchange
 * @returns {Buffer}
 */
const derive = (secret: Buffer, epk: string) =>
  Buffer.from(hkdfSync('sha256', secret, Buffer.from(epk, 'base64'), INFO, 32));

/**
 * Encrypt a text so that only the holder of the private half of `publicKey`
 * can read it.
 * @param {string} publicKey - The agent's public key, base64 DER
 * @param {string} plaintext
 * @returns {SealedBox}
 */
const seal = (publicKey: string, plaintext: string): SealedBox => {
  const recipient = publicKeyOf(publicKey);
  const ephemeral = generateKeyPairSync('x25519');
  const epk = ephemeral.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  const secret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const key = derive(secret, epk);

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    v: 1,
    epk,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64')
  };
};

/**
 * Decrypt what `seal` produced.
 * @param {string} privateKey - The agent's private key, base64 DER
 * @param {SealedBox} box
 * @returns {string} The plaintext
 */
const open = (privateKey: string, box: SealedBox): string => {
  if (!box || box.v !== 1 || !box.epk || !box.iv || !box.ct || !box.tag) {
    throw new Error('Not a sealed document this version can open');
  }

  const secret = diffieHellman({ privateKey: privateKeyOf(privateKey), publicKey: publicKeyOf(box.epk) });
  const key = derive(secret, box.epk);

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));

  try {
    return Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]).toString('utf8');
  }
  catch {
    throw new Error('The document was not sealed for this agent, or was altered on the way');
  }
};

/**
 * A short, human-comparable name for a public key, the way ssh shows one.
 * @param {string} publicKey - base64 DER
 * @returns {string} e.g. "3f:a9:…" (16 bytes of SHA-256)
 */
const fingerprint = (publicKey: string): string => {
  const digest = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex');
  return (digest.slice(0, 32).match(/.{2}/g) || []).join(':');
};

export type { SealedBox };
export { generateKeyPair, seal, open, fingerprint };
