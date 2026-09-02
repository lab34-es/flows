import fs from 'fs';
import path from 'path';

import * as env from '../env';
import * as broker from './broker';
import * as client from './client';
import * as remoteConfig from './config';
import * as topics from './topics';
import type { AgentStatus } from './agent';
import type { InputRequest } from '../inputs';

/**
 * The server's side of remote runs: what the web UI talks to.
 *
 * While the API is up, one connection to the broker listens to every agent's
 * retained status, so the UI can list who is there and whether they are free
 * -- pushed over the socket as `agents:update`, and answered by
 * GET /api/settings/remote/agents for a page that opened late. A run started
 * from the UI with an agent picked goes through client.run with the server's
 * Socket.IO as its `io`, so the flow page draws it exactly like a local run;
 * the one thing added here is turning "the agent started the run" into the
 * answer the page is waiting for, and holding the questions a remote step
 * asks until POST /api/flows/input answers them.
 */

interface KnownAgentStatus extends AgentStatus {
  /** When this status was received here */
  seenAt: number;
  /** Whether this machine has this agent's key on file, and it matches */
  trusted: boolean;
}

interface RelayDeps {
  connect: typeof broker.connect;
  run: typeof client.run;
  testRuns: () => any;
}

const defaultDeps: RelayDeps = {
  connect: broker.connect,
  run: client.run,
  testRuns: () => require('../testRuns')
};

/** How long a run gets to start on the agent before the UI is told it did not. */
const START_TIMEOUT_MS = 60000;

let deps: RelayDeps = defaultDeps;
let io: { emit: (...args: any[]) => void } | null = null;
let connection: broker.Connection | null = null;
let connectionError: string | null = null;
let starting: Promise<void> | null = null;

const agents = new Map<string, KnownAgentStatus>();

/** The questions remote steps are waiting an answer for, by request id. */
const pendingInputs = new Map<string, { request: InputRequest; resolve: (value: string | null) => void }>();

/**
 * Every agent seen, the online ones first.
 * @returns {KnownAgentStatus[]}
 */
const list = (): KnownAgentStatus[] =>
  [...agents.values()].sort((a, b) => {
    if (Boolean(a.online) !== Boolean(b.online)) { return a.online ? -1 : 1; }
    return a.agent.localeCompare(b.agent);
  });

const emitAgents = () => {
  if (io) {
    io.emit('agents:update', { agents: list() });
  }
};

const rememberStatus = async (message: broker.Message) => {
  const parsed = topics.parse(message.topic);
  const status = broker.decode(message.payload);

  if (!parsed || parsed.channel !== 'status' || !status) {
    return;
  }

  const stored = await remoteConfig.load();
  const known = stored.agents && stored.agents[parsed.agent];

  agents.set(parsed.agent, {
    ...status,
    agent: parsed.agent,
    seenAt: Date.now(),
    trusted: Boolean(known && status.publicKey && known.publicKey === status.publicKey)
  });

  emitAgents();
};

/**
 * Connect to the broker and start listening for agents. Nothing happens --
 * and nothing fails -- when no broker is configured: the feature is simply
 * not on.
 *
 * @param {Object} server - The Socket.IO server
 * @param {RelayDeps} [overrides] - For the tests
 */
const start = async (server: { emit: (...args: any[]) => void }, overrides?: Partial<RelayDeps>) => {
  io = server;
  deps = { ...defaultDeps, ...(overrides || {}) };

  await stop();

  const attempt = (async () => {
    const stored = await remoteConfig.load();
    if (!stored.broker || !stored.broker.url) {
      return;
    }

    let settings;
    try {
      settings = await remoteConfig.brokerSettings();
      const suffix = Math.random().toString(36).slice(2, 8);
      const username = (settings.username || 'user').replace(/[^A-Za-z0-9_-]/g, '');

      connection = await deps.connect(remoteConfig.connectOptions(settings, {
        clientId: `flows-ui-${username}-${suffix}`
      }));
      connectionError = null;

      connection.onClose(() => console.warn('Lost the broker: reconnecting'));
      await connection.subscribe(topics.allStatus(), (message) => { void rememberStatus(message); });
      console.log(`Listening for agents on ${settings.url}`);
    }
    catch (ex) {
      connectionError = ex.message;
      connection = null;
      console.error(`Remote agents are not available: ${ex.message}`);
    }
  })();

  starting = attempt;
  await attempt;
  starting = null;
};

/** Hang up, forget the agents. */
const stop = async () => {
  if (starting) { await starting.catch(() => {}); }

  const current = connection;
  connection = null;
  agents.clear();

  if (current) {
    await Promise.resolve(current.end()).catch(() => {});
  }
};

/** The settings changed: connect again with the new ones. */
const reconfigure = async () => {
  if (io) {
    await start(io, deps);
    emitAgents();
  }
};

