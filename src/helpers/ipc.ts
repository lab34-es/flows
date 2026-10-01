import path from 'path';

import * as packageJson from '../../package.json';
import * as paths from './paths';
import * as inputs from './inputs';
import type { TestRun, TestRunSummary } from './testRuns';

/**
 * A run reported to the program that started it.
 *
 * `ronsel --ipc` is how an editor runs flows. It starts the CLI as a child
 * process with an IPC channel -- `child_process.fork`, or `spawn` with an
 * "ipc" stdio entry -- and rather than reading what is printed on the
 * terminal, which is still printed and is what the editor shows as the run's
 * output, it listens to the events the web UI draws from: every step as it
 * starts and as it ends, the test run as it is recorded. A step that asks the
 * person running the flow for a value asks the editor, and the answer comes
 * back over the same channel.
 *
 * It is the agent's arrangement (helpers/remote/agent) with a pipe where the
 * agent has a broker. The flows run through the functions a "Run all" from
 * the UI goes through -- prepared, recorded as one test run, executed one at a
 * time -- and only where `emit` goes is different.
 *
 * The protocol is versioned, so an editor can tell a CLI that speaks it from
 * one too old to, which says nothing at all:
 *
 *   CLI -> editor
 *     { type: 'hello', protocol, version, context }   first, always
 *     { type: 'event', event, payload }                'flowexecution:update' and
 *                                                      'testrun:update', as the UI gets them
 *     { type: 'error', message }                       the run could not start
 *     { type: 'done', run }                            the run is over and recorded
 *
 *   editor -> CLI
 *     { type: 'input', id, value }                     answer what a step asked
 *     { type: 'input', id, cancel: true }              ... or refuse to, failing the step
 *     { type: 'cancel', reason? }                      stop the run
 */

/** Bumped when a message changes shape, never when one is added. */
export const PROTOCOL = 1;

/** What the CLI tells the editor. */
export type Outgoing =
  | { type: 'hello'; protocol: number; version: string; context: string }
  | { type: 'event'; event: string; payload: unknown }
  | { type: 'error'; message: string }
  | { type: 'done'; run: TestRunSummary };

/** What the editor tells the CLI. */
export type Incoming =
  | { type: 'input'; id: string; value?: string; cancel?: boolean }
  | { type: 'cancel'; reason?: string };

/** This process's end of the channel. */
export interface Channel {
  /** Resolves once the message is on its way, whatever became of it */
  send: (message: Outgoing) => Promise<void>;
  onMessage: (listener: (message: Incoming) => void) => void;
  onDisconnect: (listener: () => void) => void;
}

/** What `process` has when it was started with an IPC channel. */
interface IpcProcess {
  // Node declares several overloads; the one used here is (message, callback)
  send?: (...args: any[]) => boolean;
  connected?: boolean;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
}

/**
 * The channel this process was started with, or null when it has none: a
 * person who typed `--ipc` at a terminal has nobody to report to.
 * @param {IpcProcess} [proc]
 * @returns {Channel|null}
 */
export const channel = (proc: IpcProcess = process): Channel | null => {
  if (typeof proc.send !== 'function' || proc.connected === false) {
    return null;
  }

  const send = proc.send.bind(proc);

  return {
    send: (message) => new Promise<void>(resolve => {
      try {
        // The callback is the only way to know the message left: exiting
        // before it fires can lose the last of them. An editor that went
        // away is not a reason to fail, so the error is not looked at
        send(message, () => resolve());
      }
      catch {
        resolve();
      }
    }),
    onMessage: (listener) => { proc.on('message', listener); },
    onDisconnect: (listener) => { proc.on('disconnect', listener); }
  };
};

/**
 * A payload as JSON carries it, which is how the channel sends it: functions
 * dropped, and a reference back to an object it is inside of cut, rather than
 * the whole message refused. The events hold the executed flow, which holds
 * whatever the steps and the latent applications put in it.
 * @param {*} value
 * @returns {*}
 */
export const plain = (value: unknown): unknown => {
  if (value === undefined) { return undefined; }

  const ancestors: unknown[] = [];

  try {
    const text = JSON.stringify(value, function (this: unknown, _key, item) {
      if (typeof item === 'bigint') { return item.toString(); }
      if (typeof item !== 'object' || item === null) { return item; }

      // `this` is the object holding `item`: whatever was deeper than it
      // was a sibling's, and is no longer an ancestor
      while (ancestors.length && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop();
      }

      if (ancestors.includes(item)) { return '[Circular]'; }

      ancestors.push(item);
      return item;
    });

    return text === undefined ? null : JSON.parse(text);
  }
  catch {
    return null;
  }
};

/** What to run. */
export interface IpcRunOptions {
  /** Flow files, relative to the context, as --file takes them */
  files: string[];
  /** A view of views.yaml, when no file is named. '' means the first one */
  view?: string | null;
  /** Folder of the flows tree the view is scoped to */
  folder?: string;
  environment?: string | null;
}

/** The modules a run goes through; the tests hand in fakes. */
export interface IpcDeps {
  testRuns: () => any;
  applications: () => any;
  bases: () => any;
  inputs: Pick<typeof inputs, 'answer' | 'cancel' | 'cancelAll'>;
  exit: (code: number) => void;
}

