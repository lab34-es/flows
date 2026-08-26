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
 *   node cli.js --capabilities
 *   node cli.js --server
 *
 * Options:
 *   --file         Path to the flow definition file (.md)
 *   --context      Context directory
 *   --capabilities List all available capabilities from the contents of ~/flows
 *   --env          Environment to run the flow in (required for --file)
 *   --server       Start the web server with built frontend and API
 *   --debug        Print debug information including environment variables
 *   --help         Show this help message
 *
 * Flow generation with AI lives in the web UI (--server), where the provider,
 * model and API keys are configured.
 *
 * Examples:
 *   node cli.js --file flows/my-flow.md --env production
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
  lab34-flows --server [--context=<context>]

Options:
  --file          Path to the flow definition file (.md markdown flow) (required if not using --server)
  --capabilities  List all available capabilities from the contents of ~/flows
  --server        Start the web server with built frontend and API
  --env           Environment to run the flow in (required for --file)
  --context       Context directory for server mode (optional)
  --debug         Print debug information including environment variables
  --help          Show this help message

Generating flows with AI is done from the web UI (--server): the provider,
model and API keys are configured there, under Settings.

Examples:
  lab34-flows --context my/context/folder --file flows/my-flow.md --env production
  lab34-flows --context my/context/folder --capabilities
  lab34-flows --server --context=myproject
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
    ai: argv.ai || null, // Removed: kept only to show a helpful error
    capabilities: argv.capabilities || false,
    server: argv.server || false,
    env: argv.env || null,
    context: argv.context || null,
    debug: argv.debug || false,
    help: argv.help || false,
    v: argv.v || false
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

/**
 * Main function to execute the CLI
 */
async function main() {
  // Parse command line arguments
  const args = parseArguments();

  // Show version if requested
  if (args.v) {
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
    exitWithError('No flow source specified. Use either --file <path-to-flow-file> or --server');
  }
}

// Execute the main function
main().catch(error => {
  exitWithError(`Unhandled error: ${error.message}`);
});
