import fs from 'fs';
import path from 'path';

import * as packageJson from '../../../package.json';
import * as paths from '../paths';
import * as git from '../git';
import * as inputs from '../inputs';
import * as envTransfer from '../envTransfer';
import * as broker from './broker';
import * as bundle from './bundle';
import * as crypto from './crypto';
import * as topics from './topics';
import type { AgentIdentity } from './config';
import type { SealedBox } from './crypto';

/**
 * The agent: `lab34-flows --agent` on the machine that can reach the systems
 * under test.
 *
 * It sits on the broker under its own name, says whether it is free, and
 * runs the jobs it is sent with the very same code a local run uses --
 * flows.start for one flow, testRuns.startFolderRun for a view. What changes
 * is where the reporter's `emit` goes: instead of a Socket.IO server it
 * publishes to the job's events topic, and the person's side plays it back
 * into their own UI. When the run is over, the test-run folder it wrote is
 * packed and published as the job's result.
 *
 * One job at a time, like the runner itself. A second request while one is
 * running is rejected on its own events topic, so the sender hears about it.
 */

/** What a request carries. */
interface Job {
  id?: string;
  environment: string;
  /** Run one flow, by its path inside flows/ */
  flow?: { path: string };
  /** Run every flow a view matches */
  view?: { name?: string; folder?: string };
  /** The commit the flows should be run from: fetched and checked out first */
  ref?: string;
  /** The env files' values, sealed to this agent's key */
  env?: SealedBox;
}

/** What the status topic carries, retained. */
interface AgentStatus {
  online: boolean;
  agent: string;
  version?: string;
  publicKey?: string;
  fingerprint?: string;
  busy?: boolean;
  job?: string;
  at: number;
}

/** The job-level events the agent adds to the run's own. */
type JobStatus = 'accepted' | 'rejected' | 'preparing' | 'running' | 'finished' | 'failed';

interface JobEvent {
  id: string;
  status: JobStatus;
  message?: string;
  testRun?: string;
}

interface AgentOptions {
  identity: AgentIdentity;
  connection: broker.Connection;
}

/** The modules a job runs through; the tests hand in fakes. */
interface AgentDeps {
  flows: () => any;
  testRuns: () => any;
  git: typeof git;
  envTransfer: typeof envTransfer;
  inputs: typeof inputs;
}

// Required lazily: flows and testRuns sit above this helper in the import
// graph, and are only needed once a job arrives
const defaultDeps: AgentDeps = {
  flows: () => require('../flows'),
  testRuns: () => require('../testRuns'),
  git,
  envTransfer,
  inputs
};

const COMMIT = /^[0-9a-f]{7,40}$/i;

/**
 * Check the commit a job names out, so the flows that run are the ones the
 * sender is looking at.
 * @param {string} ref
 * @param {AgentDeps} deps
 */
const checkoutRef = async (ref: string, deps: AgentDeps) => {
  if (!COMMIT.test(ref)) {
    throw new Error(`"${ref}" is not a commit id`);
  }

  const context = await paths.contextRoot();

  if (!(await deps.git.info(context))) {
    throw new Error('The agent\'s context is not a git repository, but the job names a commit');
  }

  await deps.git.run(['fetch', '--all'], context);
  await deps.git.run(['checkout', '--detach', ref], context);
};

/**
 * Run as an agent until `stop` is called.
 *
 * @param {AgentOptions} options
 * @param {AgentDeps} [deps]
 * @returns {Promise<{stop: Function}>}
 */
