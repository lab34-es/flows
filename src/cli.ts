#!/usr/bin/env node

import * as paths from './helpers/paths';
import * as applications from './helpers/applications';

/**
 * Ronsel CLI Tool
 * 
 * A command-line interface for running Markdown flow definitions.
 * 
 * Usage:
 *   node cli.js start [--context <dir>] [--no-install] [--install-browsers]
 *   node cli.js [--context <dir>] [--port <port>] [--host [address]] [--no-open]
 *   node cli.js --file <path-to-flow-file> --env <environment> [--debug] [--help]
 *   node cli.js --view <view> --env <environment> [--folder <folder>]
 *   node cli.js --import-env <path-to-yaml> [--view <view> --env <environment>]
 *   node cli.js --capabilities
 *   node cli.js --agent --agent-id <name> --broker <url> --username <user> --password <secret>
 *   node cli.js --remote <agent> --file <path> --env <environment>
 *
 * Named nothing to run, the command starts the web UI: somebody who did not
 * ask for a flow is here to look at them.
 *
 * Commands:
 *   start          Make this directory a project of its own -- a context with
 *                  a package.json that depends on this tool and carries the
 *                  command as a script -- and then start the UI on it
 *
 * Options:
 *   --file         Path to the flow definition file (.md)
 *   --view         Name (or slug) of a view of views.yaml: every flow it
 *                  matches runs, in one test run
 *   --folder       Folder of the flows tree the view is scoped to
 *   --context      Context directory. Without it the directory the command
 *                  was run from is used, after asking
 *   --port         Port to start looking from for the UI (default 3001, or
 *                  PORT). Busy, the next free one is used
 *   --host         Address to listen on (default 127.0.0.1, or HOST). On its
 *                  own it means every interface, which exposes an API that
 *                  has no authentication
 *   --no-open      Do not open the browser on the UI
 *   --no-install   With `start`, write the files but do not run npm install
 *   --install-browsers
 *                  With `start`, download the browsers playwright drives
 *                  without asking. A value picks them: `all`, or a comma
 *                  separated list
 *   --no-install-browsers
 *                  Do not download them, and do not ask
 *   --import-env   Path of a YAML export of environment variables: its values
 *                  are written into the context's env files before anything
 *                  runs
 *   --dry-run      Report what --import-env would write, write nothing and run
 *                  nothing
 *   --capabilities List all available capabilities of the context
 *   --env          Environment to run the flow in (required for --file/--view)
 *   --agent        Run as an agent: wait on the broker for flows to run here
 *   --remote       Run --file or --view on the named agent instead of here
 *   --debug        Print debug information including environment variables
 *   --version      Print the installed version and exit
 *   --help         Show this help message
 *
 * Flow generation with AI lives in the web UI, where the provider, model and
 * API keys are configured.
 *
 * Examples:
 *   node cli.js start
 *   node cli.js
 *   node cli.js --file flows/my-flow.md --env production
 *   node cli.js --view smoke-tests --env production
 *   node cli.js --context my/context --import-env env.yaml --view smoke --env uat
 */

// Disable HTTP/2 to avoid potential issues
process.env.NODE_NO_HTTP2 = '1';

// Core dependencies
import fs from 'fs';
import path from 'path';
import yargsParser from 'yargs-parser';

const argv = yargsParser(process.argv.slice(2));

// Local dependencies
import * as packageJson from '../package.json';
import * as bootstrap from './helpers/bootstrap';
import * as cli from './helpers/cli';
import * as reporter from './helpers/reporter';
import * as flows from './helpers/flows';
import * as testRuns from './helpers/testRuns';
import * as bases from './helpers/bases';
import * as envTransfer from './helpers/envTransfer';
import * as project from './helpers/project';
import * as browsers from './helpers/browsers';
import * as browser from './helpers/browser';

/**
 * Print error message and exit with error code
 * @param {string} message - Error message to display
 * @param {number} [exitCode=1] - Process exit code
 */
