import fs from 'fs';
import path from 'path';

import * as paths from './paths';
import * as markdownFlows from './markdownFlows';
import * as testRunReport from './testRunReport';
import { sensitive } from './reporter';

/**
 * Test runs.
 *
 * A test run is the record of the flows a person decided to execute and what
 * happened to each of them -- whether the run came from the flow page's Run
 * button, from "Run all" on a folder view, or from the CLI.
 *
 * Every run is a folder of the context directory:
 *
 *   test-runs/<date_time>-<environment>/
 *     run.json                    # the summary the UI lists
 *     <flow relative path>.md     # a copy of each executed flow
 *
 * Each copy is the flow's own markdown with the execution written into it: a
 * `testRun` frontmatter block for the flow as a whole, and a ```step-result
 * block under every ```step block with that step's request, response, tests
 * and timings. The originals under flows/ are never touched.
 */

/** One flow of a run, as run.json carries it. */
export interface TestRunFlowSummary {
  file: string;
  title: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  times?: { start?: number; end?: number; duration?: number };
  steps?: { total: number; passed: number; failed: number };
  error?: string;
}

/**
 * Where the HTML report of a finished run was sent, when an integration is
 * configured to send it somewhere.
 */
export interface TestRunUpload {
  /** The integration that took it */
  target: 'sharepoint';
  status: 'uploading' | 'uploaded' | 'failed';
  /** When it reached this status */
  at?: number;
  /** Path of the file inside the destination */
  path?: string;
  /** Where a person can open it */
  url?: string | null;
  library?: string;
  site?: string;
  /** Why it did not work, for a failed upload */
  error?: string;
}

/** The run.json document. */
export interface TestRunSummary {
  id: string;
  trigger: 'flow' | 'folder' | 'cli';
  environment: string;
  folder?: string;
  view?: string;
  status: 'running' | 'passed' | 'failed';
  times: { start: number; end?: number; duration?: number };
  flows: TestRunFlowSummary[];
  /** Absent when no integration was asked to take the report anywhere */
  upload?: TestRunUpload;
}

/** The in-memory handle the recording functions work on. */
export interface TestRun {
  id: string;
  dir: string;
  io: { emit: (...args: any[]) => void } | null;
  summary: TestRunSummary;
}

const RUNS_DIR = 'test-runs';
const SUMMARY_FILE = 'run.json';
const FLOW_EXTENSIONS = ['md', 'markdown'];

/**
 * The test-runs directory of the context.
 * @returns {Promise<string>}
 */
const runsRoot = async () => paths.contextDir([RUNS_DIR]);

export { runsRoot };

/* ------------------------------------------------------------- utilities */

/**
 * An environment name as a run folder can carry it: only the characters
 * resolveRunDir accepts, so the name never has to be escaped or decoded.
 * @param {string} environment
 * @returns {string}
 */
const environmentSlug = (environment) => String(environment || '')
  .trim()
  .replace(/[^A-Za-z0-9._-]+/g, '-')
  .replace(/^[-.]+|[-.]+$/g, '');

export { environmentSlug };

/**
 * The folder name of a run: its local start time followed by the
 * environment it ran against, filesystem-safe and sortable.
 * 2026-08-20_14-30-05-staging
 * @param {Date} date
 * @param {string} [environment]
 * @returns {string}
 */
const formatRunId = (date, environment?) => {
  const pad = (value) => String(value).padStart(2, '0');
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
  const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join('-');
  const suffix = environmentSlug(environment);
  return suffix ? `${day}_${time}-${suffix}` : `${day}_${time}`;
};

export { formatRunId };

/**
 * Something JSON can carry, with the same masking the reporter applies to
 * the console and the socket -- these files can end up committed.
 * @param {*} value
 * @returns {*}
 */
const masked = (value) => {
  if (value === undefined) { return undefined; }
  try {
    return sensitive(JSON.parse(JSON.stringify(value)));
  }
  catch {
    return null;
  }
};

/**
 * An epoch-milliseconds timestamp as ISO, for the copy's frontmatter.
 * @param {number} ms
 * @returns {string|undefined}
 */