// Required lazily: testRuns, applications and bases all sit above this
// helper in the import graph, and only a run needs them
const defaultDeps: IpcDeps = {
  testRuns: () => require('./testRuns'),
  applications: () => require('./applications'),
  bases: () => require('./bases'),
  inputs,
  exit: (code) => process.exit(code)
};

/** The exit code of a run that was stopped: 128 + SIGINT, as a shell has it. */
export const CANCELLED = 130;

/**
 * The flows named, relative to the flows directory as a run records them.
 * They are given relative to the context, the way --file takes them.
 * @param {string[]} files
 * @returns {Promise<string[]>}
 */
const flowsRelative = async (files: string[]): Promise<string[]> => {
  const context = await paths.contextRoot();
  const flowsDir = await paths.contextDir(['flows']);

  return files.map(file => path.relative(flowsDir, path.resolve(context, file)).split(path.sep).join('/'));
};

/**
 * Run the flows, reporting over the channel, and say how it went.
 *
 * Resolves with the exit code the process should end with: 0 when every
 * flow passed, 1 otherwise -- a run that could not start included. A run
 * that is cancelled, or whose editor goes away, never resolves: the process
 * is ended from here, once what it leaves behind on disk says so.
 *
 * @param {IpcRunOptions} options
 * @param {Channel} link
 * @param {IpcDeps} [deps]
 * @returns {Promise<number>}
 */
export const run = async (options: IpcRunOptions, link: Channel, deps: IpcDeps = defaultDeps): Promise<number> => {
  let current: TestRun | null = null;
  let contents: Record<string, string> = {};
  let stopped = false;

  const stop = (reason: string) => {
    if (stopped) { return; }
    stopped = true;

    // Nothing may be left waiting on a question nobody will answer
    deps.inputs.cancelAll(reason);

    if (current) {
      try {
        deps.testRuns().abandon(current, reason, contents);
      }
      catch (ex) {
        console.error('Could not record the cancelled run:', ex);
      }
    }

    deps.exit(CANCELLED);
  };

  link.onMessage(message => {
    if (!message || typeof message !== 'object') { return; }

    if (message.type === 'input' && message.id) {
      if (message.cancel) {
        deps.inputs.cancel(message.id, 'Input was cancelled');
      }
      else {
        deps.inputs.answer(message.id, String(message.value ?? ''));
      }
      return;
    }

    if (message.type === 'cancel') {
      stop(message.reason || 'The run was cancelled');
    }
  });

  // The editor that started the run is the only one watching it
  link.onDisconnect(() => stop('The program that started the run went away'));

  await link.send({
    type: 'hello',
    protocol: PROTOCOL,
    version: packageJson.version,
    context: await paths.contextRoot()
  });

  const refuse = async (message: string) => {
    await link.send({ type: 'error', message });
    return 1;
  };

  const { environment } = options;
  const files = (options.files || []).filter(Boolean);
  const byView = !files.length && options.view !== null && options.view !== undefined;

  if (!environment) {
    return refuse('No environment specified. Use --env <environment>');
  }

  if (!files.length && !byView) {
    return refuse('Name what to run: --file <path-to-flow-file>, as many as needed, or --view <view>');
  }

  const io = {
    emit: (event: string, payload: unknown) => {
      void link.send({ type: 'event', event, payload: plain(payload) });
    }
  };

  try {
    const testRuns = deps.testRuns();

    let view: string | undefined;
    if (byView) {
      const bases = deps.bases();
      const document = await bases.load();
      const target = bases.findView(document.views, options.view);

      if (!target) {
        return refuse(
          `View not found: ${options.view}. ${document.views.length} available: ` +
          document.views.map(candidate => candidate.slug).join(', ')
        );
      }
      view = target.name;
    }

    const prepared = await testRuns.prepareFolderRun({
      files: byView ? undefined : await flowsRelative(files),
      folder: byView ? options.folder || '' : '',
      view,
      environment
    });

    await deps.applications().loadAll();

    contents = Object.fromEntries(prepared.targets.map(target => [target.file, target.content]));

    current = await testRuns.create({
      trigger: 'cli',
      environment,
      ...(byView ? { folder: options.folder || '' } : {}),
      view: prepared.view,
      flows: prepared.targets,
      io
    });

    await testRuns.executeFolderRun(current, prepared.targets, { environment });
  }
  catch (ex) {
    return refuse((ex && ex.message) || String(ex));
  }

  const summary = (current as TestRun).summary;
  await link.send({ type: 'done', run: summary });

  return summary.status === 'passed' ? 0 : 1;
};

/**
 * Wait for what was written to the terminal streams to leave: exiting with
 * output still queued on a pipe loses its tail, and the tail of a run is
 * where its failures are.
 * @param {Array<NodeJS.WritableStream>} [streams]
 * @returns {Promise<void>}
 */
export const flush = (streams: NodeJS.WritableStream[] = [process.stdout, process.stderr]) =>
  Promise.all(streams.map(stream => new Promise<void>(resolve => {
    try {
      stream.write('', () => resolve());
    }
    catch {
      resolve();
    }
  }))).then(() => undefined);
