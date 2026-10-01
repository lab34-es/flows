import { spawn as nodeSpawn } from 'child_process';
import type { ChildProcess, SpawnOptions } from 'child_process';

/**
 * A run of the ronsel CLI, driven the way the CLI's `--ipc` mode expects.
 *
 * Each run is a process of its own: the applications' code is loaded fresh
 * every time, so an edit to one is picked up by the next run without
 * restarting anything, and stopping a run is stopping a process. What the run
 * prints is passed on as it comes, for the editor to show; what it means --
 * every step starting and ending, the test run being recorded -- arrives as
 * messages on the IPC channel (src/helpers/ipc.ts in the package).
 */

/** The protocol this extension speaks: the one in the package's helpers/ipc. */
export const PROTOCOL = 1;

/** What the CLI says first. */
export interface Hello {
  protocol: number;
  version: string;
  context: string;
}

/** What to run. */
export interface LaunchOptions {
  /** The node executable */
  node: string;
  /** ronsel's CLI script */
  script: string;
  /** The context folder */
  context: string;
  environment: string;
  /** Flow files, relative to the context, as --file takes them */
  files?: string[];
  /** A view to run instead, by name */
  view?: string;
  folder?: string;
  /** Start paused, with the inspector open, for a debugger to attach */
  inspect?: boolean;
  /** Added to this process's environment */
  env?: Record<string, string>;
  /** How long a cancelled run gets before it is killed; GRACE_MS when not said */
  graceMs?: number;
}

/** What the run says, as it says it. */
export interface Listener {
  hello?: (hello: Hello) => void;
  /** An event of the run: 'flowexecution:update' or 'testrun:update' */
  event: (event: string, payload: any) => void;
  /** What the run printed, stdout and stderr as they come */
  output: (text: string) => void;
  /** The inspector is listening, on this port */
  inspector?: (port: number) => void;
}

/** How a run ended. */
export interface Outcome {
  code: number | null;
  signal: string | null;
  /** null: the CLI never answered -- too old for --ipc, or it never started */
  hello: Hello | null;
  /** Why it could not start, as the CLI said it, or why it could not be started */
  error: string | null;
  /** The recorded test run, when it finished */
  run: any | null;
  /** It was stopped on request */
  cancelled: boolean;
}

/** A run under way. */
export interface Running {
  done: Promise<Outcome>;
  /** Answer what a step asked */
  answer: (id: string, value: string) => void;
  /** Refuse to, which fails the step */
  refuse: (id: string) => void;
  /** Stop the run: asked first, so it can record why, then ended */
  cancel: (reason?: string) => void;
}

/** How long a cancelled run gets to close its test run before it is killed. */
export const GRACE_MS = 5000;

/**
 * The arguments of the CLI for a run.
 * @param {LaunchOptions} options
 * @returns {string[]}
 */
export const argumentsFor = (options: LaunchOptions): string[] => {
  const what = options.view !== undefined
    ? ['--view', options.view, ...(options.folder ? ['--folder', options.folder] : [])]
    : (options.files || []).flatMap(file => ['--file', file]);

  return [
    // 0 is a free port, chosen by node and printed on stderr
    ...(options.inspect ? ['--inspect-brk=127.0.0.1:0'] : []),
    options.script,
    '--context', options.context,
    '--ipc',
    '--env', options.environment,
    ...what
  ];
};

/** The port of the inspector, out of what node prints when it opens it. */
export const inspectorPort = (text: string): number | null => {
  const match = text.match(/Debugger listening on wss?:\/\/[^\s/]+:(\d+)\//);
  return match ? Number(match[1]) : null;
};

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/**
 * Start a run.
 * @param {LaunchOptions} options
 * @param {Listener} listener
 * @param {Spawn} [spawn]
 * @returns {Running}
 */
export const launch = (options: LaunchOptions, listener: Listener, spawn: Spawn = nodeSpawn): Running => {
  const outcome: Outcome = { code: null, signal: null, hello: null, error: null, run: null, cancelled: false };
  const timers: NodeJS.Timeout[] = [];

  let child: ChildProcess;
  let settle: (outcome: Outcome) => void = () => {};
  const done = new Promise<Outcome>(resolve => { settle = resolve; });
  let settled = false;

  const finish = () => {
    if (settled) { return; }
    settled = true;
    timers.forEach(timer => clearTimeout(timer));
    settle(outcome);
  };

  const send = (message: unknown) => {
    if (child && child.connected) {
      try {
        child.send(message as any);
      }
      catch {
        // The run ended under us: there is nobody left to tell
      }
    }
  };

  try {
    child = spawn(options.node, argumentsFor(options), {
      cwd: options.context,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
      env: {
        ...process.env,
        // The output lands in a terminal: keep the colours the CLI prints
        FORCE_COLOR: '1',
        ...options.env
      }
    });
  }
  catch (ex) {
    outcome.error = `Could not start ${options.node}: ${(ex as Error).message}`;
    finish();
    return { done, answer: () => {}, refuse: () => {}, cancel: () => {} };
  }

  let stderr = '';
  let inspecting = false;

  const onOutput = (stream: NodeJS.ReadableStream | null, isError: boolean) => {
    if (!stream) { return; }
    stream.setEncoding('utf8');
    stream.on('data', (text: string) => {
      if (isError && options.inspect && !inspecting) {
        stderr += text;
        const port = inspectorPort(stderr);
        if (port) {
          inspecting = true;
          if (listener.inspector) { listener.inspector(port); }
        }
      }
      listener.output(text);
    });
  };

  onOutput(child.stdout, false);
  onOutput(child.stderr, true);

  child.on('message', (message: any) => {
    if (!message || typeof message !== 'object') { return; }

    switch (message.type) {
      case 'hello':
        outcome.hello = { protocol: message.protocol, version: message.version, context: message.context };
        if (listener.hello) { listener.hello(outcome.hello); }
        break;
      case 'event':
        listener.event(message.event, message.payload);
        break;
      case 'error':
        outcome.error = String(message.message || 'The run could not start');
        break;
      case 'done':
        outcome.run = message.run || null;
        break;
      default:
        break;
    }
  });

  child.on('error', (error: Error) => {
    // Raised when the process could not be started at all -- node is not
    // where it was looked for -- and then nothing else is
    if (child.pid === undefined) {
      outcome.error = `Could not start ${options.node}: ${error.message}`;
      finish();
    }
  });

  // 'close', not 'exit': by then everything the run printed has been read
  child.on('close', (code: number | null, signal: string | null) => {
    outcome.code = code;
    outcome.signal = signal;
    finish();
  });

  return {
    done,
    answer: (id, value) => send({ type: 'input', id, value }),
    refuse: (id) => send({ type: 'input', id, cancel: true }),
    cancel: (reason) => {
      if (settled || outcome.cancelled) { return; }
      outcome.cancelled = true;

      if (child.connected) {
        const grace = options.graceMs ?? GRACE_MS;
        send({ type: 'cancel', reason: reason || 'Cancelled from the editor' });
        timers.push(setTimeout(() => child.kill(), grace));
        timers.push(setTimeout(() => child.kill('SIGKILL'), grace * 2));
      }
      else {
        child.kill();
      }
    }
  };
};