const iso = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString() : undefined);

/**
 * The stored result of one executed step: exactly the shape the UI's
 * execution output reads ({ execution, request, response, testReport }).
 * A step the run never reached is stored as skipped.
 * @param {Object} step - A step of the executed flow
 * @returns {Object}
 */
const resultForStep = (step) => {
  if (!step || !step.execution) {
    return { execution: { status: 'skipped' } };
  }

  const execution: Record<string, any> = {
    status: step.execution.status,
    times: masked(step.execution.times) || {}
  };
  if (step.execution.attempt) { execution.attempt = step.execution.attempt; }
  if (step.execution.error) { execution.error = masked(step.execution.error); }

  const result: Record<string, any> = { execution };
  if (step.request !== undefined && step.request !== null) { result.request = masked(step.request); }
  if (step.response !== undefined && step.response !== null) { result.response = masked(step.response); }
  if (step.testReport !== undefined && step.testReport !== null) { result.testReport = masked(step.testReport); }

  return result;
};

/**
 * The results of a whole executed flow, indexed like the document's step
 * blocks so withResults can put each one under its step.
 * @param {Object} flow - The executed flow (as the runner left it)
 * @returns {Array<Object>}
 */
const resultsFor = (flow) => {
  const steps = flow && Array.isArray(flow.steps) ? flow.steps : [];
  const results: any[] = [];

  steps.forEach((step, index) => {
    const at = step && typeof step.stepIndex === 'number' ? step.stepIndex : index;
    results[at] = resultForStep(step);
  });

  return results;
};

export { resultsFor };

/**
 * How the steps of an executed flow went, for the run summary.
 * @param {Object} flow
 * @returns {{total: number, passed: number, failed: number}}
 */
const statsFor = (flow) => {
  const steps = flow && Array.isArray(flow.steps) ? flow.steps : [];
  return {
    total: steps.length,
    passed: steps.filter(step => step && step.execution && step.execution.status === 'passed').length,
    failed: steps.filter(step => step && step.execution && ['failed', 'error'].includes(step.execution.status)).length
  };
};

/**
 * The copy of a flow document that a run stores: the original markdown with
 * a `testRun` frontmatter block and the step results written in.
 * @param {string} content - The flow exactly as it was run
 * @param {Object} options - { testRun, results }
 * @returns {string}
 */
const buildCopy = (content, { testRun, results }) => {
  const { meta } = markdownFlows.parseFrontmatter(content || '');
  const withMeta = markdownFlows.withFrontmatter(content || '', { ...meta, testRun });
  return markdownFlows.withResults(withMeta, results || []);
};

export { buildCopy };

/**
 * The file name a flow is stored under inside the run folder: its path
 * relative to the flows directory when it has one, a slug of its title
 * otherwise (content run without a file, e.g. straight from the API).
 *
 * @param {Object} options - { relativePath, absolutePath, title }
 * @returns {Promise<string>}
 */
