import 'colors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

import fs from 'fs';

import * as mimicing from '../mimicing';
import * as apps from '../applications'; 
import * as replacer from '../replacer';
import * as tester from './tester';
import * as paths from '../paths';
import * as reporterHelper from '../reporter';
import * as errors from '../errors';
import * as inputs from '../inputs';
import * as playwright from '../playwright';

let steps: Record<string, any>[] = [];
const applications = apps.applications;

let mimicdApplications = {};
const appsCtx = {};

let running = false;

const buildSteps = (steps) => {
  // Add "id" property to each step with "applciation.method" as the value
  steps = steps.map((step, _index) => {
    if (typeof step === 'string') {return { method: step, id: `${step}` };}
    if (step.slug) {return { ...step, id: step.slug };}

    const stepIdParts = [
      step.application,
      step.method,
      step.waitForTime ? 'waitForTime' : '',
      step.waitForTime ? step.waitForTime.time || '?' : ''
    ];

    return { ...step, id: stepIdParts.filter(Boolean).join('-') };
  });

  // ids must be unique. If one is not unique, add a number to it
  const ids = steps.map(step => step.id);
  const uniqueIds = [...new Set(ids)];
  
  if (ids.length !== uniqueIds.length) {
    steps = steps.map((step, index) => {
      if (ids.filter(id => id === step.id).length === 1) {return step;}
      return { ...step, id: `${step.id}-${index}` };
    });
  }

  // Just for better visuals in the UI...
  // Move id to the first position of the object
  steps = steps.map(step => {
    const { id, ...rest } = step;
    return { id, ...rest };
  });

  return steps;
};

const buildData = (data, flow) => {
  if (!data) {return {};}

  // Convert each step into a property in a json object
  const stepData = flow.steps.reduce((acc, step) => {
    acc[step.id] = step;
    return acc;
  }, {});

  data = replacer.json(JSON.stringify(data), { steps: stepData, memory: flow.memory || {} });

  return data;
};

const executeStep = async (flow, step, attemptNumber = 0) => {
  const { application, method, parameters } = step;

  const stepIndex = flow.steps.findIndex(s => s.id === step.id);
  
  const params = buildData(parameters, flow);

  // ATTENTION! we might retry the step!!! Meaning that the line above 
  // (buildData) must NOT be executed multiple times. Otherwise, we'll
  // endup replacing handlebars markers multiple times.
  //
  // Example: is test have {{ randomBarcode247 }}, it will endup
  // using a different barcode on every retry. This is not what we want!
  // Instead, once the data is built, we must ensure it's kept in the flow,
  // so the next execution attempts it uses the same data.

  flow.steps[stepIndex].parameters = params;

  const [headers, status, body, memory] = await applications[application][method](
    {
      ...appsCtx[application],
      reporter: flow.reporter,
      // Which step is running, for helpers that report against it -- an
      // input request has to appear under the step that asked for it
      stepId: step.id,
      // Which browser session the step browses in, and whether it is the one
      // that ends it. Both are the step's own keys, passed through untouched
      // so an application only has to hand its context to `playwright.run`
      session: step.session,
      closeSession: step.closeSession
    },
    params,
    flow
  );

  // Is the response empty?
  if (!headers && !status && !body) {
    // Ooops!!! Maybe... we've to retry?
    const { retry } = step;

    // Yes, we've to retry.
    if (retry) {
      flow.steps[stepIndex].execution.attempt = attemptNumber + 1;
      flow.reporter.stepUpdate(step.id);

      // Let's retry then.
      // How many times? What's the delay?
      const { times, delay } = retry;

      // Let's retry as many times as we've to
      if (attemptNumber < times) {
        // Let's wait for the delay
        if (delay) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Let's retry
        return executeStep(flow, step, attemptNumber + 1);
      }
      else {
        throw new Error('max retries reached');
      }
    }
  }

  return [params, headers, status, body, memory];
};