function exitWithError(message, exitCode = 1) {
  console.error(`ERROR: ${message}`);
  process.exit(exitCode);
}

/**
 * Display help information
 */
function showHelp() {
  console.log(`
Ronsel CLI Tool v${packageJson.version}

Usage:
  ronsel start [--context <context>] [--no-install] [--install-browsers]
  ronsel [--context <context>] [--port <port>] [--host [address]] [--no-open]
  ronsel --file <path-to-flow-file> --env <environment> [--debug] [--help]
  ronsel --view <view> --env <environment> [--folder <folder>]
  ronsel --import-env <path-to-yaml> [--view <view> --env <environment>]
  ronsel --agent --agent-id <name> [--broker <url> --username <user> --password <secret>]
  ronsel --remote <agent> --file <path-to-flow-file> --env <environment>
  ronsel --remote <agent> --view <view> --env <environment>

Told nothing to run, ronsel starts the web UI on the context -- which is the
whole of the second form above.

Commands:
  start           Make this directory a project of its own. It becomes a
                  context -- flows and applications -- and gets a package.json
                  that depends on this exact version of the tool and carries
                  the command as a script. The example flows and applications
                  are copied in only when the directory was empty; one that
                  already holds anything gets the folders and the files and
                  nothing else. npm install runs, and the UI starts. From then
                  on the whole thing is "npm run ronsel", for anybody who
                  clones the folder, with nothing installed globally

Options:
  --file          Path to the flow definition file (.md markdown flow)
  --view          Name (or slug) of a view of views.yaml. Every flow the view
                  matches runs, in the order the view sorts them, as one test
                  run. The view is evaluated now, so flows added since the
                  command was written down are picked up too
  --folder        Folder of the flows tree the view is scoped to (default: all flows)
  --import-env    Path of a YAML export of environment variables -- the
                  document the Environment variables screen produces. Its
                  values are written into this context's env files before
                  anything else runs, creating the files that are missing and
                  leaving everything the document does not name untouched.
                  On its own it imports and exits; with --file or --view the
                  flows run afterwards
  --dry-run       With --import-env, report what the document would write
                  without writing it -- and without running any flow
  --capabilities  List all the capabilities the context's applications offer
  --env           Environment to run the flow in (required for --file and --view)
  --context       The directory holding the flows, the applications and
                  everything else this run reads and writes. Without it the
                  directory the command was run from is used, after asking --
                  and if that directory is empty, it is furnished with the
                  example flows and applications
  --port          Where the UI listens. A starting point, not a requirement:
                  3001 by default (or PORT), and if that one is taken the next
                  free port is used. Whichever it ends up on is printed
  --host          The address the UI listens on. 127.0.0.1 by default (or
                  HOST), so only this machine can reach it -- this API has no
                  authentication and serves the values of the context's env
                  files. On its own, --host listens on every interface; given
                  an address, on that one. Either way it says so at start
  --no-open       Do not open the browser. It is not opened anyway when
                  nobody is watching the terminal, or when CI is set
  --agent         Run as an agent: connect to the MQTT broker under
                  --agent-id and run, in this context, the flows other
                  machines send. The agent's public key is printed at start
  --remote        Run --file or --view on the named agent rather than on this
                  machine: the commit this context is on and the env files the
                  flows use travel to it, and its results land in this
                  context's test-runs
  --broker        MQTT broker URL (mqtts://host:port or wss://host/path).
                  Stored in config/remote.json the first time, with --username;
                  --password goes to the context's .env. FLOWS_BROKER_URL,
                  FLOWS_BROKER_USERNAME and FLOWS_BROKER_PASSWORD work too
  --no-install    With "start", write the files and skip the npm install --
                  useful when the folder is installed by something else
  --install-browsers
                  With "start", download the browsers playwright drives
                  without asking first. They are not part of npm install, and
                  the browser examples need them. On its own it downloads
                  chromium, which is what the examples use; "all" downloads
                  the three, and a comma separated list (firefox,webkit) names
                  them. The download runs in the background, writing to
                  logs/playwright-install.log in the context, and the UI starts
                  without waiting for it. Pass it again to undo a "no" that was
                  remembered from an earlier start
  --no-install-browsers
                  Do not download them and do not ask. Just for this run:
                  answering "no" to the question is what gets remembered
  --debug         Print debug information including environment variables
  --version, -v   Print the installed version and exit
  --help          Show this help message

Generating flows with AI is done from the web UI: the provider, model and API
keys are configured there, under Settings.

Examples:
  ronsel start
  ronsel start --context my/new/folder
  ronsel start --install-browsers
  ronsel start --install-browsers all
  ronsel
  ronsel --context my/context/folder
  ronsel --port 4000
  ronsel --host --port 8080
  ronsel --no-open
  ronsel --context my/context/folder --file flows/my-flow.md --env production
  ronsel --context my/context/folder --view all-flows --env production
  ronsel --context my/context/folder --view smoke --folder payments --env staging
  ronsel --context my/context/folder --import-env ~/Downloads/env.yaml
  ronsel --context my/context/folder --import-env env.yaml --view smoke --env uat
  ronsel --context my/context/folder --import-env env.yaml --dry-run
  ronsel --context my/context/folder --capabilities
  ronsel --context ~/flows-agent --agent --agent-id agent-ourense --broker mqtts://mqtt.example:443 --username agent-ourense --password s3cret
  ronsel --remote agent-ourense --file flows/my-flow.md --env production
  ronsel --remote agent-ourense --view smoke --env uat
  `);
  process.exit(0);
}