const copyFileName = async ({ relativePath, absolutePath, title }: {
  relativePath?: string;
  absolutePath?: string;
  title?: string;
} = {}) => {
  if (relativePath) {
    const parts = String(relativePath)
      .replace(/\\/g, '/')
      .split('/')
      .filter(part => part && part !== '.');
    if (parts.length && parts.every(part => part !== '..')) {
      return parts.join('/');
    }
  }

  if (absolutePath) {
    const flowsDir = await paths.contextDir(['flows']);
    const relative = path.relative(flowsDir, absolutePath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/');
    }
    return path.basename(absolutePath);
  }

  const slug = String(title || 'flow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'flow';
  return `${slug}.md`;
};

export { copyFileName };

/* ------------------------------------------------------------- recording */

/**
 * Tell whoever is watching that a run changed. The UI keeps its sidebar and
 * the run page current with these; the CLI has no socket and emits nothing.
 * @param {TestRun} run
 * @param {boolean} [removed]
 */
const emit = (run, removed = false) => {
  if (run.io && typeof run.io.emit === 'function') {
    run.io.emit('testrun:update', { id: run.id, run: run.summary, removed });
  }
};

/**
 * Write run.json and broadcast the change.
 * @param {TestRun} run
 */
const save = (run) => {
  fs.writeFileSync(path.join(run.dir, SUMMARY_FILE), JSON.stringify(run.summary, null, 2), 'utf8');
  emit(run);
};

/**
 * The summary entry of one flow of the run, created on the fly for a flow
 * the run was not planned with.
 * @param {TestRun} run
 * @param {string} file
 * @returns {TestRunFlowSummary}
 */
const entryFor = (run, file) => {
  let entry = run.summary.flows.find(candidate => candidate.file === file);
  if (!entry) {
    entry = { file, title: file, status: 'pending' };
    run.summary.flows.push(entry);
  }
  return entry;
};

/**
 * Create a run folder and its summary. The run starts as "running" and holds
 * a pending entry per flow, so the UI can show progress from the first
 * moment.
 *
 * @param {Object} options
 * @param {string} options.trigger - 'flow' | 'folder' | 'cli'
 * @param {string} options.environment
 * @param {string} [options.folder] - Folder the run was started from ('' is the whole flows directory)
 * @param {string} [options.view] - View whose filters selected the flows
 * @param {Array<Object>} options.flows - [{ file, title }]
 * @param {Object} [options.io] - Socket.IO server, when there is a UI to tell
 * @returns {Promise<TestRun>}
 */
const create = async ({ trigger, environment, folder, view, flows, io }: {
  trigger: TestRunSummary['trigger'];
  environment: string;
  folder?: string;
  view?: string;
  flows: Array<{ file: string; title?: string }>;
  io?: any;
}): Promise<TestRun> => {
  const root = await runsRoot();
  fs.mkdirSync(root, { recursive: true });

  // Two runs within the same second get suffixed folders
  const base = formatRunId(new Date(), environment);
  let id = base;
  let attempt = 2;
  while (fs.existsSync(path.join(root, id))) {
    id = `${base}-${attempt}`;
    attempt += 1;
  }

  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });

  const summary: TestRunSummary = {
    id,
    trigger,
    environment,
    ...(folder !== undefined ? { folder } : {}),
    ...(view ? { view } : {}),
    status: 'running',
    times: { start: Date.now() },
    flows: (flows || []).map(flow => ({
      file: flow.file,
      title: flow.title || flow.file,
      status: 'pending'
    }))
  };

  const run: TestRun = { id, dir, io: io || null, summary };
  save(run);
  return run;
};

export { create };

/**
 * Mark a flow of the run as running.
 * @param {TestRun} run
 * @param {string} file
 */
const flowStarted = (run, file) => {
  const entry = entryFor(run, file);
  entry.status = 'running';
  entry.times = { start: Date.now() };
  save(run);
};

export { flowStarted };

/**
 * Store the copy of a finished flow -- results written in -- and update the
 * run summary.
 *
 * @param {TestRun} run
 * @param {string} file - The flow's file inside the run folder
 * @param {Object} options
 * @param {string} options.content - The flow exactly as it was run
 * @param {Object} options.flow - The executed flow, as the runner left it
 */
const flowFinished = (run, file, { content, flow }) => {
  const status = flow && flow.execution && flow.execution.status === 'passed' ? 'passed' : 'failed';
  const times = (flow && flow.execution && flow.execution.times) || {};
  const start = times.start;
  const end = times.end || Date.now();
  const errorMessage = flow && flow.execution && flow.execution.error && flow.execution.error.message;

  const testRun: Record<string, any> = {
    id: run.id,
    trigger: run.summary.trigger,
    environment: run.summary.environment,
    status
  };
  const startedAt = iso(start);
  const finishedAt = iso(end);
  if (startedAt) { testRun.startedAt = startedAt; }
  if (finishedAt) { testRun.finishedAt = finishedAt; }
  if (errorMessage) { testRun.error = errorMessage; }

  writeCopy(run, file, buildCopy(content, { testRun, results: resultsFor(flow) }));

  const entry = entryFor(run, file);
  entry.status = status;
  entry.times = {
    ...(typeof start === 'number' ? { start } : {}),
    end,
    ...(typeof start === 'number' ? { duration: end - start } : {})
  };
  entry.steps = statsFor(flow);
  if (errorMessage) { entry.error = errorMessage; }
  else { delete entry.error; }

  save(run);
};