/**
 * What the Settings screen shows. The password never leaves the server.
 * @returns {Promise<Object>}
 */
const getSettings = async () => {
  const stored = await remoteConfig.load();
  const password = await env.read(remoteConfig.PASSWORD_KEY);

  const brokerStored = stored.broker || {};

  return {
    broker: {
      url: brokerStored.url || '',
      username: brokerStored.username || '',
      provider: brokerStored.provider || 'generic',
      tls: {
        cert: (brokerStored.tls && brokerStored.tls.cert) || '',
        key: (brokerStored.tls && brokerStored.tls.key) || '',
        ca: (brokerStored.tls && brokerStored.tls.ca) || ''
      },
      maxPacketSize: brokerStored.maxPacketSize || null
    },
    providers: remoteConfig.PROVIDERS,
    hasPassword: Boolean(password),
    configured: Boolean(stored.broker && stored.broker.url),
    connected: Boolean(connection),
    error: connectionError,
    configFile: `config/${remoteConfig.FILE}.json`,
    envFile: env.FILE,
    passwordEnvKey: remoteConfig.PASSWORD_KEY,
    agents: list()
  };
};

/**
 * Store the broker settings and connect with them.
 *
 * @param {Object} body - { url, username, password, provider, cert, key, ca,
 *   maxPacketSize }: password undefined keeps the stored one, null clears it;
 *   an empty cert, key or ca clears that path
 * @returns {Promise<Object>} What getSettings returns
 */
const saveSettings = async (body) => {
  const input = (body && typeof body === 'object') ? body : {};
  const stored = await remoteConfig.load();
  const brokerStored = stored.broker || {};

  const url = input.url === undefined ? (brokerStored.url || '') : String(input.url || '').trim();
  const username = input.username === undefined
    ? (brokerStored.username || '')
    : String(input.username || '').trim();
  const provider = remoteConfig.cleanProvider(input.provider) || brokerStored.provider || 'generic';
  const tls = remoteConfig.cleanTls({ cert: input.cert, key: input.key, ca: input.ca }, brokerStored.tls);

  if (url && !/^(mqtts?|wss?):\/\//.test(url)) {
    throw new Error('The broker URL must start with mqtt://, mqtts://, ws:// or wss://');
  }

  let maxPacketSize = brokerStored.maxPacketSize;
  if (input.maxPacketSize !== undefined) {
    const value = Number(input.maxPacketSize);
    if (input.maxPacketSize === null || input.maxPacketSize === '') {
      maxPacketSize = undefined;
    }
    else if (!Number.isInteger(value) || value < 1024) {
      throw new Error('The packet limit must be a whole number of bytes, at least 1024');
    }
    else {
      maxPacketSize = value;
    }
  }

  const next = { ...stored };
  if (url) {
    next.broker = {
      url,
      ...(username ? { username } : {}),
      ...(provider !== 'generic' ? { provider } : {}),
      ...(tls ? { tls } : {}),
      ...(maxPacketSize ? { maxPacketSize } : {})
    };
  }
  else {
    delete next.broker;
  }
  await remoteConfig.save(next);

  if (input.password !== undefined) {
    await env.write(remoteConfig.PASSWORD_KEY, input.password === null ? null : String(input.password));
  }

  await reconfigure();

  return getSettings();
};

/**
 * Connect once with the stored settings, and hang up. What the Test button
 * does.
 * @returns {Promise<{message: string}>}
 */
const test = async () => {
  const settings = await remoteConfig.brokerSettings();
  const probe = await deps.connect(remoteConfig.connectOptions(settings, {
    clientId: `flows-ui-test-${Math.random().toString(36).slice(2, 8)}`
  }));

  // The ACL has to let this side see the agents, or nothing else will work
  await probe.subscribe(topics.allStatus(), () => {});
  await probe.end();

  return {
    message: `Connected to ${settings.url}${settings.username ? ` as ${settings.username}` : ''}. ` +
      `${agents.size} agent${agents.size === 1 ? '' : 's'} seen so far.`
  };
};

/**
 * Forget an agent's stored key, so the next run trusts whatever key it
 * announces -- what to do after reinstalling one.
 * @param {string} id
 */
const forgetAgent = async (id: string) => {
  const stored = await remoteConfig.load();
  const remaining = { ...(stored.agents || {}) };
  delete remaining[id];
  await remoteConfig.save({ ...stored, agents: remaining });

  const current = agents.get(id);
  if (current) {
    agents.set(id, { ...current, trusted: false });
    emitAgents();
  }
};

/** A remote step is waiting: hold the question until the UI answers it. */
const holdInput = (request: InputRequest): Promise<string | null> =>
  new Promise(resolve => {
    pendingInputs.set(request.id, { request, resolve });
  });

/**
 * Answer, or give up on, a question a remote step asked.
 * @param {string} id - The request id
 * @param {string} [value]
 * @param {boolean} [cancel]
 * @returns {boolean} false when no remote step is waiting under that id
 */
