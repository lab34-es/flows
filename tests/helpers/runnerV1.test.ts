jest.mock('yargs-parser', () => () => ({}));
jest.mock('../../src/helpers/paths');
jest.mock('../../src/helpers/mimicing');
jest.mock('../../src/helpers/runner/tester');

// The runner closes the browser sessions a flow left open; the real helper
// would pull playwright itself in for a suite that never opens a browser.
jest.mock('../../src/helpers/playwright', () => ({
  closeSessions: jest.fn().mockResolvedValue([])
}));

// run() builds its own reporter and assigns it onto the flow, so the recorder
// has to come from the module rather than from the flow we pass in.
jest.mock('../../src/helpers/reporter', () => {
  const recorder = {
    server: { emit: jest.fn() },
    stepStart: jest.fn(),
    stepUpdate: jest.fn(),
    execution: jest.fn(),
    diagram: jest.fn(),
    response: jest.fn(),
    test: jest.fn(),
    mimicStart: jest.fn()
  };
  return { get: () => recorder, __recorder: recorder };
});

import fs from 'fs';

import * as paths from '../../src/helpers/paths';
import * as mimicing from '../../src/helpers/mimicing';
import * as tester from '../../src/helpers/runner/tester';
import * as apps from '../../src/helpers/applications';
import * as reporterHelper from '../../src/helpers/reporter';
import * as playwright from '../../src/helpers/playwright';
import * as v1 from '../../src/helpers/runner/v1';

const recorder = (reporterHelper as any).__recorder;

let calculatorAdd: jest.Mock;

/** The runner decorates the flow in place (execution, memory, per-step data). */
const flowWith = (...steps: any[]): Record<string, any> => ({ steps });

/** Run a flow through the CLI path, which awaits the processor. */
const runCli = (flow: any, opts: any = {}) =>
  v1.run(flow, { environment: 'local', cli: true, reporter: { server: null }, ...opts });

beforeEach(() => {
  jest.clearAllMocks();

  calculatorAdd = jest.fn().mockResolvedValue([{ 'content-type': 'json' }, 200, { sum: 3 }, { last: 3 }]);
  apps.applications.calculator = { add: calculatorAdd };

  // What a flow needs before it can start is the applications helper's job,
  // and has its own tests on a real context directory: here every
  // application the flow uses has its env file, on a known environment
  jest.spyOn(apps, 'environmentReadiness').mockImplementation(async (steps, environment) => {
    const environments = ['local', 'prod'];
    return {
      environment,
      environments,
      known: environments.includes(environment),
      applications: apps.applicationsOf(steps),
      missing: [],
      ready: environments.includes(environment)
    };
  });

  (paths.contextDir as jest.Mock).mockImplementation(async (parts: string[]) => `/ctx/${parts.join('/')}`);
  jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  jest.spyOn(fs, 'readFileSync').mockReturnValue('BASE_URL=http://x\n' as any);

  (mimicing.validate as jest.Mock).mockReturnValue(true);
  (mimicing.load as jest.Mock).mockResolvedValue({});
  (mimicing.startStep as jest.Mock).mockResolvedValue([]);
  (tester.getReady as jest.Mock).mockResolvedValue(undefined);
  (tester.test as jest.Mock).mockResolvedValue({ hasErrors: false });
});

afterEach(() => jest.restoreAllMocks());

describe('v1.run - happy path', () => {
  test('executes a step and records the response', async () => {
    const flow = flowWith({ application: 'calculator', method: 'add', parameters: { body: { a: 1 } } });

    const result: any = await runCli(flow);

    expect(calculatorAdd).toHaveBeenCalled();
    expect(result[0].response).toEqual({ headers: { 'content-type': 'json' }, status: 200, body: { sum: 3 } });
    expect(flow.execution.status).toBe('passed');
  });

  test('gives every step an id and reports the diagram', async () => {
    const flow = flowWith({ application: 'calculator', method: 'add' });
    await runCli(flow);

    expect(flow.steps[0].id).toBe('calculator-add');
    expect(recorder.diagram).toHaveBeenCalled();
  });

  test('a slug becomes the step id', async () => {
    const flow = flowWith({ slug: 'the-sum', application: 'calculator', method: 'add' });
    await runCli(flow);
    expect(flow.steps[0].id).toBe('the-sum');
  });

  test('repeated steps get suffixed ids', async () => {
    const flow = flowWith(
      { application: 'calculator', method: 'add' },
      { application: 'calculator', method: 'add' }
    );
    await runCli(flow);
    expect(flow.steps.map((s: any) => s.id)).toEqual(['calculator-add-0', 'calculator-add-1']);
  });

  test('waitForTime is part of the id', async () => {
    const flow = flowWith({ application: 'calculator', method: 'add', waitForTime: { time: 5 } });
    await runCli(flow);
    expect(flow.steps[0].id).toBe('calculator-add-waitForTime-5');
  });

  test('memory returned by a step is merged into the flow', async () => {
    const flow = flowWith({ application: 'calculator', method: 'add' });
    await runCli(flow);
    expect(flow.memory).toEqual({ last: 3 });
  });

  test('timings are recorded', async () => {
    const flow = flowWith({ application: 'calculator', method: 'add' });
    await runCli(flow);
    expect(flow.steps[0].execution.times.duration).toBeGreaterThanOrEqual(0);
  });

  test('mimicked applications are started for each step', async () => {
    const flow = flowWith({ application: 'calculator', method: 'add' });
    await runCli(flow);
    expect(mimicing.startStep).toHaveBeenCalled();
  });
});