/**
 * Print debug information
 */
function printDebugInfo() {
  console.log('\n=== DEBUG INFORMATION ===');
  console.log('\nPackage Information:');

  // Print package info

  console.log(`Package Name: ${packageJson.name}`);
  console.log(`Package Version: ${packageJson.version}`);
  console.log(`Node Version: ${process.version}`);
  console.log(`Platform: ${process.platform}`);
  console.log(`Architecture: ${process.arch}`);
  console.log(`Process ID: ${process.pid}`);
  console.log(`Process Title: ${process.title}`);
  console.log(`Process Uptime: ${process.uptime()} seconds`);
  console.log(`Current User: ${process.env.USER || process.env.USERNAME}`);
  console.log(`Current Directory: ${process.cwd()}`);

  console.log('');
  console.log('');
  console.log('');

  console.log('\nEnvironment Variables:');

  Object.keys(process.env).sort().forEach(key => {
    console.log(`${key}=${process.env[key]}`);
  });

  console.log('');
  console.log('');
  console.log('');
  
  console.log('\nNode.js Variables:');
  console.log(`__dirname: ${__dirname}`);
  console.log(`__filename: ${__filename}`);
  console.log(`process.cwd(): ${process.cwd()}`);
  console.log(`process.argv: ${JSON.stringify(process.argv, null, 2)}`);
}

/**
 * Parse command line arguments using yargs-parser
 * @returns {Object} Parsed arguments
 */
