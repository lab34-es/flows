import fs from 'fs';
import dotenv from 'dotenv';

import * as latent from '../latent';
import * as paths from '../paths';

/**
 * Compares the expected status with the actual status.
 *
 * @param {number|number[]} expected - The expected status or list of possible statuses.
 * @param {number} actual - The actual status to compare.
 * @returns {Object[]} - Returns an array of error objects if the statuses do not match, otherwise an empty array.
 */
const status = (expected, actual) => {
  const errors: Record<string, any>[] = [];

  // Ensure expected is an array of statuses
  expected = Array.isArray(expected) ? expected : [expected];
  
  // Check if the actual status is one of the expected statuses
  if (!expected.includes(actual)) {
    errors.push({
      message: 'Expected status does not match actual status',
      expected,
      actual
    });
  }

  return errors;
};

/**
 * Evaluates a JavaScript expression against a value.
 *
 * A `test` block is not templated -- `{{ memory.barcode }}` written in one is
 * compared as the eleven characters it is -- so an assertion against
 * something an earlier step remembered has to be an expression. `memory` and
 * `flow` are therefore in scope alongside `value`, which is what lets a step
 * say `$expr: value === memory.barcode`.
 *
 * @param {string} expr - JavaScript expression to evaluate.
 * @param {any} value - The actual value to test against.
 * @param {Object} [flow] - The flow, for its memory.
 * @returns {boolean} - Returns true if the expression evaluates to true, otherwise false.
 */
const evaluateExpression = (expr, value, flow?) => {
  try {
    // Using Function constructor to create a safe evaluation environment
    const func = new Function('value', 'memory', 'flow', `return ${expr}`);
    return func(value, flow?.memory || {}, flow || {});
  } catch (error) {
    console.error(`Error evaluating expression: ${expr}`, error);
    return false;
  }
};

/**
 * Determines if a value is a JavaScript expression test.
 * 
 * @param {any} value - The value to check.
 * @returns {boolean} - Returns true if the value is an expression test.
 */
const isExpressionTest = (value) => {
  return typeof value === 'string' && value.startsWith('$expr:');
};

/**
 * Compares the expected body with the actual body.
 *
 * @param {Object} expected - The expected body object.
 * @param {Object} actual - The actual body object to compare.
 * @param {Object} [flow] - The flow, so an expression can read its memory.
 * @returns {Object[]} - Returns an array of error objects if the bodies do not match, otherwise an empty array.
 */
const body = (expected, actual, flow?) => {
  const errors: Record<string, any>[] = [];

  // Check if we need to do deep comparison or expression evaluation
  const processObjectOrExpression = (expected, actual, path = '') => {
    // If the expected value is a JavaScript expression
    if (isExpressionTest(expected)) {
      const expression = expected.substring(6); // Remove '$expr:' prefix
      const result = evaluateExpression(expression, actual, flow);
      
      if (!result) {
        errors.push({
          message: `Expression evaluation failed at ${path}`,
          expression: expression,
          actualValue: actual
        });
      }
      return;
    }
    
    // If both are objects (not null), do deep comparison
    if (typeof expected === 'object' && expected !== null && 
        typeof actual === 'object' && actual !== null) {
      
      const expectedKeys = Object.keys(expected);
      
      for (const key of expectedKeys) {
        const newPath = path ? `${path}.${key}` : key;
        
        if (!(key in actual)) {
          errors.push({
            message: `Missing key '${newPath}' in actual object`,
            expected: expected[key],
            actual: undefined
          });
          continue;
        }
        
        processObjectOrExpression(expected[key], actual[key], newPath);
      }
    }
    // Otherwise do direct comparison
    else if (expected !== actual) {
      errors.push({
        message: `Value mismatch at ${path}`,
        expected,
        actual
      });
    }
  };
  
  processObjectOrExpression(expected, actual);
  
  return errors;
};