export { flowFinished };

/**
 * Record a flow that could not run at all (it did not parse, or the runner
 * was busy). The copy still gets written -- a run should hold every flow it
 * was asked to execute.
 *
 * @param {TestRun} run
 * @param {string} file
 * @param {Object} options - { content, error }
 */
const flowFailed = (run, file, { content, error }: { content?: string; error: any }) => {
  const message = (error && error.message) || String(error);

  if (content !== undefined) {
    const testRun = {
      id: run.id,
      trigger: run.summary.trigger,
      environment: run.summary.environment,
      status: 'failed',
      error: message
    };
    try {
      writeCopy(run, file, buildCopy(content, { testRun, results: [] }));
    }
    catch (ex) {
      console.error(`Could not write the run copy of ${file}:`, ex);
    }
  }

  const entry = entryFor(run, file);
  entry.status = 'failed';
  entry.error = message;
  save(run);
};

export { flowFailed };

/**
 * Send the report of a finished run wherever the integrations say it goes,
 * recording the outcome in the summary as it happens -- so the run page shows
 * "uploading…" while it is in flight and the destination once it landed.
 *
 * Nothing here is allowed to throw: a report that could not be delivered is a
 * line in run.json, never a failed run.
 *
 * @param {TestRun} run
 * @returns {Promise<void>}
 */
const deliverReport = async (run) => {
  const sharepoint = require('./sharepoint');

  try {
    const settings = await sharepoint.loadSettings();

    if (!sharepoint.shouldUpload(settings, run.summary)) { return; }

    run.summary.upload = { target: 'sharepoint', status: 'uploading', at: Date.now() };
    save(run);

    const result = await sharepoint.uploadReport({
      dir: run.dir,
      file: testRunReport.REPORT_FILE,
      summary: run.summary
    });

    if (!result) {
      delete run.summary.upload;
    }
    else {
      run.summary.upload = result;
      if (result.status === 'failed') {
        console.error('Could not upload the report of run %s: %s', run.id, result.error);
      }
    }

    save(run);
  }
  catch (ex) {
    run.summary.upload = {
      target: 'sharepoint',
      status: 'failed',
      at: Date.now(),
      error: (ex && ex.message) || String(ex)
    };
    console.error('Could not upload the report of run %s:', run.id, ex);
    save(run);
  }
};

/**
 * Close the run: it passed only when every flow did. A finished run also gets
 * its standalone HTML report written into the folder -- and a report that
 * cannot be written must never fail the run itself.
 *
 * The report is then handed to whichever integration was configured to
 * receive it; the promise only resolves once that is over, so a CLI run does
 * not exit halfway through its own upload.
 *
 * @param {TestRun} run
 * @returns {Promise<void>}
 */
const finalize = async (run) => {
  if (run.summary.status !== 'running') { return; }

  run.summary.status = run.summary.flows.every(flow => flow.status === 'passed') ? 'passed' : 'failed';
  run.summary.times.end = Date.now();
  run.summary.times.duration = run.summary.times.end - run.summary.times.start;
  save(run);

  try {
    testRunReport.write(run.dir, run.summary);
  }
  catch (ex) {
    console.error('Could not write the report of run %s:', run.id, ex);
    return;
  }

  await deliverReport(run);
};

export { finalize };

/**
 * Throw away a run that never happened (the runner refused to start).
 * @param {TestRun} run
 */
const discard = (run) => {
  fs.rmSync(run.dir, { recursive: true, force: true });
  emit(run, true);
};

export { discard };

/**
 * Write one flow copy inside the run folder, refusing paths that would land
 * outside of it.
 * @param {TestRun} run
 * @param {string} file
 * @param {string} content
 */