function parseArguments() {
  // The first positional, when there is one: this CLI is flags all the way
  // down except for `start`, which is a thing to do rather than a thing to run
  const positional = (argv._ || []).map(value => String(value));

  return {
    command: positional[0] || null,
    // yargs-parser reads `--no-install` as install: false
    install: argv.install !== false,
    // The same, for the browsers -- except that this one has three answers:
    // yes, no, and nothing said, which is the one that asks. A value names the
    // browsers to download. Both spellings are read, as above
    installBrowsers: argv.installBrowsers === undefined
      ? argv['install-browsers']
      : argv.installBrowsers,
    file: argv.file || null,
    // `--view` on its own means "the first view of views.yaml"
    view: argv.view === undefined ? null : (typeof argv.view === 'string' ? argv.view : ''),
    folder: typeof argv.folder === 'string' ? argv.folder : '',
    // yargs-parser gives a dashed flag both spellings; both are read so the
    // CLI behaves the same however the command was written down
    importEnv: argv.importEnv || argv['import-env'] || null,
    dryRun: argv.dryRun || argv['dry-run'] || false,
    ai: argv.ai || null, // Removed: kept only to show a helpful error
    capabilities: argv.capabilities || false,
    // Remote execution: this machine as an agent, or a run sent to one
    agent: argv.agent || false,
    agentId: argv.agentId || argv['agent-id'] || null,
    remote: typeof argv.remote === 'string' ? argv.remote : null,
    broker: typeof argv.broker === 'string' ? argv.broker : null,
    username: typeof argv.username === 'string' ? argv.username : null,
    password: typeof argv.password === 'string' ? argv.password : null,
    env: argv.env || null,
    context: argv.context || null,
    // Where the UI listens, and whether a browser is opened on it. The port
    // and the host are handed to the API as they were written -- it is the
    // one that knows what PORT, HOST and a bare --host mean -- and
    // yargs-parser reads `--no-open` as open: false
    port: argv.port,
    host: argv.host,
    open: argv.open !== false,
    debug: argv.debug || false,
    help: argv.help || false,
    // Both spellings print the version: --version is what people type, -v is
    // what the CLI has always accepted.
    version: argv.version || argv.v || false
  };
}

/**
 * Validate the flow file path
 * @param {string} filePath - Path to the flow file
 * @returns {boolean} True if valid, otherwise exits with error
 */
async function validateFilePath(filePath) {
  if (!filePath) {
    exitWithError('No file specified. Use --file <path-to-flow-file>');
  }

  const fullFilePath = await paths.contextDir(filePath);

  if (!fs.existsSync(fullFilePath)) {
    exitWithError(`File not found: ${fullFilePath}`);
  }

  const isSupported = ['md', 'markdown'].some(ext => fullFilePath.toLowerCase().endsWith(`.${ext}`));
  if (!isSupported) {
    exitWithError('File must be a .md or .markdown file');
  }

  return fullFilePath;
}

/**
 * Parse a Markdown flow document
 * @param {string} content - The flow file's content
 * @returns {Object} Parsed flow definition
 */
function parseFlowContent(content) {
  try {
    const markdownFlows = require('./helpers/markdownFlows');
    return markdownFlows.toFlow(content);
  } catch (error) {
    exitWithError(`Error parsing flow file: ${error.message}`);
  }
}

/**
 * Run the flow with the specified options
 * @param {Object} flowConfig - Parsed flow configuration
 * @param {Object} options - Runtime options
 */
async function runFlow(flowConfig, options) {
  try {
    // Keeps the applications' editor support pointing at this installation
    await bootstrap.ensureTypeScriptConfig();

    await applications.loadAll();

    cli.logo(packageJson.version);
    cli.wisdom();

    const runnerVersion = flowConfig.version || '1';
    const runner = require(`./helpers/runner/v${runnerVersion}`);

    if (process.env.IS_NODEMON) {
      setTimeout(() => {
        runner.run(flowConfig, options);
      }, 1000);
    } else {
      runner.run(flowConfig, options);
    }
  } catch (error) {
    console.trace(error);
    exitWithError(`Error running flow: ${error.message}`);
  }
}

/**
 * Run every flow a saved view matches, as one test run.
 *
 * The view is evaluated here and now: what runs is whatever matches its
 * filters today, which is why a command written down in a pipeline keeps
 * picking up flows added afterwards.
 *
 * @param {Object} options - { view, folder, env, debug }
 */
