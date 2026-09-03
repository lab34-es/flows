// Imported for its side effect: colors patches String.prototype with .red,
// .bold, .bgGreen and friends, which every console line below relies on.
// Importing it here rather than depending on some other module having been
// loaded first -- the reporter is reachable from the mimic HTTP server without
// the flow runner ever being required.
import 'colors';
import { highlight as highlight } from 'cli-highlight';

/**
 * The object a flow run reports progress to. `server` is the Socket.IO server
 * when the run came from the UI, and a no-op emitter on the CLI.
 */
export interface Reporter {
  server: { emit: (...args: any[]) => void };
  /** True when the run was started from the CLI, i.e. a person is at a terminal. */
  cli: boolean;
  [method: string]: any;
}

let _flow;

/**
 * Remove sensitive data from the input recursively.
 * 
 * @param {*} input 
 * @returns - The input with sensitive data removed.
 */
const sensitive = (input) => {
  // typeof null is 'object': without this a null becomes {} below
  if (input === null || input === undefined) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(sensitive);
  }

  const keysToHide = ['password', 'token', 'secret', 'x-api-key', 'authorization'];

  if (typeof input === 'object') {
    const result = {};
    for (const key in input) {
      if (keysToHide.some(k => key.toLowerCase().includes(k))) {

        // Show only 4 first and 4 last characters
        const value = input[key];
        const valueLength = value.length;
        if (valueLength > 4) {
          result[key] = value.toString().slice(0, 4).replace(/./g, '*') + value.slice(-4);
        } else {
          result[key] = (value||'').toString().replace(/./g, '*');
        }
      } else {
        result[key] = sensitive(input[key]);
      }
    }
    return result;
  }

  return input;
};

/**
 * Logs the details of a specific step in a series of steps.
 * 
 * @param {Array} steps - The array of steps.
 * @param {number} index - The index of the step to log.
 */
const stepStart = function (stepId) {
  const index = _flow.steps.findIndex(step => step.id === stepId);

  if (index === -1) {
    throw new Error(`Step with id ${stepId} not found`);
  }

  const reportedStep = _flow.steps[index];

  const { application, description, _method, _parameters, _mimic } = reportedStep;

  // Convert camelCase application name to human-readable format
  const humanReadableApplication = (application || '').split(/(?=[A-Z])/).join(' ');

  const stepTxt = ` STEP ${index + 1} `;
  const _applicationText = ` ${humanReadableApplication} `;
  const stepText = ` ${reportedStep.id} `;

  // Log the step number and ID
  console.log(
    [
      ' ',
      stepTxt.bgGreen.black,
      ' ',
      stepText.bgGray.black
    ].join('')
  );

  // Log the description if it exists
  if (description) {
    console.log(`      ${description}`);
  }
};

/**
 * Logs a step the run walked past: one turned off with `enabled: false`.
 * It is announced like any other step so the numbering on the terminal keeps
 * matching the document, only greyed out and marked as skipped.
 *
 * @param {string} stepId - The id of the step that will not run
 */
const stepSkip = function (stepId) {
  const index = _flow.steps.findIndex(step => step.id === stepId);

  if (index === -1) {
    throw new Error(`Step with id ${stepId} not found`);
  }

  const reportedStep = _flow.steps[index];

  const stepTxt = ` STEP ${index + 1} `;
  const stepText = ` ${reportedStep.id} `;

  console.log(
    [
      ' ',
      stepTxt.bgGray.black,
      ' ',
      stepText.bgGray.black,
      ' ',
      'skipped'.gray
    ].join('')
  );
};

const stepUpdate = function (this: Reporter, stepId) {
  const index = _flow.steps.findIndex(step => step.id === stepId);

  if (index === -1) {
    throw new Error(`Step with id ${stepId} not found`);
  }

  const reportedStep = _flow.steps[index];

  this.server.emit('flowexecution:update', {
    id: _flow.execution.id,
    topic: 'step',
    data: {
      id: stepId, 
      data: reportedStep
    }
  });
};

/**
 * Logs the start of a mimic process.
 * 
 * @param {Object} mimicConfig - The configuration object for the mimic process.
 * @param {string} mimicConfig.application - The name of the application.
 * @param {string} mimicConfig.url - The URL associated with the mimic process.
 */
const mimicStart = (mimicConfig) => {
  if (!mimicConfig) {
    // If no mimic configuration is provided, do nothing.
    return;
  }

  const applicationName = mimicConfig.application;
  const urlName = mimicConfig.url;

  // Log the start of the mimic process with application name and URL.
  console.log('   ⿻ MIMIC'.yellow.bold + ` ${applicationName}` + ` ${urlName}`.gray.bold);
};

/**
 * Logs the details of an HTTP request.
 * 
 * @param {string} method - The HTTP method of the request.
 * @param {string} url - The URL of the request.
 * @param {Object} body - The body of the request.
 */