const writeCopy = (run, file, content) => {
  const absolute = path.resolve(run.dir, String(file || '').replace(/\\/g, '/'));

  if (absolute === run.dir || !absolute.startsWith(run.dir + path.sep)) {
    throw new Error(`Invalid flow file name: ${file}`);
  }

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
};

/**
 * The recording of a run that holds a single flow -- the Run button and the
 * CLI. The returned onFinished is handed to the runner, and writes the copy
 * and closes the run in one go.
 *
 * @param {Object} options - { trigger, environment, file, title, content, io }
 * @returns {Promise<{run: TestRun, onFinished: Function, discard: Function}>}
 */
const single = async ({ trigger, environment, file, title, content, io }: {
  trigger: TestRunSummary['trigger'];
  environment: string;
  file: string;
  title?: string;
  content: string;
  io?: any;
}) => {
  const run = await create({ trigger, environment, flows: [{ file, title }], io });
  flowStarted(run, file);

  return {
    run,
    onFinished: async (flow) => {
      flowFinished(run, file, { content, flow });
      await finalize(run);
    },
    discard: () => discard(run)
  };
};

export { single };

/* --------------------------------------------------------- folder runs */

/**
 * Everything a folder run needs before it can start: the flows to execute,
 * in the order they will run, and the name of the view that chose them.
 *
 * @param {Object} options
 * @param {Array<string>} [options.files] - Relative paths inside the flows
 *   directory, in the order to run them. The folder page sends the rows the
 *   person is looking at. When absent, the view is evaluated here.
 * @param {string} [options.folder] - Folder the run was started from
 * @param {string} [options.view] - Name of the view whose filters apply
 * @param {string} options.environment
 * @returns {Promise<{targets: Array<Object>, view: string|undefined}>}
 */
const prepareFolderRun = async ({ files, folder = '', view, environment }: {
  files?: string[];
  folder?: string;
  view?: string;
  environment: string;
}) => {
  if (!environment) {
    throw new Error('Invalid request: "environment" is required');
  }

  // Required lazily: applications, bases and the runner all sit above this
  // helper in the import graph
  const apps = require('./applications');
  const allEnvironments = await apps.allPossibleEnvironments();
  if (!allEnvironments.includes(environment)) {
    throw new Error(`Invalid environment: ${environment}. Must be one of ${allEnvironments.join(', ')}`);
  }

  let relativePaths = Array.isArray(files) ? files.map(item => String(item || '').trim()).filter(Boolean) : [];
  let viewName = view;

  if (!relativePaths.length) {
    const bases = require('./bases');
    const result = await bases.query({ folder, view });
    viewName = (result.view && result.view.name) || view;
    relativePaths = result.rows.map(row => row.relativePath);
  }

  if (!relativePaths.length) {
    throw new Error('No flows to run');
  }

  const flowsHelper = require('./flows');
  const targets: Array<{ file: string; content: string; title: string }> = [];
  const steps: Array<Record<string, any>> = [];

  for (const relativePath of relativePaths) {
    const { absolute, relative } = await flowsHelper.resolveWithinFlows(relativePath);
    const ext = path.extname(absolute).toLowerCase().substring(1);

    const usable = relative && FLOW_EXTENSIONS.includes(ext) &&
      fs.existsSync(absolute) && !fs.statSync(absolute).isDirectory();
    if (!usable) {
      throw new Error(`Flow not found: ${relativePath}`);
    }

    const content = fs.readFileSync(absolute, 'utf8');
    const parsed = markdownFlows.parse(content);

    steps.push(...parsed.steps);

    targets.push({
      file: relative.split(path.sep).join('/'),
      content,
      title: parsed.title || path.basename(absolute)
    });
  }

  // Every application these flows use has to have its env file for the
  // environment before the first one starts -- a run that would break half
  // way through is better refused than recorded. Applications no flow of the
  // run touches are not asked for anything.
  const applications = apps.applicationsOf(steps);
  const missing = await apps.missingEnvFilesFor(applications, environment);

  if (missing.length) {
    throw new Error(apps.readinessError({
      environment, environments: allEnvironments, known: true, applications, missing, ready: false
    }));
  }

  return { targets, view: viewName };
};