async function runView({ view, folder, env }) {
  // Keeps the applications' editor support pointing at this installation
  await bootstrap.ensureTypeScriptConfig();

  cli.logo(packageJson.version);
  cli.wisdom();

  const document = await bases.load();
  const target = bases.findView(document.views, view);

  if (!target) {
    exitWithError(
      `View not found: ${view}. ${document.views.length} available: ` +
      document.views.map(candidate => candidate.slug).join(', ')
    );
    return;
  }

  console.log(`View: ${target.name} (${target.slug})`);
  console.log(`Folder: ${folder || 'every flow'}`);
  console.log(`Environment: ${env}`);

  let summary;
  try {
    summary = await testRuns.runViewFromCli({ folder, view: target.name, environment: env });
  }
  catch (error) {
    exitWithError(error.message);
    return;
  }

  const passed = summary.flows.filter(flow => flow.status === 'passed');
  const failed = summary.flows.filter(flow => flow.status !== 'passed');

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${target.name}: ${passed.length} passed, ${failed.length} failed`);
  failed.forEach(flow => console.log(`  failed: ${flow.file}${flow.error ? ` — ${flow.error}` : ''}`));
  console.log(`Recorded as test run ${summary.id}`);

  process.exit(summary.status === 'passed' ? 0 : 1);
}

/**
 * Write a YAML export of environment variables into this context's env files.
 *
 * The document is the one the Environment variables screen produces, and this
 * does to it exactly what that screen's Import section does: the env files it
 * names are created when they are missing, and the ones already there keep
 * everything the document does not mention. It runs before any flow so that a
 * pipeline can carry its credentials as one file next to the command, rather
 * than as a folder of env files nobody can commit.
 *
 * A document that cannot be read is fatal: a run started without the values it
 * was told to import would fail later, and say much less about why.
 *
 * @param {Object} options - { file, dryRun }
 * @returns {Promise<boolean>} false when the import failed, and nothing else should run
 */
async function importEnvironment({ file, dryRun }) {
  let result;

  try {
    result = await envTransfer.importFile(file, { dryRun });
  }
  catch (error) {
    exitWithError(`Could not import the environment variables: ${error.message}`);
    return false;
  }

  envTransfer.reportLines(result).forEach(line => console.log(line));
  console.log('');

  return true;
}

/**
 * Start the web server with built frontend and API
 *
 * This is what the command does when it was told nothing to run: somebody who
 * did not name a flow came to look at them.
 *
 * The UI is built ahead of time and shipped inside the package, so this only
 * has to boot the API that serves it. Rebuilding from here would need the
 * project sources and a working directory that has them, neither of which an
 * installed copy of the tool can count on.
 *
 * The port is not known in advance -- 3001 is only where the API starts
 * looking -- so the URL it settles on comes back from `start` and is what
 * gets opened. Nobody here guesses a port.
 *
 * @param {Object} [args] - { context, port, host, open }
 */
async function startServer(args: Record<string, any> = {}) {
  console.log('Starting server...');

  // The context was settled before this ran -- `paths.useContext` -- so all
  // the API is told here is where to listen
  const api = require('./api');
  const url = await api.start({ port: args.port, host: args.host });

  // Somebody who typed a command to look at their flows wants the browser on
  // them. A pipeline does not, and neither does a terminal nobody is at
  if (browser.wanted({ open: args.open })) {
    browser.open(url);
  }
}

/**
 * Make this directory a project of its own, then start the UI on it.
 *
 * A context is only a folder of flows and applications, which is why the tool
 * can be pointed at any directory -- but a folder alone does not say how to
 * run itself. `start` writes that down: a package.json that depends on this
 * exact version and carries the command as a script, so what took `npx ronsel`
 * and an explanation becomes `npm install && npm run ronsel` for whoever
 * clones the folder next, with nothing installed globally and nothing to know.
 *
 * Everything it writes is additive. An existing package.json keeps its
 * formatting and every key it had; a `ronsel` script that is already there is
 * reported and left alone; the examples go in only when the directory was
 * empty, and once in they are never restored.
 *
 * @param {Object} args - { context, install }
 */
async function startProject(args) {
  const directory = args.context
    ? path.resolve(process.cwd(), args.context)
    : process.cwd();

  cli.logo(packageJson.version);
  console.log('');

  // A folder with somebody else's work in it is not obviously ours to furnish,
  // even having been told to: ask, when there is anybody to ask
  if (!bootstrap.isContextDirectory(directory)) {
    const question = `${directory} already holds other files. Set it up as a ronsel project anyway?`;

    if (cli.isInteractive) {
      if (!await cli.confirm(question)) {
        console.log('Nothing done. Name an empty folder with --context <directory>.');
        process.exit(0);
        return;
      }
    }
    else {
      console.log(`${directory} already holds other files, and is being set up as a ronsel project.`);
    }
  }

  fs.mkdirSync(directory, { recursive: true });
  paths.useContext(directory);

  console.log(`Project: ${directory}`);

  // The folders, the tsconfig and -- in an empty directory only -- the examples
  await bootstrap.initialise();

  let manifest;
  try {
    manifest = project.ensurePackageJson({ directory, version: packageJson.version });
  }
  catch (error) {
    exitWithError(error.message);
    return;
  }

  const written = [...manifest.changes, ...project.ensureGitignore(directory)];
  written.forEach(line => console.log(`  ${line}`));
  if (!written.length) { console.log('  already set up: nothing to write'); }

  if (manifest.scriptTaken) {
    console.log(`  note: package.json already has a "${project.SCRIPT_NAME}" script, left as it is`);
    console.log(`        the command it should run is: ${project.RUN_SCRIPT}`);
  }

  if (args.install) {
    console.log('');
    try {
      await project.install(directory);
    }
    catch (error) {
      // The files are written and the folder is a context: this is worth
      // saying plainly, but it is not worth throwing the setup away over
      console.error(`\nCould not install the dependencies: ${error.message}`);
      console.error(`Run "npm install" in ${directory} and then "npm run ${project.SCRIPT_NAME}".`);
      process.exit(1);
      return;
    }
  }

  console.log('');
  console.log(`Done. From now on, in this folder:  npm run ${project.SCRIPT_NAME}`);

  if (!args.install && !project.isInstalled(directory)) {
    console.log('Run "npm install" first -- this run skipped it.');
  }

  console.log('');

  // The browser examples drive a real browser, and playwright's browsers are a
  // download of their own. This looks for them, offers to fetch them and
  // leaves that running in the background: the UI is not kept waiting for a
  // few hundred megabytes, and a folder of HTTP flows never needs them at all.
  //
  // The catch is belt and braces -- `ensure` is written never to throw -- and
  // a UI that did not start over a browser check would be a poor trade
  await browsers.ensure({ install: args.installBrowsers })
    .catch(error => console.warn(`Skipping the browser check: ${error.message}`));

  await startServer(args);
}

/**
 * Run as an agent: sit on the broker and run the flows other machines send.
 *
 * Nothing about the flows themselves changes on this side -- they run through
 * the same runner, from this context. What the agent adds is the connection
 * and a name.
 *
 * @param {Object} args - { agentId, broker, username, password }
 */
async function startAgent(args) {
  const remoteConfig = require('./helpers/remote/config');
  const brokerHelper = require('./helpers/remote/broker');
  const agent = require('./helpers/remote/agent');

  cli.logo(packageJson.version);

  let identity;
  let settings;
  try {
    identity = await remoteConfig.agentIdentity(args.agentId);
    settings = await remoteConfig.brokerSettings({
      url: args.broker, username: args.username, password: args.password
    });
  }
  catch (error) {
    exitWithError(error.message);
    return;
  }

  await bootstrap.ensureTypeScriptConfig();
  await applications.loadAll();

  console.log(`Agent:       ${identity.id}`);
  console.log(`Broker:      ${settings.url}${settings.username ? ` as ${settings.username}` : ''}`);
  console.log(`Context:     ${await paths.contextRoot()}`);
  console.log(`Public key:  ${identity.publicKey}`);
  console.log(`Fingerprint: ${identity.fingerprint}`);

  let connection;
  try {
    connection = await brokerHelper.connect({
      url: settings.url,
      username: settings.username,
      password: settings.password,
      clientId: `flows-agent-${identity.id}`,
      will: agent.will(identity.id)
    });
  }
  catch (error) {
    exitWithError(error.message);
    return;
  }

  const running = await agent.start({ identity, connection });
  console.log('\nWaiting for jobs. Ctrl+C to stop.');

  const stop = async () => {
    console.log('\nStopping...');
    await running.stop();
    process.exit(0);
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

/**
 * Run a flow, or a view, on an agent instead of here.
 *
 * @param {Object} args - { remote, file, view, folder, env, broker, username, password }
 */
async function runRemote(args) {
  const remoteConfig = require('./helpers/remote/config');
  const client = require('./helpers/remote/client');
  const terminal = require('./helpers/remote/terminal');

  cli.logo(packageJson.version);

  if (args.broker || args.username || args.password) {
    try {
      await remoteConfig.brokerSettings({ url: args.broker, username: args.username, password: args.password });
    }
    catch (error) {
      exitWithError(error.message);
      return;
    }
  }

  console.log(`Agent:       ${args.remote}`);
  console.log(`Environment: ${args.env}`);
  console.log(args.file ? `Flow:        ${args.file}` : `View:        ${args.view || '(first view)'}`);
  console.log('');

  let result;
  try {
    result = await client.run({
      agent: args.remote,
      environment: args.env,
      file: args.file || undefined,
      view: args.file ? undefined : args.view,
      folder: args.folder,
      onEvent: (event, payload) => {
        const line = terminal.describe(event, payload);
        if (line) { console.log(line); }
      },
      onInput: terminal.prompt
    });
  }
  catch (error) {
    exitWithError(error.message);
    return;
  }

  result.warnings.forEach(warning => console.warn(`Warning: ${warning}`));

  const { testRun } = result;
  const passed = (testRun.flows || []).filter(flow => flow.status === 'passed');
  const failed = (testRun.flows || []).filter(flow => flow.status !== 'passed');

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${args.remote}: ${passed.length} passed, ${failed.length} failed`);
  failed.forEach(flow => console.log(`  failed: ${flow.file}${flow.error ? ` — ${flow.error}` : ''}`));
  console.log(`Recorded as test run ${testRun.id}`);

  process.exit(testRun.status === 'passed' ? 0 : 1);
}