const request = (method, _opts) => {
  const {
    url,
    options
  } = _opts;

  const {
    headers,
    body,
    data
  } = options;

  // Log the request method and URL
  console.log([
    '   ⮕',
    '  REQUEST '.yellow.bold,
    method.toUpperCase(),
    ' ',
    url.grey
  ].join(''));

  // Convert the body to a JSON string with sensitive data removed
  const bodyForReport = sensitive(body || data);
  const headersForReport = JSON.stringify(sensitive(headers), null, 2);

  // If the headers exist, log them
  if (headers) {
    console.log([
      '   ',
      '   Headers'.green.bold
    ].join(''));

    // Add indentation to each line of the headers
    const spacesStr = ' '.repeat(6);
    console.log(
      highlight(headersForReport, { language: 'json' })
        .split('\n')
        .map(line => `${spacesStr}${line}`).join('\n')
    );
  }

  // If XML data exists, log it
  if (data) {

    let isJson = false;
    try {
      isJson = JSON.parse(data);
    } catch (_e) {
      isJson = false;
    }

    console.log([
      '   ',
      isJson ? '   JSON Data'.green.bold : '   XML Data'.green.bold
    ].join(''));


    // Add indentation to each line of the XML data
    const spacesStr = ' '.repeat(6);
    console.log(
      highlight(
        bodyForReport,
        { language: isJson ? 'json' : 'xml' })
        .split('\n')
        .map(line => `${spacesStr}${line}`).join('\n')
    );
  }
};

const mimicRequest = (application, _method, request) => {
  const {
    method,
    headers,
    body
  } = request;

  console.log([
    '   ⮕',
    '  MIMIC REQUEST RECEIVED '.yellow.bold,
    application.toUpperCase(),
    ' ',
    method.gray,
    ' ',
    _method.gray
  ].join(''));

  const spacesStr = ' '.repeat(6);
  
  console.log([
    '      headers'.green.bold,
    Object.keys(headers||{}).length > 0 ? '' : ' none'
  ].join(''));

  if (Object.keys(headers||{}).length) {
    console.log(
      highlight(JSON.stringify(sensitive(headers), null, 2), { language: 'json' })
        .split('\n')
        .map(line => `${spacesStr}${line}`).join('\n')
    );
  }

  if (!body) {
    console.log('      body'.green.bold + ' none');
    return;
  }
  console.log('      body'.green.bold);
  console.log(
    highlight(JSON.stringify(sensitive(body), null, 2), { language: 'json' })
      .split('\n')
      .map(line => `${spacesStr}${line}`).join('\n')
  );
};

const mimicResponse = (application, method) => {
  console.log([
    '   ⬅',
    '  MIMIC RESPONSE RETURNED '.yellow.bold,
    application,
    ' ',
    method.gray
  ].join(''));
};

const mimicResponseBody = (response) => {

  console.log([
    '   ',
    '   body'.green.bold
  ].join(''));
  
  const spacesStr = ' '.repeat(6);
  console.log(
    highlight(JSON.stringify(sensitive(response), null, 2), { language: 'json' })
      .split('\n')
      .map(line => `${spacesStr}${line}`).join('\n')
  );
  
};

const mimicFile = (application, filePath, fileExists) => {
  const last3 = filePath.split('/').slice(-3).join('/');

  const reportParts = [
    '   ⿻ MIMIC CUSTOM RESPONSE'.yellow.bold,
    fileExists ? ' used '.bgGreen.black : ' not found '.bgRed,
    application,
    last3.gray
  ];

  console.log(reportParts.join(' '));

  // console.log(`   ⿻ ${application} ${last3} ${fileExists}`.bold.yellow);
};

const response = (result, meta) => {
  const { headers, status, body } = result;

  // status is an http error code ?
  const needsAttention = status && status >= 400;

  console.log([
    '   ⬅',
    '  RESPONSE'.yellow.bold,
    meta.timing ? ` (${meta.timing}s)`.gray : ''
  ].join(''));

  const spacesStr = ' '.repeat(6);

  console.log([
    '      status'.green.bold,
    status ? ` ${status.toString()}` : ' none',
    needsAttention ? ' <-- ATTENTION -->'.white.bold : ''
  ].join(''));

  console.log([
    '      headers'.green.bold,
    Object.keys(headers||{}).length > 0 ? '' : ' none'
  ].join(''));

  if (Object.keys(headers||{}).length) {
    console.log(
      highlight(JSON.stringify(sensitive(headers), null, 2), { language: 'json' })
        .split('\n')
        .map(line => `${spacesStr}${line}`).join('\n')
    );
  }

  if (!body) {
    console.log('      body'.green.bold + ' none');
    return;
  }
  console.log('      body'.green.bold);
  console.log(
    highlight(JSON.stringify(sensitive(body), null, 2), { language: 'json' })
      .split('\n')
      .map(line => `${spacesStr}${line}`).join('\n')
  );
};

