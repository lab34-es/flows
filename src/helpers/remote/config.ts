import * as configHelper from '../config';
import * as env from '../env';
import * as crypto from './crypto';
import { assertName } from './topics';

/**
 * What both sides of a remote run keep in the context.
 *
 * `config/remote.json` is the shareable half: the broker's address, the
 * username and, on the person's side, the public key of every agent they
 * have talked to. The two things that must not travel with the context --
 * the broker password and an agent's private key -- go to the context's
 * `.env`, which the env helper keeps out of git.
 *
 * A flag given on the command line wins over what is stored, and is stored
 * for next time, so `--broker` has to be typed once.
 */

const FILE = 'remote';

/** The broker password, in the context's .env */
const PASSWORD_KEY = 'FLOWS_BROKER_PASSWORD';

/** The agent's private key, in the context's .env */
const PRIVATE_KEY_KEY = 'FLOWS_AGENT_PRIVATE_KEY';

interface KnownAgent {
  publicKey: string;
  fingerprint: string;
  /** When the key was first stored */
  since: number;
}

interface RemoteConfig {
  broker?: {
    url?: string;
    username?: string;
  };
  /** This machine's own name, when it runs as an agent */
  agentId?: string;
  /** This machine's public key, when it runs as an agent */
  publicKey?: string;
  /** Agents this machine has run flows on, by name */
  agents?: Record<string, KnownAgent>;
}

const load = async (): Promise<RemoteConfig> => (await configHelper.load(FILE)) || {};

const save = async (next: RemoteConfig) => configHelper.save(FILE, next);

interface BrokerSettings {
  url: string;
  username?: string;
  password?: string;
}

/**
 * How to reach the broker, from the flags, the environment or what was
 * stored -- in that order. Flags are stored for the next time.
 *
 * @param {Object} given - { url, username, password } as typed on the command line
 * @returns {Promise<BrokerSettings>}
 */
const brokerSettings = async (given: Partial<BrokerSettings> = {}): Promise<BrokerSettings> => {
  const stored = await load();

  const url = given.url || process.env.FLOWS_BROKER_URL || (stored.broker && stored.broker.url);
  const username = given.username || process.env.FLOWS_BROKER_USERNAME || (stored.broker && stored.broker.username);
  const password = given.password || process.env[PASSWORD_KEY] || await env.read(PASSWORD_KEY);

  if (!url) {
    throw new Error('No broker configured. Pass --broker mqtts://host:port once, or set FLOWS_BROKER_URL');
  }

  if (!/^(mqtts?|wss?):\/\//.test(url)) {
    throw new Error(`Broker URL must start with mqtt://, mqtts://, ws:// or wss://: ${url}`);
  }

  if (given.url || given.username) {
    await save({ ...stored, broker: { url, ...(username ? { username } : {}) } });
  }

  if (given.password) {
    await env.write(PASSWORD_KEY, given.password);
  }

  return { url, ...(username ? { username } : {}), ...(password ? { password } : {}) };
};

interface AgentIdentity {
  id: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
}

/**
 * Who this machine is when it runs as an agent: its name and its key pair.
 * The pair is created the first time and kept, so the person's side can
 * trust the key once.
 *
 * @param {string} [given] - Name typed on the command line
 * @returns {Promise<AgentIdentity>}
 */
const agentIdentity = async (given?: string): Promise<AgentIdentity> => {
  const stored = await load();
  const id = given || process.env.FLOWS_AGENT_ID || stored.agentId;

  if (!id) {
    throw new Error('No agent name. Pass --agent-id <name> once: it is the name the broker knows this machine by');
  }

  assertName(id, 'Agent name');

  let privateKey = await env.read(PRIVATE_KEY_KEY);
  let publicKey = stored.publicKey;

  if (!privateKey || !publicKey) {
    const pair = crypto.generateKeyPair();
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    await env.write(PRIVATE_KEY_KEY, privateKey);
  }

  if (stored.agentId !== id || stored.publicKey !== publicKey) {
    await save({ ...stored, agentId: id, publicKey });
  }

  return { id, publicKey, privateKey, fingerprint: crypto.fingerprint(publicKey) };
};

/**
 * Trust an agent's key the first time it is seen, and refuse a different one
 * afterwards -- what ssh does with a host key. The broker's ACL is what
 * stops anyone else from publishing under the agent's name; this is what
 * stops a replaced agent from quietly receiving the variables.
 *
 * @param {string} id - Agent name
 * @param {string} publicKey - base64 DER, as its status message carries it
 * @returns {Promise<KnownAgent>}
 */
const trustAgent = async (id: string, publicKey: string): Promise<KnownAgent> => {
  if (!publicKey) {
    throw new Error(`Agent "${id}" announced no public key: it is running an older version`);
  }

  const stored = await load();
  const agents = stored.agents || {};
  const known = agents[id];
  const fingerprint = crypto.fingerprint(publicKey);

  if (known && known.publicKey !== publicKey) {
    throw new Error(
      `The key of agent "${id}" has changed (was ${known.fingerprint}, now ${fingerprint}). ` +
      'If the agent was reinstalled on purpose, remove it from config/remote.json and run again'
    );
  }

  if (known) {
    return known;
  }

  const entry: KnownAgent = { publicKey, fingerprint, since: Date.now() };
  await save({ ...stored, agents: { ...agents, [id]: entry } });

  return entry;
};

export type { RemoteConfig, KnownAgent, BrokerSettings, AgentIdentity };
export { FILE, PASSWORD_KEY, PRIVATE_KEY_KEY, load, save, brokerSettings, agentIdentity, trustAgent };