describe('v1.run - what a step keeps in memory', () => {
  test('a mapping keeps a value the method only returned', async () => {
    const flow = flowWith({
      application: 'calculator',
      method: 'add',
      memory: { the_sum: '{{ body.sum }}' }
    });

    await runCli(flow);

    expect(flow.memory.the_sum).toBe(3);
  });

  test('a lone expression keeps the type it had', async () => {
    calculatorAdd.mockResolvedValue([{}, 200, { token: 'a.b=', count: 7 }, {}]);

    const flow = flowWith({
      application: 'calculator',
      method: 'add',
      memory: { token: '{{ body.token }}', count: '{{ body.count }}' }
    });

    await runCli(flow);

    // Rendered through Handlebars the '=' would arrive as '&#x3D;' and the
    // number as a string: a token has to survive the trip intact
    expect(flow.memory.token).toBe('a.b=');
    expect(flow.memory.count).toBe(7);
  });

  test('the status is in scope too', async () => {
    const flow = flowWith({
      application: 'calculator',
      method: 'add',
      memory: { code: '{{ status }}' }
    });

    await runCli(flow);

    expect(flow.memory.code).toBe(200);
  });

  test('a template that is more than one expression is rendered', async () => {
    const flow = flowWith({
      application: 'calculator',
      method: 'add',
      memory: { header: 'Bearer {{ body.sum }}' }
    });

    await runCli(flow);

    expect(flow.memory.header).toBe('Bearer 3');
  });

  test('an earlier step is in scope by its id', async () => {
    const flow = flowWith(
      { slug: 'first', application: 'calculator', method: 'add' },
      {
        slug: 'second',
        application: 'calculator',
        method: 'add',
        memory: { earlier: '{{ steps.first.response.body.sum }}' }
      }
    );

    await runCli(flow);

    expect(flow.memory.earlier).toBe(3);
  });

  test('the mapping has the last word over what the method returned', async () => {
    const flow = flowWith({
      application: 'calculator',
      method: 'add',
      memory: { last: '{{ body.sum }}' }
    });

    await runCli(flow);

    // The method returns `{ last: 3 }`; the flow renames the same value, and
    // what the flow said is what stands
    expect(flow.memory.last).toBe(3);
  });

  test('a value that resolves to nothing is not remembered', async () => {
    const flow = flowWith(
      { slug: 'first', application: 'calculator', method: 'add' },
      {
        slug: 'second',
        application: 'calculator',
        method: 'add',
        memory: { last: '{{ body.nothing }}' }
      }
    );

    await runCli(flow);

    // The earlier value stands rather than being shadowed by an empty one
    expect(flow.memory.last).toBe(3);
  });

  test('a literal is kept as it is written', async () => {
    const flow = flowWith({
      application: 'calculator',
      method: 'add',
      memory: { environment: 'local', attempts: 2 }
    });

    await runCli(flow);

    expect(flow.memory.environment).toBe('local');
    expect(flow.memory.attempts).toBe(2);
  });

  test('a step with no mapping changes nothing', async () => {
    const flow = flowWith({ application: 'calculator', method: 'add' });
    await runCli(flow);
    expect(flow.memory).toEqual({ last: 3 });
  });
});