/**
 * Settle on the directory this run works in.
 *
 * `--context` names it outright. Without it the directory the command was run
 * from is the candidate -- there is no folder of ours in the home directory
 * any more -- and, since that is a folder we may be about to write examples
 * into, the person is asked first. A run nobody is watching (a pipeline, a
 * piped command) is never stopped by the question: it answers yes, having
 * said which directory it means.
 *
 * @param {Object} args - The parsed arguments
 * @returns {Promise<boolean>} false when the answer was no and nothing should run
 */
async function resolveContext(args) {
  if (args.context) { return true; }

  const candidate = process.cwd();
  const empty = bootstrap.isEmptyDirectory(candidate);

  if (cli.isInteractive) {
    const question = empty
      ? `Use ${candidate} as the context? It is empty, so the example flows and applications go in it.`
      : `Use ${candidate} as the context?`;

    if (!await cli.confirm(question)) {
      console.log('Nothing done. Name the folder to work in with --context <directory>.');
      process.exit(0);
      return false;
    }
  }
  else {
    console.log(`Context directory: ${candidate}`);
  }

  paths.useContext(candidate);
  return true;
}

/**
 * Main function to execute the CLI
 */
async function main() {
  // Parse command line arguments
  const args = parseArguments();

  // Show version if requested
  if (args.version) {
    console.log(packageJson.version);
    process.exit(0);
  }

  // Show help if requested
  if (args.help) {
    showHelp();
    return;
  }

  // Show debug information if requested
  if (args.debug) {
    printDebugInfo();
  }

  // `start` is the one thing this CLI is told to do rather than to run, and it
  // settles the context itself -- it is the command that creates one
  if (args.command === 'start') {
    await startProject(args);
    return;
  }

  if (args.command) {
    exitWithError(`Unknown command: ${args.command}. The only one is "start" -- see "ronsel --help"`);
    return;
  }

  // --dry-run belongs to the import, not to the flows: on its own it would
  // read as "run nothing", which is not something this CLI offers
  if (args.dryRun && !args.importEnv) {
    exitWithError('--dry-run only applies to --import-env: pass the document you want previewed');
    return;
  }

  // Which folder this is all about, before anything reads or writes in it
  if (!await resolveContext(args)) { return; }

  // Variables first: a flow is refused before it starts when an application it
  // uses has no env file for the environment, so the document has to be on
  // disk by the time that is checked
  if (args.importEnv) {
    if (!await importEnvironment({ file: args.importEnv, dryRun: args.dryRun })) { return; }

    // A document on its own is an import and nothing else, and a preview stops
    // before it could run anything
    const runs = Boolean(args.file) || args.view !== null || args.capabilities;

    if (args.dryRun || !runs) {
      process.exit(0);
      return;
    }
  }

  // What was named to run -- and, when nothing was, the UI
  if (args.ai) {
    exitWithError(
      'Generating flows with AI is no longer available from the CLI. ' +
      'Start the UI with "ronsel" and use the "Create using AI" ' +
      'option when creating a flow.'
    );
  } else if (args.capabilities) {
    // List capabilities
    await flows.listCapabilities();
    process.exit(0);
  } else if (args.agent) {
    // Wait on the broker for flows to run here
    await startAgent(args);
  } else if (args.remote) {
    // Run somewhere else, and watch from here
    if (!args.env) {
      exitWithError('No environment specified. Use --env <environment>');
      return;
    }
    if (!args.file && args.view === null) {
      exitWithError('Name what to run on the agent: --file <path-to-flow-file> or --view <view>');
      return;
    }

    await runRemote(args);
  } else if (args.view !== null) {
    // Run a whole view: every flow its filters match
    if (!args.env) {
      exitWithError('No environment specified. Use --env <environment>');
      return;
    }

    await runView({ view: args.view, folder: args.folder, env: args.env });
  } else if (args.file) {
    // For file mode, environment is required
    if (!args.env) {
      exitWithError('No environment specified. Use --env <environment>');
    }
    
    // Validate file path
    const flowFilePath = await validateFilePath(args.file);
    // Parse the flow file
    const flowContent = fs.readFileSync(flowFilePath, 'utf8');
    const flowConfig = parseFlowContent(flowContent);

    // Nothing is recorded, and no browser is opened, for a run that cannot
    // start: the environment has to exist, and each application this flow
    // uses -- only those -- has to have its env file for it
    const readiness = await applications.environmentReadiness(flowConfig.steps, args.env);
    const notReady = applications.readinessError(readiness);
    if (notReady) {
      exitWithError(notReady);
      return;
    }

    // Set up options
    const options: Record<string, any> = {
      environment: args.env,
      reporter: reporter.get({ cli: true, flow: null, server: null }),
      cli: true,
      debug: args.debug
    };

    // Every execution is recorded as a test run under the context's
    // test-runs folder, CLI runs included -- the copy with the results is
    // written when the runner finishes, even when the flow fails
    try {
      const file = await testRuns.copyFileName({ absolutePath: flowFilePath, title: flowConfig.title });
      const record = await testRuns.single({
        trigger: 'cli',
        environment: args.env,
        file,
        title: flowConfig.title,
        content: flowContent
      });
      options.onFinished = record.onFinished;
    } catch (error) {
      console.error(`Could not record the test run: ${error.message}`);
    }

    // Run the flow
    await runFlow(flowConfig, options);
  } else {
    // Nothing to run was named: whoever typed this came to look at the flows,
    // not to run one, so the UI is what they get
    await startServer(args);
  }
}

// Execute the main function
main().catch(error => {
  exitWithError(`Unhandled error: ${error.message}`);
});