/**
 * The outcome of running a step's assertions: `hasErrors` plus one entry per
 * aspect that was actually asserted on ('status', 'body', 'latentApplications'),
 * each holding that aspect's errors.
 */
export interface TestReport extends Record<string, any> {
  hasErrors: boolean;
}

export const test = async (flow, test, contents): Promise<TestReport> => {
  const cases: Record<string, any[]> = {};

  if (test.status) {
    cases.status = status(test.status, contents.status);
  }

  if (test.body) {
    cases.body = body(test.body, contents.body, flow);
  }

  if (test.latentApplications && test.latentApplications.length) {
    cases.latentApplications = [];

    await Promise.all(test.latentApplications.map(async (testApplication) => {
      const { application } = testApplication;
      const testApplicationCode = flow.latentApplications.find(app => app.application === application).code;
      const errors = await testApplicationCode.test(flow, testApplication, contents);

      // An empty list is what a latent application reports when everything it
      // was asked about arrived. Recording it would put an entry in the
      // report, and `hasErrors` counts entries -- which is what used to fail
      // every step that asserted on a latent application, however well it had
      // gone.
      if (errors && errors.length) {
        cases.latentApplications.push({
          application,
          errors
        });
      }
    }));
  }

  // Normal cases with errors?
  const hasErrors = Object.values(cases).some(c => c.length > 0);

  return {
    hasErrors,
    ...cases
  };
};

/**
 * The env file a listener reads its connection from, for the environment the
 * flow runs against.
 *
 * @param {Object} testApplication - The frontmatter entry.
 * @param {string} source - The application named by its `connection`.
 * @param {string} [environment]
 * @returns {Promise<Object>} The parsed env file.
 * @throws {Error} Before the first step, when there is no such file.
 */
const environmentOf = async (testApplication, source: string, environment?: string) => {
  const { application, client } = testApplication;
  const relative = `applications/${source}/env/${environment || '<environment>'}.env`;
  const file = environment
    ? await paths.contextDir(['applications', source, 'env', `${environment}.env`])
    : null;

  if (!file || !fs.existsSync(file)) {
    throw new Error(
      `The ${application} client '${client}' connects the way '${source}' does, ` +
      `but ${relative} does not exist`
    );
  }

  return dotenv.parse(fs.readFileSync(file));
};

/**
 * Make sure all test applications are started.
 *
 * A listener whose `connection` names an application gets that application's
 * env file for this environment as `env`, which is where it reads its broker
 * and its credentials from -- see `latent.connectionSource`.
 *
 * @param {*} flow
 * @param {string} [environment] - What the flow runs against.
 */
export const getReady = async (flow, environment?: string) => {
  if (!flow.latentApplications) {
    flow.latentApplications = [];
  }

  let index = 0;
  for (const testApplication of flow.latentApplications) {
    const { application } = testApplication;
    const source = latent.connectionSource(testApplication.connection);

    if (source) {
      testApplication.env = await environmentOf(testApplication, source, environment);
    }

    flow.latentApplications[index].code = require(`../../latentApplications/${application}`);
    await flow.latentApplications[index].code.start(flow, testApplication);
    index++;
  }
};

/**
 * Stop every latent application the flow started.
 *
 * A listener belongs to the run that declared it. Left connected, it would
 * keep a Kafka consumer in its group and an MQTT client subscribed after the
 * flow was over -- and the next run declaring the same client would be handed
 * it back, subscriptions, messages and all, so a message the previous run
 * caused could pass an assertion of this one.
 *
 * Never throws: it runs whether the flow passed or failed, and what went wrong
 * with the flow is what the run has to report, not a listener that would not
 * hang up.
 *
 * @param {*} flow
 */
export const shutdown = async (flow) => {
  for (const latent of flow.latentApplications || []) {
    if (!latent.code || typeof latent.code.stop !== 'function') {
      continue;
    }

    try {
      await latent.code.stop(latent.client);
    } catch (error) {
      console.error(`Could not stop the ${latent.application} client '${latent.client}':`, error);
    }
  }
};