const answerInput = (id: string, value?: string, cancel = false): boolean => {
  const pending = pendingInputs.get(id);
  if (!pending) { return false; }
  pendingInputs.delete(id);
  pending.resolve(cancel ? null : String(value === undefined || value === null ? '' : value));
  return true;
};

/** The questions remote steps are waiting for, for a UI that opened late. */
const listInputs = (): InputRequest[] => [...pendingInputs.values()].map(entry => entry.request);

const settleInputs = () => {
  for (const [id, pending] of pendingInputs.entries()) {
    pendingInputs.delete(id);
    pending.resolve(null);
  }
};

/**
 * Run one flow on an agent, for the flow page. Resolves the way flows.start
 * does -- with the execution the page will follow over the socket -- as soon
 * as the agent has started it, and rejects when it could not.
 *
 * @param {Object} options - { agent, environment, path }
 * @returns {Promise<{execution: Object}>}
 */
const startFlow = ({ agent, environment, path: flowPath }: { agent: string; environment: string; path: string }) =>
  new Promise<{ execution: any }>((resolve, reject) => {
    if (!io) {
      return reject(new Error('The server is not ready to run on agents yet'));
    }

    let execution: any = null;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Agent "${agent}" did not start the flow within ${START_TIMEOUT_MS / 1000} seconds`));
      }
    }, START_TIMEOUT_MS);

    const onEvent = (event: string, payload: any) => {
      if (event === 'flowexecution:update' && payload && payload.topic === 'execution' && payload.data) {
        execution = payload.data;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ execution });
        }
      }
    };

    deps.run({ agent, environment, file: flowPath, io: io!, onEvent, onInput: holdInput })
      .then(result => {
        console.log(`Remote run on ${agent}: ${result.testRun.status} (${result.testRun.id})`);
        result.warnings.forEach(warning => console.warn(`Remote run on ${agent}: ${warning}`));
      })
      .catch(ex => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          return reject(ex);
        }

        // The page is following an execution that will never end on its own
        if (execution && execution.status === 'running' && io) {
          io.emit('flowexecution:update', {
            id: execution.id,
            topic: 'execution',
            data: { ...execution, status: 'error', error: { message: ex.message } }
          });
        }
        console.error(`Remote run on ${agent} failed: ${ex.message}`);
      })
      .finally(settleInputs);
  });

/**
 * Run a view on an agent, for "Run all". The run's summary is written into
 * this context's test-runs as the agent reports it, so the test run page can
 * open it while it is still running there.
 *
 * @param {Object} options - { agent, environment, folder, view, files }
 * @returns {Promise<Object>} The run's summary, once the agent created it
 */
const startFolderRun = ({ agent, environment, folder, view, files }: {
  agent: string; environment: string; folder?: string; view?: string; files?: string[];
}) =>
  new Promise<any>((resolve, reject) => {
    if (!io) {
      return reject(new Error('The server is not ready to run on agents yet'));
    }

    let summary: any = null;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Agent "${agent}" did not start the run within ${START_TIMEOUT_MS / 1000} seconds`));
      }
    }, START_TIMEOUT_MS);

    const writeSummary = async (run: any) => {
      const dir = path.join(await deps.testRuns().runsRoot(), String(run.id));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run, null, 2), 'utf8');
    };

    const onEvent = (event: string, payload: any) => {
      if (event === 'testrun:update' && payload && payload.run && payload.run.id) {
        summary = payload.run;
        writeSummary(summary).catch(ex => console.error('Could not record the remote run:', ex.message));
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(summary);
        }
      }
    };

    deps.run({ agent, environment, view: view || '', folder, files, io: io!, onEvent, onInput: holdInput })
      .then(result => {
        console.log(`Remote run on ${agent}: ${result.testRun.status} (${result.testRun.id})`);
        result.warnings.forEach(warning => console.warn(`Remote run on ${agent}: ${warning}`));
      })
      .catch(ex => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          return reject(ex);
        }

        if (summary && summary.status === 'running' && io) {
          const failed = {
            ...summary,
            status: 'failed',
            times: { ...summary.times, end: Date.now() },
            flows: (summary.flows || []).map(flow => (
              flow.status === 'pending' || flow.status === 'running'
                ? { ...flow, status: 'failed', error: ex.message }
                : flow
            ))
          };
          writeSummary(failed).catch(() => {});
          io.emit('testrun:update', { id: failed.id, run: failed });
        }
        console.error(`Remote run on ${agent} failed: ${ex.message}`);
      })
      .finally(settleInputs);
  });

export type { KnownAgentStatus, RelayDeps };
export {
  start, stop, reconfigure, list, getSettings, saveSettings, test, forgetAgent,
  startFlow, startFolderRun, answerInput, listInputs
};
