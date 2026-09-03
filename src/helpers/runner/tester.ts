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
 * Make sure all test applications are started.
 * @param {*} flow 
 */
export const getReady = async (flow) => {
  if (!flow.latentApplications) {
    flow.latentApplications = [];
  }

  let index = 0;
  for (const testApplication of flow.latentApplications) {
    const { application } = testApplication;
    flow.latentApplications[index].code = require(`../../latentApplications/${application}`);
    await flow.latentApplications[index].code.start(flow, testApplication);
    index++;
  }
};