export { prepareFolderRun };

/**
 * Execute the flows of a run, one at a time -- the runner cannot do two at
 * once -- and close the run when the last one is in.
 *
 * @param {TestRun} run
 * @param {Array<Object>} targets - [{ file, content, title }]
 * @param {Object} options
 * @param {string} options.environment
 * @param {boolean} [options.cli] - Report on the terminal rather than the socket
 * @returns {Promise<void>}
 */
const executeFolderRun = async (run: TestRun, targets, { environment, cli = false }: {
  environment: string;
  cli?: boolean;
}) => {
  for (const target of targets) {
    flowStarted(run, target.file);

    if (cli) {
      console.log(`\n${'─'.repeat(60)}\n${target.title} — ${target.file}\n${'─'.repeat(60)}`);
    }

    let flowAsJson;
    try {
      flowAsJson = markdownFlows.toFlow(target.content);
    }
    catch (ex) {
      flowFailed(run, target.file, { content: target.content, error: ex });
      continue;
    }

    const flowRunner = require(`./runner/v${flowAsJson.version || '1'}`);

    let resolveFinished;
    const finished = new Promise<void>(resolve => { resolveFinished = resolve; });

    const started = await flowRunner.run(flowAsJson, {
      environment,
      cli,
      reporter: { cli, server: run.io },
      // One failing flow must not take the rest of the run with it: the
      // caller reads the summary and decides what the failure means
      exitOnFailure: false,
      // The runner calls this after the lock is released, so the next
      // flow of the loop can start
      onFinished: async (flow) => {
        try {
          flowFinished(run, target.file, { content: target.content, flow });
        }
        finally {
          resolveFinished();
        }
      }
    });

    // Someone else grabbed the runner between two flows
    if (!started) {
      flowFailed(run, target.file, { content: target.content, error: new Error('Another flow was already running') });
      continue;
    }

    await finished;
  }

  await finalize(run);
};

export { executeFolderRun };

/**
 * Run a set of flows as one test run: what "Run all" on a folder view does.
 *
 * The promise resolves as soon as the run exists; the execution itself
 * continues in the background and lands in run.json (and on the socket) as it
 * goes.
 *
 * @param {Object} options - As prepareFolderRun takes them, plus:
 * @param {Object} [options.io] - Socket.IO server
 * @returns {Promise<TestRunSummary>}
 */
const startFolderRun = async ({ files, folder = '', view, environment, io }: {
  files?: string[];
  folder?: string;
  view?: string;
  environment: string;
  io?: any;
}) => {
  const { targets, view: viewName } = await prepareFolderRun({ files, folder, view, environment });

  const runner = require('./runner/v1');
  if (runner.isRunning()) {
    throw new Error('Another flow is already running. Wait for it to finish.');
  }

  const apps = require('./applications');
  await apps.loadAll();

  const run = await create({ trigger: 'folder', environment, folder, view: viewName, flows: targets, io });

  void executeFolderRun(run, targets, { environment }).catch(ex => {
    console.error('Test run failed:', ex);
    return finalize(run);
  });

  return run.summary;
};

export { startFolderRun };

/**
 * Run every flow a view matches, from the CLI, and wait for the last one.
 *
 * The view is evaluated when the run starts rather than when the command was
 * written down, so a flow added afterwards is picked up on its own -- that is
 * the whole point of running a view instead of a list of files.
 *
 * @param {Object} options
 * @param {string} [options.folder] - Folder of the flows tree to scope the view to
 * @param {string} [options.view] - Name (or slug) of the view; the first one by default
 * @param {string} options.environment
 * @returns {Promise<TestRunSummary>} The finished run
 */