const start = async ({ identity, connection }: AgentOptions, deps: AgentDeps = defaultDeps) => {
  const { id, publicKey, privateKey, fingerprint } = identity;
  const statusTopic = topics.status(id);

  let busy: { job: string } | null = null;

  const publishStatus = () => {
    const status: AgentStatus = {
      online: true,
      agent: id,
      version: packageJson.version,
      publicKey,
      fingerprint,
      busy: Boolean(busy),
      ...(busy ? { job: busy.job } : {}),
      at: Date.now()
    };
    return connection.publish(statusTopic, status, { retain: true });
  };

  const handle = async (job: Job, jobId: string) => {
    const eventsTopic = topics.job(id, jobId, 'events');

    const emit = (event: string, payload: unknown) =>
      connection.publish(eventsTopic, { event, payload })
        .catch(ex => console.error(`Could not publish ${event}:`, ex.message));

    const jobEvent = (status: JobStatus, extra: Partial<JobEvent> = {}) =>
      emit('remote:job', { id: jobId, status, ...extra } as JobEvent);

    if (busy) {
      console.warn(`Rejected job ${jobId}: busy with ${busy.job}`);
      await jobEvent('rejected', { message: `Agent "${id}" is busy with job ${busy.job}` });
      return;
    }

    busy = { job: jobId };
    await publishStatus();
    console.log(`Job ${jobId}: accepted`);

    try {
      if (!job.environment) {
        throw new Error('The job names no environment');
      }
      if (!job.flow && !job.view) {
        throw new Error('The job names neither a flow nor a view');
      }

      await jobEvent('accepted');

      if (job.ref) {
        await jobEvent('preparing', { message: `Checking out ${job.ref.slice(0, 12)}` });
        await checkoutRef(job.ref, deps);
      }

      if (job.env) {
        await jobEvent('preparing', { message: 'Importing the environment variables' });
        const document = crypto.open(privateKey, job.env);
        const imported = await deps.envTransfer.importDocument(document);
        console.log(`Job ${jobId}: ${imported.summary.files} env file(s) written`);
      }

      // The run tells us it is over the way it tells the UI: through the
      // summary it emits when the last flow is in
      let finish: (run: any) => void = () => {};
      const finished = new Promise<any>(resolve => { finish = resolve; });

      const io = {
        emit: (event: string, payload: any) => {
          void emit(event, payload);
          if (event === 'testrun:update' && payload && payload.run && payload.run.status !== 'running') {
            finish(payload.run);
          }
        }
      };

      await jobEvent('running');

      if (job.flow) {
        const flows = deps.flows();
        const { absolute, relative } = await flows.resolveWithinFlows(job.flow.path);

        if (!relative || !fs.existsSync(absolute)) {
          throw new Error(`Flow not found on the agent: ${job.flow.path}`);
        }

        await flows.start({
          value: fs.readFileSync(absolute, 'utf8'),
          environment: job.environment,
          path: relative.split(path.sep).join('/')
        }, { io });
      }
      else {
        await deps.testRuns().startFolderRun({
          folder: (job.view && job.view.folder) || '',
          view: job.view && job.view.name,
          environment: job.environment,
          io
        });
      }

      const run = await finished;
      const dir = path.join(await deps.testRuns().runsRoot(), run.id);

      await connection.publish(topics.job(id, jobId, 'result'), {
        id: jobId,
        testRun: run,
        bundle: bundle.pack(dir)
      });

      await jobEvent('finished', { testRun: run.id });
      console.log(`Job ${jobId}: ${run.status} (${run.id})`);
    }
    catch (ex) {
      console.error(`Job ${jobId}: failed: ${ex.message}`);
      await jobEvent('failed', { message: ex.message });
    }
    finally {
      busy = null;
      await publishStatus();
    }
  };

  const unsubscribeRequests = await connection.subscribe(topics.jobs(id, 'request'), (message) => {
    const parsed = topics.parse(message.topic);
    const job = broker.decode(message.payload);

    // A retained request would replay on every reconnect
    if (!parsed || !parsed.job || !job || message.retain) {
      return;
    }

    void handle(job, parsed.job);
  });

  const unsubscribeInputs = await connection.subscribe(topics.jobs(id, 'input'), (message) => {
    const body = broker.decode(message.payload);

    if (!body || !body.id) {
      return;
    }

    if (body.cancel) {
      deps.inputs.cancel(body.id, 'Input was cancelled');
    }
    else {
      deps.inputs.answer(body.id, String(body.value === undefined || body.value === null ? '' : body.value));
    }
  });

  connection.onClose(() => console.warn('Lost the broker: reconnecting'));
  // The will said "offline" while we were away; say otherwise now
  connection.onReconnect(() => { void publishStatus(); });

  await publishStatus();

  return {
    stop: async () => {
      await unsubscribeRequests();
      await unsubscribeInputs();
      const offline: AgentStatus = { online: false, agent: id, at: Date.now() };
      await connection.publish(statusTopic, offline, { retain: true });
      await connection.end();
    }
  };
};

/**
 * The last will an agent registers when it connects: what the broker says on
 * its behalf if it disappears.
 * @param {string} id
 * @returns {broker.Will}
 */
const will = (id: string): broker.Will => ({
  topic: topics.status(id),
  payload: { online: false, agent: id, at: Date.now() } as AgentStatus,
  retain: true
});

export type { AgentDeps, AgentOptions, AgentStatus, Job, JobEvent, JobStatus };
export { start, will, checkoutRef };