const processor = async (flow, opts) => {
  try {
    const { environment } = opts;

    steps = flow.steps;

    // Everything this flow needs, checked before a single step runs: a known
    // environment, and an env file in each application the flow uses. The
    // applications it does not use are not looked at.
    const readiness = await apps.environmentReadiness(steps, environment);

    if (!readiness.known) {
      flow.execution.status = 'error';
      flow.execution.error = {
        name: 'InvalidEnvironment',
        message: apps.readinessError(readiness),
        code: 2
      };
      flow.reporter.execution();
      throw flow.execution.error;
    }

    if (readiness.missing.length) {
      flow.execution.status = 'error';
      flow.execution.error = {
        name: 'MissingEnvironmentFile',
        message: apps.readinessError(readiness),
        code: 3,
        details: { environment, missing: readiness.missing.map(item => item.file) }
      };
      flow.reporter.execution();
      throw flow.execution.error;
    }

    // Load environment variables for each application
    for (const application of readiness.applications) {
      try {
        const applicationPath = await paths.contextDir(['applications', application]);
        const envFile = await paths.contextDir(['applications', application, 'env', `${environment}.env`]);

        appsCtx[application] = {
          name: application,
          path: applicationPath,
          env: dotenv.parse(fs.readFileSync(envFile))
        };
      } catch (err) {
        flow.execution.status = 'error';
        flow.execution.error = {
          name: 'EnvironmentSetupError',
          message: `Error setting up environment for ${application}: ${err.message}`,
          code: 6,
          originalError: errors.describe(err)
        };
        flow.reporter.execution();
        throw flow.execution.error;
      }
    }

    if (!mimicing.validate(steps)) {
      flow.execution.status = 'error';
      flow.execution.error = {
        name: 'InvalidMimic',
        message: 'Invalid mimic configuration',
        code: 5
      };
      flow.reporter.execution();
      throw flow.execution.error;
    }

    mimicdApplications = await mimicing.load(steps);

    await tester.getReady(flow);

    // Add an "id" to each step
    flow.steps = buildSteps(steps);

    // Send the diagram to the client, so the flow can be visualized
    flow.reporter.diagram();

    // Use a for loop with index as the control variable instead of for...of
    // This allows us to control which step to execute next
    for (let i = 0; i < flow.steps.length; i++) {
      console.log('');
      
      const step = flow.steps[i];

      try {
        // Execute the method and log the result. Pass each property in step.data as a separate argument.
        const { application, method, test, testlatentApplications, id } = step;
        let { parameters } = step;
        if (!parameters) {parameters = {};}

        // Prepare holder for execution information
        // If the execution object already exists (due to a retry), preserve the attempt number
        const existingAttempt = flow.steps[i].execution?.attempt || 0;
        
        flow.steps[i].execution = {
          times: {},
          attempt: existingAttempt // Preserve the attempt number
        };
        flow.steps[i].execution.status = 'running';
        flow.steps[i].execution.times.start = Date.now();

        flow.reporter.stepStart(id);
        flow.reporter.stepUpdate(id);

        // Wait for all mimic'd applications to start
        await mimicing.startStep(mimicdApplications, step, flow);
        
        const methodExists = applications[application] && applications[application][method];

        if (!methodExists) {
          throw new Error(`Method not found: ${method} in ${application}`);
        }

        const [request, headers, status, body, memory] = await executeStep(flow, step);

        flow.steps[i].execution.times.end = Date.now();
        flow.steps[i].execution.times.duration =
          (flow.steps[i].execution.times.end - flow.steps[i].execution.times.start) / 1000;
        flow.reporter.stepUpdate(id);

        flow.memory = Object.assign(flow.memory || {}, memory || {});

        flow.steps[i].request = request;
        flow.steps[i].response = { headers, status, body };
        flow.reporter.response({ headers, status, body }, {
          timing: flow.steps[i].execution.times.duration
        });

        if (test || testlatentApplications) {
          const testReport = await tester.test(flow, test, { headers, status, body });

          flow.steps[i].testReport = testReport;
          flow.reporter.test(testReport);

          if (testReport.hasErrors) {
            // Check if there's a retry configuration in the test parameter
            if (test.retry && typeof test.retry === 'object') {

              // test.times must be a number
              if (typeof test.retry.times !== 'number' || test.retry.times < 1) {
                throw new Error('Invalid retry configuration: times must be a number greater than 0');
              }

              // test.delay defaults to 1000 if not set
              if (!test.retry.delay) {
                test.retry.delay = 1000;
              }

              // test.delay must be a number
              if (typeof test.retry.delay !== 'number' || test.retry.delay < 0) {
                throw new Error('Invalid retry configuration: delay must be a number greater than or equal to 0');
              }
              
              // Get the current attempt number or initialize it
              const attemptNumber = flow.steps[i].execution.attempt || 0;
              
              // Update the attempt number
              flow.steps[i].execution.attempt = attemptNumber + 1;
              flow.reporter.stepUpdate(id);
              
              // Check if we should retry
              if (attemptNumber < test.retry.times) {
                console.log(`Test failed for step ${step.id}. Retrying (${attemptNumber + 1}/${test.retry.times})...`);
                
                // Wait for the specified delay
                await new Promise(resolve => setTimeout(resolve, test.retry.delay));
                
                // Retry the step by decrementing i so the same step is executed again in the next iteration
                i--; // This is the key change - we decrement i instead of index
                continue; // Skip to the next iteration of the loop
              }
            }
            
            // If no retry configuration or max retries reached, fail the step
            flow.steps[i].execution.status = 'failed';
            flow.steps[i].execution.error = {
              name: 'TestFailed',
              message: `Test failed for step ${step.id}`,
              stepId: step.id,
              code: 4
            };
            flow.reporter.stepUpdate(id);
            throw flow.steps[i].execution.error;
          }
          else {
            flow.steps[i].execution.status = 'passed';
          }
        }
        else {
          flow.steps[i].execution.status = 'passed';
        }
        flow.reporter.stepUpdate(id);
      } catch (stepError) {
        
        // Uncomment this for extra debugging
        console.error(stepError);

        // The terminal gets the error as it was thrown; the UI only gets what
        // is put on the step. Flattening it here is what keeps the two saying
        // the same thing -- plenty of errors (an AggregateError from a
        // refused database connection, say) have an empty message and hold
        // everything worth reading in their causes.
        const described = errors.describe(stepError);

        // A step that failed before its execution holder was set would
        // otherwise fail again here, hiding the error that actually happened
        if (!flow.steps[i].execution) {
          flow.steps[i].execution = { times: {}, attempt: 0 };
        }

        flow.steps[i].execution.status = 'error';
        
        flow.steps[i].execution.error = {
          ...described,
          name: described.name || 'StepExecutionError',
          message: `Error executing step ${step.id}: ${errors.summarize(described)}`,
          code: described.code ?? 7,
          stepId: step.id
        };
        flow.reporter.stepUpdate(step.id);
        throw flow.steps[i].execution.error;
      }
    }

    flow.execution.status = 'passed';
    flow.execution.times.end = Date.now();
    flow.execution.times.duration = flow.execution.times.end - flow.execution.times.start;
    flow.reporter.execution();

    return flow.steps;
  } catch (error) {
    console.error(error);
    // Ensure the flow execution status is set to error
    if (flow.execution) {
      flow.execution.status = 'error';
      if (!flow.execution.error) {
        const described = errors.describe(error);
        flow.execution.error = {
          ...described,
          name: described.name || 'ProcessorError',
          message: errors.summarize(described),
          code: described.code ?? 1
        };
      }
    }

    // Report the error if we have a reporter
    if (flow.reporter && typeof flow.reporter.execution === 'function') {
      flow.reporter.execution();
    }

    // The caller decides what a failure means: the CLI exits with it, the
    // API path swallows it -- but both only after the run was recorded
    throw error;
  }
};

