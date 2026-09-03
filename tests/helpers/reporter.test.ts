jest.mock('yargs-parser', () => () => ({}));

import * as reporterHelper from '../../src/helpers/reporter';

// The reporter colours its output; strip the escape codes so assertions can
// match on the text itself.
// eslint-disable-next-line no-control-regex -- matching ANSI escapes is the point
const ANSI = /\u001b\[[0-9;]*m/g;

/** Everything the reporter printed, decoloured, as one string. */
const printed = () => (console.log as jest.Mock).mock.calls
  .map(c => c.join(' '))
  .join('\n')
  .replace(ANSI, '');

const flowFixture = () => ({
  execution: { id: 'exec-1', status: 'running' },
  steps: [
    { id: 'add-numbers', application: 'myCalculator', description: 'Adds two numbers' },
    { id: 'second', application: 'httpbin' }
  ]
});

const build = (overrides: any = {}) => reporterHelper.get({
  flow: flowFixture(),
  cli: false,
  server: { emit: jest.fn() },
  ...overrides
});

describe('reporter.get', () => {
  test('exposes every reporting method', () => {
    const reporter = build();
    for (const method of [
      'stepStart', 'stepUpdate', 'mimicStart', 'request', 'mimicRequest',
      'mimicResponse', 'mimicResponseBody', 'mimicFile', 'response', 'test',
      'playwrightStep', 'execution', 'diagram', 'stepTestError',
      'inputRequest', 'inputResolved', 'stepSkip'
    ]) {
      expect(typeof reporter[method]).toBe('function');
    }
  });

  test('on the CLI the socket emitter is a no-op', () => {
    const reporter = reporterHelper.get({ flow: flowFixture(), cli: true, server: null });
    expect(() => reporter.server.emit('anything')).not.toThrow();
  });

  test('from the UI the given socket server is used', () => {
    const server = { emit: jest.fn() };
    expect(build({ server }).server).toBe(server);
  });
});

describe('reporter.stepStart', () => {
  test('prints the step number and id', () => {
    build().stepStart('add-numbers');
    expect(printed()).toContain('STEP 1');
    expect(printed()).toContain('add-numbers');
  });

  test('prints the description when the step has one', () => {
    build().stepStart('add-numbers');
    expect(printed()).toContain('Adds two numbers');
  });

  test('a step without a description prints only the header', () => {
    build().stepStart('second');
    expect(printed()).toContain('STEP 2');
    expect(printed()).not.toContain('undefined');
  });

  test('an unknown step id is an error', () => {
    expect(() => build().stepStart('nope')).toThrow(/Step with id nope not found/);
  });
});

describe('reporter.stepSkip', () => {
  test('announces the step it walked past, with its own number', () => {
    build().stepSkip('second');
    expect(printed()).toContain('STEP 2');
    expect(printed()).toContain('second');
    expect(printed()).toContain('skipped');
  });

  test('an unknown step id is an error', () => {
    expect(() => build().stepSkip('nope')).toThrow(/Step with id nope not found/);
  });
});

describe('reporter.stepUpdate', () => {
  test('emits the step over the socket', () => {
    const server = { emit: jest.fn() };
    build({ server }).stepUpdate('add-numbers');

    expect(server.emit).toHaveBeenCalledWith('flowexecution:update', {
      id: 'exec-1',
      topic: 'step',
      data: { id: 'add-numbers', data: expect.objectContaining({ id: 'add-numbers' }) }
    });
  });

  test('an unknown step id is an error', () => {
    expect(() => build().stepUpdate('nope')).toThrow(/not found/);
  });
});

describe('reporter.mimicStart', () => {
  test('prints the application and url', () => {
    build().mimicStart({ application: 'calculator', url: '/add' });
    expect(printed()).toContain('MIMIC');
    expect(printed()).toContain('calculator');
    expect(printed()).toContain('/add');
  });

  test('called with nothing it prints nothing', () => {
    build().mimicStart(undefined);
    expect(console.log).not.toHaveBeenCalled();
  });
});

describe('reporter.request', () => {
  test('prints the method and url', () => {
    build().request('get', { url: 'https://api.test/users', options: {} });
    expect(printed()).toContain('REQUEST');
    expect(printed()).toContain('GET');
    expect(printed()).toContain('https://api.test/users');
  });

  test('prints headers when present', () => {
    build().request('get', {
      url: '/u', options: { headers: { 'content-type': 'application/json' } }
    });
    expect(printed()).toContain('Headers');
    expect(printed()).toContain('content-type');
  });

  test('masks sensitive headers, keeping the last four characters', () => {
    build().request('get', {
      url: '/u', options: { headers: { authorization: 'Bearer abcdefghijkl' } }
    });
    const out = printed();
    expect(out).not.toContain('Bearer abcdefghijkl');
    expect(out).toContain('****ijkl');
  });

  test('masks a short secret entirely', () => {
    build().request('get', { url: '/u', options: { headers: { token: 'abc' } } });
    const out = printed();
    expect(out).not.toContain('abc');
    expect(out).toContain('***');
  });

  test('labels a JSON payload as JSON', () => {
    build().request('post', { url: '/u', options: { data: '{"a":1}' } });
    expect(printed()).toContain('JSON Data');
  });

  test('labels a non-JSON payload as XML', () => {
    build().request('post', { url: '/u', options: { data: '<a>1</a>' } });
    expect(printed()).toContain('XML Data');
  });

  test('no headers and no data prints just the request line', () => {
    build().request('get', { url: '/u', options: {} });
    expect(printed()).not.toContain('Headers');
    expect(printed()).not.toContain('Data');
  });
});

describe('reporter.mimicRequest', () => {
  test('prints the application, both methods and the body', () => {
    build().mimicRequest('calculator', '/add', {
      method: 'POST', headers: { accept: 'application/json' }, body: { a: 1 }
    });
    const out = printed();
    expect(out).toContain('MIMIC REQUEST RECEIVED');
    expect(out).toContain('CALCULATOR');
    expect(out).toContain('accept');
    expect(out).toContain('"a": 1');
  });

  test('says "none" when there are no headers', () => {
    build().mimicRequest('calculator', '/add', { method: 'GET', headers: {}, body: { a: 1 } });
    expect(printed()).toContain('none');
  });

  test('says "none" and stops when there is no body', () => {
    build().mimicRequest('calculator', '/add', { method: 'GET', headers: {}, body: null });
    expect(printed()).toContain('body none');
  });
});

describe('reporter.mimicResponse and mimicResponseBody', () => {
  test('mimicResponse prints the application and route', () => {
    build().mimicResponse('calculator', '/add');
    expect(printed()).toContain('MIMIC RESPONSE RETURNED');
    expect(printed()).toContain('calculator');
  });

  test('mimicResponseBody prints the payload with secrets masked', () => {
    build().mimicResponseBody({ sum: 3, password: 'supersecret' });
    const out = printed();
    expect(out).toContain('"sum": 3');
    expect(out).not.toContain('supersecret');
  });
});

describe('reporter.mimicFile', () => {
  test('reports a file that was used', () => {
    build().mimicFile('calculator', '/ctx/static/calculator/add.json', true);
    const out = printed();
    expect(out).toContain('MIMIC CUSTOM RESPONSE');
    expect(out).toContain('used');
    expect(out).toContain('static/calculator/add.json');
  });

  test('reports a file that was not found', () => {
    build().mimicFile('calculator', '/a/b/c.json', false);
    expect(printed()).toContain('not found');
  });
});

describe('reporter.response', () => {
  test('prints the status and timing', () => {
    build().response({ status: 200, headers: {}, body: null }, { timing: 0.12 });
    const out = printed();
    expect(out).toContain('RESPONSE');
    expect(out).toContain('(0.12s)');
    expect(out).toContain('200');
  });

  test('flags a 4xx or 5xx for attention', () => {
    build().response({ status: 500, headers: {}, body: null }, {});
    expect(printed()).toContain('ATTENTION');
  });

  test('does not flag a 2xx', () => {
    build().response({ status: 204, headers: {}, body: null }, {});
    expect(printed()).not.toContain('ATTENTION');
  });

  test('reports a missing status as none', () => {
    build().response({ status: null, headers: {}, body: null }, {});
    expect(printed()).toContain('status none');
  });

  test('prints headers and body when present, masking secrets', () => {
    build().response({
      status: 200,
      headers: { 'set-cookie': 'a=b' },
      body: { token: 'abcdefghijkl' }
    }, {});
    const out = printed();
    expect(out).toContain('set-cookie');
    expect(out).not.toContain('abcdefghijkl');
  });

  test('an array body is masked element by element', () => {
    build().response({ status: 200, headers: {}, body: [{ secret: 'abcdefgh' }] }, {});
    expect(printed()).not.toContain('abcdefgh');
  });
});

describe('reporter.test', () => {
  test('reports a passing test', () => {
    build().test({ hasErrors: false, status: [], body: [] });
    const out = printed();
    expect(out).toContain('passed');
    expect(out).not.toContain('ATTENTION');
  });

  test('reports a failing test and lists expected versus actual', () => {
    build().test({
      hasErrors: true,
      status: [{ message: 'no', expected: [200], actual: 500 }]
    });
    const out = printed();
    expect(out).toContain('failed');
    expect(out).toContain('ATTENTION');
    expect(out).toContain('- status:');
    expect(out).toContain('[200]');
    expect(out).toContain('500');
  });

  test('aspects with no errors are skipped', () => {
    build().test({ hasErrors: true, status: [], body: [{ expected: 1, actual: 2 }] });
    const out = printed();
    expect(out).not.toContain('- status:');
    expect(out).toContain('- body:');
  });

  test('latent application failures are listed per application', () => {
    build().test({
      hasErrors: true,
      latentApplications: [{ application: 'mqtt', errors: [{ topic: 'orders' }] }]
    });
    const out = printed();
    expect(out).toContain('- latentApplications:');
    expect(out).toContain('mqtt');
    expect(out).toContain('error');
    expect(out).toContain('orders');
  });
});

describe('reporter.playwrightStep', () => {
  test('prints the method and the longest parameter value', () => {
    build().playwrightStep({}, 'fill', { selector: '#a', value: 'a much longer value' });
    const out = printed();
    expect(out).toContain('PLAYWRIGHT');
    expect(out).toContain('FILL');
    expect(out).toContain('a much longer value');
  });

  test('tolerates a step with no parameters', () => {
    expect(() => build().playwrightStep({}, 'goto', undefined)).not.toThrow();
    expect(printed()).toContain('GOTO');
  });
});

describe('reporter.execution and diagram', () => {
  test('execution emits the execution record', () => {
    const server = { emit: jest.fn() };
    build({ server }).execution();
    expect(server.emit).toHaveBeenCalledWith('flowexecution:update', {
      id: 'exec-1', topic: 'execution', data: expect.objectContaining({ id: 'exec-1' })
    });
  });

  test('diagram emits the flow without its reporter', () => {
    const server = { emit: jest.fn() };
    const reporter = build({ server });
    reporter.diagram();

    const payload = server.emit.mock.calls[0][1];
    expect(payload.topic).toBe('diagram');
    expect(payload.data.reporter).toBeUndefined();
    expect(payload.data.steps).toHaveLength(2);
  });
});

describe('reporter.stepTestError', () => {
  test('is a no-op placeholder', () => {
    expect(build().stepTestError({}, 'message')).toBeUndefined();
  });
});

describe('reporter input requests', () => {
  test('a pending request goes to the socket and to the terminal', () => {
    const server = { emit: jest.fn() };
    const reporter = build({ server });

    reporter.inputRequest({
      id: 'req-1',
      kind: 'text',
      label: 'Introduce the barcode to be reserved',
      stepId: 'add-numbers'
    });

    expect(server.emit).toHaveBeenCalledWith('flowexecution:update', {
      id: 'exec-1',
      topic: 'input',
      data: {
        id: 'req-1',
        kind: 'text',
        label: 'Introduce the barcode to be reserved',
        stepId: 'add-numbers',
        status: 'pending'
      }
    });

    // The server log is where someone looks when a run seems stuck
    expect(printed()).toContain('WAITING FOR INPUT');
    expect(printed()).toContain('Introduce the barcode to be reserved');
  });

  test('a resolved request tells the UI to take the field away', () => {
    const server = { emit: jest.fn() };
    const reporter = build({ server });

    reporter.inputResolved({ id: 'req-1', stepId: 'add-numbers', label: 'anything' });

    expect(server.emit).toHaveBeenCalledWith('flowexecution:update', {
      id: 'exec-1',
      topic: 'input',
      data: { id: 'req-1', stepId: 'add-numbers', status: 'resolved' }
    });
  });

  test('a CLI reporter says so, so inputs are asked on the terminal', () => {
    expect(build({ cli: true }).cli).toBe(true);
    expect(build({ cli: false }).cli).toBe(false);
  });
});