describe('v1.run - environment validation', () => {
  test('an unknown environment fails the flow', async () => {
    const flow = flowWith({ application: 'calculator', method: 'add' });

    await runCli(flow, { environment: 'staging' });

    expect(flow.execution.status).toBe('error');
    expect(flow.execution.error.name).toBe('InvalidEnvironment');
  });

  test('a missing env file fails the flow before any step runs', async () => {
    (apps.environmentReadiness as jest.Mock).mockResolvedValue({
      environment: 'local',
      environments: ['local', 'prod'],
      known: true,
      applications: ['calculator'],
      missing: [{
        application: 'calculator',
        file: 'applications/calculator/env/local.env',
        path: '/ctx/applications/calculator/env/local.env',
        hasTemplate: false
      }],
      ready: false
    });
    const flow = flowWith({ application: 'calculator', method: 'add' });

    await runCli(flow);

    expect(flow.execution.error.name).toBe('MissingEnvironmentFile');
    expect(flow.execution.error.message).toContain('Missing environment file');
    expect(flow.execution.error.message).toContain('applications/calculator/env/local.env');
    expect(calculatorAdd).not.toHaveBeenCalled();
  });

  test('an unreadable env file fails the flow', async () => {
    (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('EACCES'); });
    const flow = flowWith({ application: 'calculator', method: 'add' });

    await runCli(flow);

    expect(flow.execution.error.name).toBe('EnvironmentSetupError');
  });

  test('the tester pseudo-application needs no env file', async () => {
    const flow = flowWith({ application: 'tester', method: 'noop' });
    await runCli(flow);
    expect(flow.execution.error.name).not.toBe('EnvironmentSetupError');
  });
});

describe('v1.run - failures', () => {
  test('an unknown method fails the step', async () => {
    const flow = flowWith({ application: 'calculator', method: 'divide' });

    await runCli(flow);

    expect(flow.steps[0].execution.status).toBe('error');
    expect(flow.steps[0].execution.error.message).toContain('Method not found: divide');
  });

  test('an unknown application fails the step', async () => {
    const flow = flowWith({ application: 'ghost', method: 'add' });
    await runCli(flow);
    expect(flow.steps[0].execution.status).toBe('error');
  });

  test('a throwing application method fails the step', async () => {
    calculatorAdd.mockRejectedValue(new Error('boom'));
    const flow = flowWith({ application: 'calculator', method: 'add' });

    await runCli(flow);

    expect(flow.steps[0].execution.error.message).toContain('boom');
  });

  test('an error with nothing in its own message still says what happened', async () => {
    // pg's answer to a refused connection: the message is empty and the two
    // attempts are in .errors. Reported as-is the UI showed an empty box.
    const refused: NodeJS.ErrnoException = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    refused.code = 'ECONNREFUSED';
    const aggregate: any = new AggregateError([refused], '');
    aggregate.code = 'ECONNREFUSED';
    calculatorAdd.mockRejectedValue(aggregate);

    const flow = flowWith({ application: 'calculator', method: 'add' });

    await runCli(flow);

    const { error } = flow.steps[0].execution;
    expect(error.name).toBe('AggregateError');
    expect(error.message).toContain('connect ECONNREFUSED 127.0.0.1:5432');
    expect(error.code).toBe('ECONNREFUSED');
    expect(error.causes[0].message).toBe('connect ECONNREFUSED 127.0.0.1:5432');
    expect(error.stack).toBeDefined();
    expect(flow.execution.error.message).toContain('connect ECONNREFUSED 127.0.0.1:5432');
  });

  test('what is reported to the UI survives being serialised', async () => {
    const looping: any = new Error('looping');
    looping.cause = looping;
    calculatorAdd.mockRejectedValue(looping);

    const flow = flowWith({ application: 'calculator', method: 'add' });

    await runCli(flow);

    expect(() => JSON.stringify(flow.steps[0].execution.error)).not.toThrow();
    expect(() => JSON.stringify(flow.execution.error)).not.toThrow();
  });
});

describe('v1.run - step retries', () => {
  test('an empty response is retried up to the configured number of times', async () => {
    calculatorAdd
      .mockResolvedValueOnce([null, null, null])
      .mockResolvedValueOnce([{}, 200, { sum: 3 }, {}]);

    const flow = flowWith({
      application: 'calculator', method: 'add', retry: { times: 2, delay: 0 }
    });

    await runCli(flow);

    expect(calculatorAdd).toHaveBeenCalledTimes(2);
    expect(flow.execution.status).toBe('passed');
  });

  test('running out of retries fails the step', async () => {
    calculatorAdd.mockResolvedValue([null, null, null]);
    const flow = flowWith({
      application: 'calculator', method: 'add', retry: { times: 1, delay: 0 }
    });

    await runCli(flow);

    expect(flow.steps[0].execution.error.message).toContain('max retries reached');
  });

  test('an empty response with no retry configuration simply passes through', async () => {
    calculatorAdd.mockResolvedValue([null, null, null]);
    const flow = flowWith({ application: 'calculator', method: 'add' });

    await runCli(flow);

    expect(calculatorAdd).toHaveBeenCalledTimes(1);
    expect(flow.execution.status).toBe('passed');
  });
});