/**
 * Run the flow
 * @param {*} flow
 * @param {Object} opts
 * @param {String} opts.environment
 * @param {Boolean} opts.cli
 * @param {Boolean} [opts.exitOnFailure] - false to hand a failure back to the
 *                   caller instead of exiting the process, which is what a
 *                   CLI run of several flows needs
 * @param {Function} [opts.onFinished] - Called exactly once when the run is
 *                   over (passed or failed), with the executed flow. This is
 *                   how test runs get recorded, so it runs after the lock is
 *                   released -- a caller chaining flows can start the next one
 *                   from inside it.
 * @param {Function} release - Called when the flow finishes, to free the
 *                             single-run lock
 */
const run = async (flow, opts, release) => {
  const executionId = uuidv4();

  const { cli } = opts;

  // Now that we've all details, prepare the reporter appropiately
  const { server } = opts.reporter;
  flow.reporter = reporterHelper.get({ flow, cli, server });

  // Initialize basis of execution information
  flow.execution = {
    id: executionId,
    status: 'running',
    times: {
      start: Date.now()
    }
  };

  // Report it
  flow.reporter.execution();

  // Recording must never take the run down with it
  const settle = async () => {
    if (typeof opts.onFinished !== 'function') { return; }
    try {
      await opts.onFinished(flow);
    }
    catch (ex) {
      console.error('Error recording the finished flow:', ex);
    }
  };

  // API request must reply with basic execution information; the processor
  // keeps running in the background and frees the lock when it finishes
  if (!cli) {
    Promise.resolve()
      .then(() => processor(flow, opts))
      .catch(() => {})
      .finally(() => {
        release();
        return settle();
      });
    return { execution: flow.execution };
  }

  // Invokations based on CLI must wait for processor to complete
  try {
    const result = await processor(flow, opts);
    release();
    await settle();
    return result;
  }
  catch {
    release();
    await settle();

    // A caller running several flows in a row (`--view`) asks to stay alive:
    // it reads the run summary and decides the exit code once every flow is
    // in. On its own, a CLI run exits with the failure -- but only now that
    // the run is on disk
    if (opts.exitOnFailure === false) {
      return { execution: flow.execution };
    }

    process.exit(1);
  }
};

/**
 * Run a flow, guarding against concurrent executions.
 *
 * Only one flow can run at a time: the runner and the reporter keep
 * module-level state, so concurrent runs would cross-wire.
 */
const runExclusive = async (flow, opts) => {
  if (running) {
    console.error('Already running');
    return;
  }
  running = true;

  const release = () => {
    // A request nobody answered must not outlive the run that made it: the
    // step waiting on it is gone, and the UI would keep offering the field
    inputs.cancelAll('The flow finished before the input was answered');

    // Neither must a browser: a session stays open from step to step, and the
    // flow ending is what it was staying open for. Sessions opened with
    // keepOpen are the exception -- they were asked to outlive the run.
    playwright.closeSessions().catch(ex => console.error('Could not close the browser sessions:', ex));

    running = false;
  };

  try {
    return await run(flow, opts, release);
  }
  catch (ex) {
    release();
    throw ex;
  }
};

/**
 * Whether a flow is being run right now. Callers that would create state for
 * a run (a test-run folder, say) check this first instead of finding out
 * from a refused start.
 * @returns {boolean}
 */
const isRunning = () => running;

export { steps, runExclusive as run, isRunning };
