#!/usr/bin/env node

import * as paths from './helpers/paths';
import * as applications from './helpers/applications';

/**
 * Lab34 Flows CLI Tool
 * 
 * A command-line interface for running Markdown flow definitions.
 * 
 * Usage:
 *   node cli.js --file <path-to-flow-file> --env <environment> [--debug] [--help]
 *   node cli.js --view <view> --env <environment> [--folder <folder>]
 *   node cli.js --import-env <path-to-yaml> [--view <view> --env <environment>]
 *   node cli.js --capabilities
 *   node cli.js --server
 *   node cli.js --agent --agent-id <name> --broker <url> --username <user> --password <secret>
 *   node cli.js --remote <agent> --file <path> --env <environment>
 *
 * Options:
 *   --file         Path to the flow definition file (.md)
 *   --view         Name (or slug) of a view of views.yaml: every flow it
 *                  matches runs, in one test run
 *   --folder       Folder of the flows tree the view is scoped to
 *   --context      Context directory
 *   --import-env   Path of a YAML export of environment variables: its values
 *                  are written into the context's env files before anything
 *                  runs
 *   --dry-run      Report what --import-env would write, write nothing and run
 *                  nothing
 *   --capabilities List all available capabilities from the contents of ~/flows
 *   --env          Environment to run the flow in (required for --file/--view)
 *   --server       Start the web server with built frontend and API
 *   --agent        Run as an agent: wait on the broker for flows to run here
 *   --remote       Run --file or --view on the named agent instead of here
 *   --debug        Print debug information including environment variables
 *   --version      Print the installed version and exit
 *   --help         Show this help message
 *
 * Flow generation with AI lives in the web UI (--server), where the provider,
 * model and API keys are configured.
 *
 * Examples:
 *   node cli.js --file flows/my-flow.md --env production
 *   node cli.js --view smoke-tests --env production
 *   node cli.js --context my/context --import-env env.yaml --view smoke --env uat
 *   node cli.js --server
 */

// Disable HTTP/2 to avoid potential issues
process.env.NODE_NO_HTTP2 = '1';

// Core dependencies
import fs from 'fs';
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
Lab34 Flows CLI Tool v${packageJson.version}

Usage:
  lab34-flows --file <path-to-flow-file> --env <environment> [--debug] [--help]
  lab34-flows --view <view> --env <environment> [--folder <folder>]
  lab34-flows --import-env <path-to-yaml> [--view <view> --env <environment>]
  lab34-flows --server [--context=<context>]
  lab34-flows --agent --agent-id <name> [--broker <url> --username <user> --password <secret>]
  lab34-flows --remote <agent> --file <path-to-flow-file> --env <environment>
  lab34-flows --remote <agent> --view <view> --env <environment>

Options:
  --file          Path to the flow definition file (.md markdown flow) (required if not using --view or --server)
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
  --capabilities  List all available capabilities from the contents of ~/flows
  --server        Start the web server with built frontend and API
  --env           Environment to run the flow in (required for --file and --view)
  --context       Context directory (optional)
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
  --provider      Kind of broker: "generic" (any MQTT 5 broker, the default)
                  or "aws-iot" (AWS IoT Core: certificate auth, ALPN on 443,
                  messages split under its 128 KB limit)
  --cert, --key   PEM files of the client certificate and its key, for a
                  broker that authenticates with one. --ca names the CA to
                  trust when it is not in the system store
  --debug         Print debug information including environment variables
  --version, -v   Print the installed version and exit
  --help          Show this help message

Generating flows with AI is done from the web UI (--server): the provider,
model and API keys are configured there, under Settings.

