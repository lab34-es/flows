import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import * as paths from '../paths';
import * as git from '../git';
import * as applications from '../applications';
import * as envTransfer from '../envTransfer';
import * as markdownFlows from '../markdownFlows';
import * as broker from './broker';
import * as bundle from './bundle';
import * as crypto from './crypto';
import * as remoteConfig from './config';
import * as topics from './topics';
import type { AgentStatus, Job, JobEvent } from './agent';
import type { InputRequest } from '../inputs';

/**
 * The person's side of a remote run: what the CLI (and later the UI) calls
 * instead of the runner when a flow should run on an agent.
 *
 * It gathers what the agent needs -- the commit to check out, the values of
 * the env files the flow uses, sealed to the agent's key -- sends the job,
 * and then plays the agent's events back to whoever is listening: the
 * terminal, or the local Socket.IO server so the UI shows the run as if it
 * were here. When the result arrives, the test-run folder is written into
 * this context's test-runs, where everything else already looks for it.
 */

interface RunOptions {
  agent: string;
  environment: string;
  /** Path of one flow inside flows/ */
  file?: string;
  /** Name (or slug) of a view; '' means the first one */
  view?: string;
  folder?: string;
  /** The flows to run instead of evaluating the view, as the folder page lists them */
  files?: string[];
  /** The local Socket.IO server, to show the run in the UI */
  io?: { emit: (...args: any[]) => void };
  /** Every event, as it arrives */
  onEvent?: (event: string, payload: any) => void;
  /** A step is asking for a value: resolve with it, or with null to cancel */
  onInput?: (request: InputRequest) => Promise<string | null>;
  /** Give up on the agent after this long without a result; none by default */
  timeoutMs?: number;
}

interface RunResult {
  /** The job id */
  id: string;
  /** The run's summary, as run.json carries it */
  testRun: any;
  /** Where the run was written locally */
  dir: string;
  /** Things worth knowing that did not stop the run */
  warnings: string[];
}

interface ClientDeps {
  connect: typeof broker.connect;
  testRuns: () => any;
  flows: () => any;
  /** How long to wait for an agent's retained status before giving up on it */
  statusWaitMs?: number;
}

const defaultDeps: ClientDeps = {
  connect: broker.connect,
  testRuns: () => require('../testRuns'),
  flows: () => require('../flows'),
  statusWaitMs: 5000
};

/**
 * The commit the agent should run, and what would not make it there.
 */
const commitOf = async (warnings: string[]) => {
  const context = await paths.contextRoot();
  const info = await git.info(context);

  if (!info) {
    warnings.push('The context is not a git repository: the agent runs whatever copy of the flows it has');
    return undefined;
  }

  const ref = await git.run(['rev-parse', 'HEAD'], context).catch(() => null);

  if (!ref) {
    warnings.push('The context has no commits yet: the agent runs whatever copy of the flows it has');
    return undefined;
  }

  if (info.changes.length) {
    warnings.push(`${info.changes.length} uncommitted change(s) in the context will not run on the agent`);
  }

  if (info.ahead) {
    warnings.push(`${info.ahead} commit(s) not pushed: the agent cannot fetch ${ref.slice(0, 12)} until they are`);
  }

  return ref;
};

/**
 * The steps the job will run, read locally, so the right env files travel.
 */
const stepsOf = async (options: RunOptions, deps: ClientDeps) => {
  if (options.file) {
    const { absolute, relative } = await deps.flows().resolveWithinFlows(options.file);

    if (!relative || !fs.existsSync(absolute)) {
      throw new Error(`Flow not found: ${options.file}`);
    }

    return markdownFlows.parse(fs.readFileSync(absolute, 'utf8')).steps || [];
  }

  const { targets } = await deps.testRuns().prepareFolderRun({
    files: options.files,
    folder: options.folder || '',
    view: options.view,
    environment: options.environment
  });

  return targets.flatMap(target => markdownFlows.parse(target.content).steps || []);
};

/**
 * The env files' values the job needs, as the YAML the import understands --
 * or nothing, when the flow uses no application that has any.
 */
const environmentDocument = async (steps, environment: string, warnings: string[]) => {
  const selection = applications.applicationsOf(steps).map(application => ({ application, environment }));

  if (!selection.length) {
    return undefined;
  }

  try {
    return (await envTransfer.exportSelection(selection)).yaml;
  }
  catch (ex) {
    warnings.push(`No environment variables sent: ${ex.message}`);
    return undefined;
  }
};

/**
 * Run a flow, or a view, on an agent.
 *
 * @param {RunOptions} options
 * @param {ClientDeps} [deps]
 * @returns {Promise<RunResult>}
 */