describe('v1.run - test assertions', () => {
  test('a passing assertion marks the step passed', async () => {
    const flow = flowWith({ application: 'calculator', method: 'add', test: { status: 200 } });

    await runCli(flow);

    expect(tester.test).toHaveBeenCalled();
    expect(flow.steps[0].execution.status).toBe('passed');
  });

  test('a failing assertion fails the step', async () => {
    (tester.test as jest.Mock).mockResolvedValue({ hasErrors: true, status: [{}] });
    const flow = flowWith({ application: 'calculator', method: 'add', test: { status: 200 } });

    await runCli(flow);

    expect(flow.steps[0].execution.error.name).toBe('TestFailed');
  });

  test('a failing assertion is retried when the test asks for it', async () => {
    (tester.test as jest.Mock)
      .mockResolvedValueOnce({ hasErrors: true })
      .mockResolvedValue({ hasErrors: false });

    const flow = flowWith({
      application: 'calculator', method: 'add',
      test: { status: 200, retry: { times: 2, delay: 0 } }
    });

    await runCli(flow);

    expect(tester.test).toHaveBeenCalledTimes(2);
    expect(flow.execution.status).toBe('passed');
  });

  test('the retry delay defaults to a second', async () => {
    (tester.test as jest.Mock).mockResolvedValue({ hasErrors: true });
    const test = { status: 200, retry: { times: 1 } } as any;
    const flow = flowWith({ application: 'calculator', method: 'add', test });

    jest.useFakeTimers();
    const pending = runCli(flow);
    await jest.advanceTimersByTimeAsync(2000);
    await pending;
    jest.useRealTimers();

    expect(test.retry.delay).toBe(1000);
  });

  test('a retry count that is not a positive number is rejected', async () => {
    (tester.test as jest.Mock).mockResolvedValue({ hasErrors: true });
    const flow = flowWith({
      application: 'calculator', method: 'add',
      test: { status: 200, retry: { times: 0 } }
    });

    await runCli(flow);

    expect(flow.steps[0].execution.error.message).toContain('times must be a number');
  });

  test('a negative retry delay is rejected', async () => {
    (tester.test as jest.Mock).mockResolvedValue({ hasErrors: true });
    const flow = flowWith({
      application: 'calculator', method: 'add',
      test: { status: 200, retry: { times: 1, delay: -5 } }
    });

    await runCli(flow);

    expect(flow.steps[0].execution.error.message).toContain('delay must be a number');
  });
});

describe('v1.run - mimic validation', () => {
  test('an invalid mimic configuration fails the flow', async () => {
    (mimicing.validate as jest.Mock).mockReturnValue(false);
    const flow = flowWith({ application: 'calculator', method: 'add' });

    await runCli(flow);

    expect(flow.execution.error.name).toBe('InvalidMimic');
  });
});

describe('v1.run - concurrency and API mode', () => {
  test('the API path answers immediately with the execution handle', async () => {
    const flow = flowWith({ application: 'calculator', method: 'add' });

    const result: any = await v1.run(flow, {
      environment: 'local', cli: false, reporter: { server: null }
    });

    expect(result).toEqual({ execution: expect.objectContaining({ id: expect.any(String), status: 'running' }) });
  });

  test('a second flow is refused while one is running', async () => {
    const slow = jest.fn(() => new Promise(resolve => setTimeout(
      () => resolve([{}, 200, {}, {}]), 50
    )));
    apps.applications.calculator = { add: slow };

    const first = runCli(flowWith({ application: 'calculator', method: 'add' }));
    const second = await runCli(flowWith({ application: 'calculator', method: 'add' }));

    expect(second).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('Already running');

    await first;
  });

  test('the lock is released once a flow finishes', async () => {
    await runCli(flowWith({ application: 'calculator', method: 'add' }));
    const second: any = await runCli(flowWith({ application: 'calculator', method: 'add' }));
    expect(second).toBeDefined();
  });
});

describe('v1.run - browser sessions', () => {
  test('the step tells the application which session it runs in', async () => {
    await runCli(flowWith({
      application: 'calculator',
      method: 'add',
      session: 'shop',
      closeSession: true
    }));

    expect(calculatorAdd).toHaveBeenCalledWith(
      expect.objectContaining({ session: 'shop', closeSession: true }),
      expect.anything(),
      expect.anything()
    );
  });

  test('a step that names no session says so', async () => {
    await runCli(flowWith({ application: 'calculator', method: 'add' }));

    expect(calculatorAdd.mock.calls[0][0].session).toBeUndefined();
  });

  test('whatever the flow left open is closed when it ends', async () => {
    await runCli(flowWith({ application: 'calculator', method: 'add', session: 'shop' }));

    expect(playwright.closeSessions).toHaveBeenCalled();
  });

  test('a flow that failed still closes its sessions', async () => {
    calculatorAdd.mockRejectedValue(new Error('nope'));

    await runCli(flowWith({ application: 'calculator', method: 'add', session: 'shop' }))
      .catch(() => {});

    expect(playwright.closeSessions).toHaveBeenCalled();
  });
});