Examples:
  lab34-flows --context my/context/folder --file flows/my-flow.md --env production
  lab34-flows --context my/context/folder --view all-flows --env production
  lab34-flows --context my/context/folder --view smoke --folder payments --env staging
  lab34-flows --context my/context/folder --import-env ~/Downloads/env.yaml
  lab34-flows --context my/context/folder --import-env env.yaml --view smoke --env uat
  lab34-flows --context my/context/folder --import-env env.yaml --dry-run
  lab34-flows --context my/context/folder --capabilities
  lab34-flows --server --context=myproject
  lab34-flows --context ~/flows-agent --agent --agent-id agent-ourense --broker mqtts://mqtt.example:443 --username agent-ourense --password s3cret
  lab34-flows --remote agent-ourense --file flows/my-flow.md --env production
  lab34-flows --remote agent-ourense --view smoke --env uat
  lab34-flows --agent --agent-id agent-ourense --provider aws-iot --broker mqtts://xxxx-ats.iot.eu-west-1.amazonaws.com:443 --cert agent.pem.crt --key agent.pem.key
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
  return {
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
    server: argv.server || false,
    // Remote execution: this machine as an agent, or a run sent to one
    agent: argv.agent || false,
    agentId: argv.agentId || argv['agent-id'] || null,
    remote: typeof argv.remote === 'string' ? argv.remote : null,
    broker: typeof argv.broker === 'string' ? argv.broker : null,
    username: typeof argv.username === 'string' ? argv.username : null,
    password: typeof argv.password === 'string' ? argv.password : null,
    provider: typeof argv.provider === 'string' ? argv.provider : null,
    cert: typeof argv.cert === 'string' ? argv.cert : null,
    key: typeof argv.key === 'string' ? argv.key : null,
    ca: typeof argv.ca === 'string' ? argv.ca : null,
    env: argv.env || null,
    context: argv.context || null,
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
 * The UI is built ahead of time and shipped inside the package, so this only
 * has to boot the API that serves it. Rebuilding from here would need the
 * project sources and a working directory that has them, neither of which an
 * installed copy of the tool can count on.
 */
async function startServer() {
  console.log('Starting server...');

  const api = require('./api');
  await api.start();
}

/** The broker flags, as brokerSettings takes them. Null means "not typed". */
const brokerFlags = (args) => ({
  url: args.broker || undefined,
  username: args.username || undefined,
  password: args.password || undefined,
  provider: args.provider || undefined,
  cert: args.cert || undefined,
  key: args.key || undefined,
  ca: args.ca || undefined
});

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
    settings = await remoteConfig.brokerSettings(brokerFlags(args));
  }
  catch (error) {
    exitWithError(error.message);
    return;
  }

  await bootstrap.ensureTypeScriptConfig();
  await applications.loadAll();

  console.log(`Agent:       ${identity.id}`);
  console.log(`Broker:      ${settings.url}${settings.username ? ` as ${settings.username}` : ''}` +
    `${settings.provider === 'aws-iot' ? ' (AWS IoT Core)' : ''}${settings.tls && settings.tls.cert ? ' with certificate' : ''}`);
  console.log(`Context:     ${await paths.contextRoot()}`);
  console.log(`Public key:  ${identity.publicKey}`);
  console.log(`Fingerprint: ${identity.fingerprint}`);

  let connection;
  try {
    connection = await brokerHelper.connect(remoteConfig.connectOptions(settings, {
      clientId: `flows-agent-${identity.id}`,
      will: agent.will(identity.id)
    }));
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

  if (args.broker || args.username || args.password || args.provider || args.cert || args.key || args.ca) {
    try {
      await remoteConfig.brokerSettings(brokerFlags(args));
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

  // --dry-run belongs to the import, not to the flows: on its own it would
  // read as "run nothing", which is not something this CLI offers
  if (args.dryRun && !args.importEnv) {
    exitWithError('--dry-run only applies to --import-env: pass the document you want previewed');
    return;
  }

  // Variables first: a flow is refused before it starts when an application it
  // uses has no env file for the environment, so the document has to be on
  // disk by the time that is checked
  if (args.importEnv) {
    if (!await importEnvironment({ file: args.importEnv, dryRun: args.dryRun })) { return; }

    // A document on its own is an import and nothing else, and a preview stops
    // before it could run anything
    const runs = Boolean(args.file) || args.view !== null || args.server || args.capabilities;

    if (args.dryRun || !runs) {
      process.exit(0);
      return;
    }
  }

  // Check if we're using the server or a file
  if (args.ai) {
    exitWithError(
      'Generating flows with AI is no longer available from the CLI. ' +
      'Start the UI with "lab34-flows --server" and use the "Create using AI" ' +
      'option when creating a flow.'
    );
  } else if (args.capabilities) {
    // List capabilities
    await flows.listCapabilities();
    process.exit(0);
  } else if (args.server) {
    // Start the web server
    await startServer();
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
    exitWithError('No flow source specified. Use --file <path-to-flow-file>, --view <view> or --server');
  }
}

// Execute the main function
main().catch(error => {
  exitWithError(`Unhandled error: ${error.message}`);
});