const run = async (options: RunOptions, deps: ClientDeps = defaultDeps): Promise<RunResult> => {
  const { agent, environment } = options;

  if (!agent) {
    throw new Error('No agent named');
  }
  if (!environment) {
    throw new Error('No environment specified');
  }
  if (!options.file && options.view === undefined) {
    throw new Error('Name a flow (--file) or a view (--view) to run');
  }

  topics.assertName(agent, 'Agent name');

  const warnings: string[] = [];
  const settings = await remoteConfig.brokerSettings();

  // Everything that can fail locally fails before the broker is touched
  const ref = await commitOf(warnings);
  const steps = await stepsOf(options, deps);
  const document = await environmentDocument(steps, environment, warnings);

  const connection = await deps.connect(remoteConfig.connectOptions(settings, {
    clientId: `flows-${(settings.username || 'user').replace(/[^A-Za-z0-9_-]/g, '')}-${randomUUID().slice(0, 8)}`
  }));

  const jobId = randomUUID();

  try {
    // The agent's retained status says whether it is there, and carries the
    // key the variables are sealed to
    const status = await new Promise<AgentStatus>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent "${agent}" has never connected to this broker`));
      }, deps.statusWaitMs || 5000);

      connection.subscribe(topics.status(agent), (message) => {
        const body = broker.decode(message.payload);
        if (body) {
          clearTimeout(timer);
          resolve(body);
        }
      }).catch(ex => { clearTimeout(timer); reject(ex); });
    });

    if (!status.online) {
      throw new Error(`Agent "${agent}" is offline (last seen ${new Date(status.at).toISOString()})`);
    }

    if (status.busy) {
      throw new Error(`Agent "${agent}" is busy with job ${status.job}. Try again when it is free`);
    }

    const known = await remoteConfig.trustAgent(agent, status.publicKey || '');

    const job: Job = {
      id: jobId,
      environment,
      ...(options.file
        ? { flow: { path: options.file } }
        : { view: { name: options.view, folder: options.folder || '', ...(options.files ? { files: options.files } : {}) } }),
      ...(ref ? { ref } : {}),
      ...(document ? { env: crypto.seal(known.publicKey, document) } : {})
    };

    const outcome = new Promise<RunResult>((resolve, reject) => {
      const timer = options.timeoutMs
        ? setTimeout(() => reject(new Error(`No result from agent "${agent}" after ${options.timeoutMs} ms`)), options.timeoutMs)
        : null;

      const done = (finish: () => void) => {
        if (timer) { clearTimeout(timer); }
        finish();
      };

      const subscriptions = [
        connection.subscribe(topics.job(agent, jobId, 'events'), (message) => {
          const body = broker.decode(message.payload);
          if (!body || !body.event) { return; }

          const { event, payload } = body;

          if (options.onEvent) { options.onEvent(event, payload); }
          if (options.io) { options.io.emit(event, payload); }

          if (event === 'remote:job') {
            const jobEvent = payload as JobEvent;
            if (jobEvent.status === 'rejected' || jobEvent.status === 'failed') {
              done(() => reject(new Error(jobEvent.message || `The agent ${jobEvent.status} the job`)));
            }
          }

          const input = event === 'flowexecution:update' && payload && payload.topic === 'input' ? payload.data : null;
          if (input && input.status === 'pending' && options.onInput) {
            options.onInput(input)
              .then(value => connection.publish(
                topics.job(agent, jobId, 'input'),
                value === null ? { id: input.id, cancel: true } : { id: input.id, value }
              ))
              .catch(ex => console.error('Could not answer the input:', ex.message));
          }
        }),

        connection.subscribe(topics.job(agent, jobId, 'result'), (message) => {
          const body = broker.decode(message.payload);
          if (!body || !body.testRun || !body.bundle) { return; }

          Promise.resolve()
            .then(async () => {
              const dir = path.join(await deps.testRuns().runsRoot(), String(body.testRun.id));
              bundle.unpack(body.bundle, dir);
              return { id: jobId, testRun: body.testRun, dir, warnings };
            })
            .then(result => done(() => resolve(result)))
            .catch(ex => done(() => reject(ex)));
        }),

        connection.subscribe(topics.status(agent), (message) => {
          const body = broker.decode(message.payload);
          if (body && body.online === false && !message.retain) {
            done(() => reject(new Error(`Agent "${agent}" went offline during the run`)));
          }
        })
      ];

      Promise.all(subscriptions)
        .then(() => connection.publish(topics.job(agent, jobId, 'request'), job))
        .catch(ex => done(() => reject(ex)));
    });

    return await outcome;
  }
  finally {
    await connection.end().catch(() => {});
  }
};

export type { ClientDeps, RunOptions, RunResult };
export { run };