const runViewFromCli = async ({ folder = '', view, environment }: {
  folder?: string;
  view?: string;
  environment: string;
}) => {
  const { targets, view: viewName } = await prepareFolderRun({ folder, view, environment });

  const runner = require('./runner/v1');
  if (runner.isRunning()) {
    throw new Error('Another flow is already running. Wait for it to finish.');
  }

  const apps = require('./applications');
  await apps.loadAll();

  const run = await create({ trigger: 'cli', environment, folder, view: viewName, flows: targets });

  await executeFolderRun(run, targets, { environment, cli: true });

  return run.summary;
};

export { runViewFromCli };

/* --------------------------------------------------------------- reading */

/**
 * Every recorded run, newest first. A folder whose run.json is missing or
 * broken is skipped rather than failing the list.
 * @returns {Promise<Array<TestRunSummary>>}
 */
const list = async (): Promise<TestRunSummary[]> => {
  const root = await runsRoot();

  if (!fs.existsSync(root)) {
    return [];
  }

  const runs: TestRunSummary[] = [];

  for (const name of fs.readdirSync(root)) {
    try {
      const dir = path.join(root, name);
      if (!fs.statSync(dir).isDirectory()) { continue; }
      const summary = JSON.parse(fs.readFileSync(path.join(dir, SUMMARY_FILE), 'utf8'));
      // The folder name is the id, whatever the file says
      runs.push({ ...summary, id: name });
    }
    catch {
      continue;
    }
  }

  return runs.sort((a, b) =>
    ((b.times && b.times.start) || 0) - ((a.times && a.times.start) || 0) || b.id.localeCompare(a.id)
  );
};

export { list };

/**
 * The folder of a run, from an id that must not escape the runs directory.
 * @param {string} id
 * @returns {Promise<string>}
 */
const resolveRunDir = async (id) => {
  const name = String(id || '');

  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error('Test run not found');
  }

  const root = await runsRoot();
  const dir = path.join(root, name);

  if (!fs.existsSync(path.join(dir, SUMMARY_FILE))) {
    throw new Error('Test run not found');
  }

  return dir;
};

/**
 * One run's summary.
 * @param {string} id
 * @returns {Promise<TestRunSummary>}
 */
const get = async (id): Promise<TestRunSummary> => {
  const dir = await resolveRunDir(id);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, SUMMARY_FILE), 'utf8'));
  return { ...summary, id: path.basename(dir) };
};

export { get };

/**
 * One run's standalone HTML report. Runs recorded before reports existed
 * have no report.html yet; it is rebuilt from the folder and kept.
 * @param {string} id
 * @returns {Promise<string>} The report as HTML
 */
const report = async (id): Promise<string> => {
  const dir = await resolveRunDir(id);
  const file = path.join(dir, testRunReport.REPORT_FILE);

  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8');
  }

  const summary = await get(id);
  return testRunReport.write(dir, summary);
};

export { report };

/**
 * One stored flow copy of a run, parsed for rendering: the document's
 * segments and steps (results stripped, so they parse exactly like the
 * original), plus each step's stored result keyed by step index.
 *
 * @param {string} id - The run id
 * @param {string} file - The flow's file inside the run folder
 * @returns {Promise<Object>}
 */
const getFlow = async (id, file) => {
  const dir = await resolveRunDir(id);

  const absolute = path.resolve(dir, String(file || '').replace(/\\/g, '/'));
  const ext = path.extname(absolute).toLowerCase().substring(1);

  if (
    absolute === dir ||
    !absolute.startsWith(dir + path.sep) ||
    !FLOW_EXTENSIONS.includes(ext) ||
    !fs.existsSync(absolute) ||
    fs.statSync(absolute).isDirectory()
  ) {
    throw new Error('Flow not found');
  }

  const raw = fs.readFileSync(absolute, 'utf8');
  const { content, results } = markdownFlows.extractResults(raw);
  const parsed = markdownFlows.parse(content);

  return {
    runId: path.basename(dir),
    file: path.relative(dir, absolute).split(path.sep).join('/'),
    title: parsed.title || path.basename(absolute),
    properties: parsed.meta,
    testRun: (parsed.meta && parsed.meta.testRun) || null,
    segments: parsed.segments,
    steps: parsed.steps,
    errors: parsed.errors,
    results,
    plainText: raw
  };
};

export { getFlow };