const test = (testReport) => {

  console.log([
    '      ',
    'test'.green.bold,
    ' ',
    testReport.hasErrors ? ' failed '.bgRed.white.bold : 'passed',
    ' ',
    testReport.hasErrors ? '<-- ATTENTION -->'.white.bold : ''
  ].join(''));

  Object.entries(testReport as Record<string, any>).forEach(([aspect, report]) => {
    if (aspect === 'hasErrors' || report.length === 0) {
      return;
    }
    console.log(`        - ${aspect}:`);

    if (aspect === 'latentApplications') {

      for (let i = 0; i < report.length; i++) {
        const { application, errors } = report[i];
        console.log([
          '            ',
          application
        ].join(''));

        errors.forEach(error => {
          console.log([
            '          ',
            '  error '.red.bold,
            JSON.stringify(error)
          ].join(''));
        });
      }

      return;
    }

    for (let i = 0; i < report.length; i++) {
      const { _message, expected, actual } = report[i];
      console.log([
        '          ',
        'expected '.green.bold,
        JSON.stringify(expected)
      ].join(''));
      console.log([
        '          ',
        'actual   '.red.bold,
        JSON.stringify(actual)
      ].join(''));
    }
  });
};

const playwrigthStep = (ctx, method, parameters) => {

  // Playwright parameters are objects with keys and values. In order to
  // find tbe most relevant information to be displayed, we simply find the
  // longest value of all the parameters and display it. Just as a meassure 
  // to don't have to support evety method's parameters. Let's Keep it simple.

  const [key, value] = Object.entries<any>(parameters||{}).reduce((acc, [key, value]) => {
    if (value.length > acc[1].length) {
      return [key, value];
    }
    return acc;
  }, ['', ''] as [string, any]);

  // Contains could contain sensitive data?
  const _sensitive = JSON.stringify(parameters||{}).toLowerCase().includes('password') || key.toLowerCase().includes('token');
  
  // if (sensitive) {
  //   // Show only 4 first and 4 last characters
  //   const valueLength = value.length;

  //   if (valueLength > 4) {
  //     value = value.slice(0, 4).replace(/./g, '*') + value.slice(-4);
  //   }
  //   else {
  //     value = (value||'').toString().replace(/./g, '*');
  //   }
  // }

  console.log([
    '   ⮕',
    '  PLAYWRIGHT '.yellow.bold,
    method.toUpperCase(),
    ' ',
    key,
    ' ',
    value.grey
  ].join(''));
};

const stepTestError = (_ctx, _message) => {};

/**
 * A step is waiting for the person running the flow to type something.
 *
 * On the CLI `helpers/inputs` never gets this far -- it reads stdin itself.
 * From the UI the request travels over the socket, and the answer comes back
 * through the API. The terminal still gets a line saying what the run is
 * stopped on, because the server's log is where someone looks when a run
 * seems stuck.
 *
 * @param {import('./inputs').InputRequest} request
 */
const inputRequest = function (this: Reporter, request) {
  console.log([
    '   ⏸',
    '  WAITING FOR INPUT '.yellow.bold,
    request.label
  ].join(''));

  this.server.emit('flowexecution:update', {
    id: _flow.execution.id,
    topic: 'input',
    data: { ...request, status: 'pending' }
  });
};

/**
 * The request was answered or cancelled: the UI can take the field away.
 * @param {import('./inputs').InputRequest} request
 */
const inputResolved = function (this: Reporter, request) {
  this.server.emit('flowexecution:update', {
    id: _flow.execution.id,
    topic: 'input',
    data: { id: request.id, stepId: request.stepId, status: 'resolved' }
  });
};

const execution = function (this: Reporter) {
  const { id } = _flow.execution;
  this.server.emit('flowexecution:update', {
    id,
    topic: 'execution',
    data: _flow.execution
  });
};

const _ = () => {
  const { reporter, ...data } = _flow;
  return data;
};

const diagram = function (this: Reporter) {
  const { id } = _flow.execution;
  this.server.emit('flowexecution:update', {
    id,
    topic: 'diagram',
    data: _()
  });
};

const get = function ({ flow, cli, server }): Reporter {
  _flow = flow;

  return {
    // On the CLI there is no socket to report to, so emit is a no-op
    server: cli ? { emit: () => {} } : server,

    // Where the run is being watched from: helpers/inputs asks a CLI run for
    // its answer on the terminal, and a UI run over the socket
    cli: Boolean(cli),

    stepStart,
    stepSkip,
    stepUpdate,
    mimicStart,
    request,
    mimicRequest,
    mimicResponse,
    mimicResponseBody,
    mimicFile,
    response,
    test,
    playwrightStep: playwrigthStep,
    execution,
    diagram,
    stepTestError,
    inputRequest,
    inputResolved
  };
};

export {
  get,
  // Test runs persist requests and responses to disk, and they must be
  // masked exactly like the console and the socket mask them
  sensitive
};
