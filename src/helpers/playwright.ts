import assert from 'node:assert';
import colors from 'colors';
import path from 'path';
import fs from 'fs';
import YAML from 'yaml';
import createDebug from 'debug';

const debug = createDebug('lab34:flows:helpers:playwright');

import { chromium, firefox, webkit, devices } from 'playwright';

import * as replacer from './replacer';

const ALLOWED_METHODS = [
  'goto',
  'click',
  'type',
  'waitForSelector',
  'assertTitle',
  // TODO: 'assert' and 'route' are accepted but have no implementation yet;
  // a step using either is validated and then silently does nothing.
  'assert',
  'route',
  'screenshot',
  'waitForInput',
  'waitForTimeout',
  'scrape',
  'hover',
  'press',
  'fill',
  'selectOption',
  'check',
  'uncheck',
  'dblclick',
  'focus',
  'dragAndDrop',
  'evaluate',
  'keyboard',
  'mouse'
];

const BROWSER_TYPES = {
  chromium,
  firefox,
  webkit
};

/**
 * A browser kept alive between runs.
 *
 * Everything a step needs to carry on where the previous one stopped: the
 * same browser, the same context (so cookies and storage survive) and the
 * same page (so the URL, the scroll and whatever was typed survive too).
 * `browserType` and `device` are kept to tell the author when a later step
 * asks for a browser the session cannot give it.
 */
interface Session {
  name: string;
  browser: any;
  context: any;
  page: any;
  browserType: string;
  device: string;
  keepOpen: boolean;
}

/**
 * The open sessions, by name.
 *
 * Without a session every `run` launches a browser and closes it when its
 * steps are done, so a flow that browses in three steps opens three browsers
 * and each one starts from a blank page. A named session keeps the browser
 * here instead, and the next run asking for the same name gets the page the
 * previous one left behind.
 *
 * A promise, not a session, is stored: it goes in before the browser has
 * finished launching, so two runs asking for the same name at once share one
 * browser rather than racing to open two.
 *
 * The runner closes what is left here when the flow finishes -- see
 * `closeSessions`.
 */
const sessions = new Map<string, Promise<Session>>();

/**
 * Which session a run belongs to, from the most specific source to the least:
 * the argument given to `run`, the `session` of the flow step (the runner
 * puts it on the context), the step parameters, and finally the yaml file's
 * own `session`. `session: false` anywhere in that order opts out, so a step
 * can ask for its own throw-away browser even when the yaml names a session.
 *
 * @returns {string|null} The session name, or null to run on a fresh browser.
 */
const sessionName = (ctx, flow, stepParams, options) => {
  const candidates = [
    options && options.session,
    ctx && ctx.session,
    stepParams && stepParams.session,
    flow && flow.session
  ];

  for (const candidate of candidates) {
    if (candidate === false) {return null;}
    if (typeof candidate === 'string' && candidate.trim()) {return candidate.trim();}
  }

  return null;
};

/**
 * `npm install` brings in playwright itself, but not the browsers it drives:
 * those are downloaded once, by hand, with `npx playwright install`. Until
 * that is done every launch fails, so the error says what to run instead of
 * leaving playwright's own message to be read as a broken flow.
 */
const isMissingBrowserError = (ex) => {
  const message = String((ex && ex.message) || ex || '');

  return message.includes('Executable doesn\'t exist')
    || message.includes('playwright install');
};

const missingBrowserError = (browserType, ex) => new Error([
  `The ${browserType} browser is not installed. Playwright drives real browsers,`,
  `and they are downloaded separately: run "npx playwright install ${browserType}"`,
  '(or "npx playwright install" for all of them) and run the flow again.'
].join(' ') + `\n\n${(ex && ex.message) || ex}`);

/**
 * Launch a browser, give it a context and a page, and return the three.
 *
 * @param {Object} flow - The parsed yaml file, for its launch and context options
 * @param {string} browserType - chromium, firefox or webkit
 * @param {string} device - A key of playwright's `devices`
 */
const openBrowser = async (flow, browserType, device) => {
  const { launchOptions = {} } = flow;

  // Setup with enhanced launch options
  const defaultLaunchOptions = {
    headless: false,
    args: [],
    ignoreHTTPSErrors: true,
    timeout: 30000,
    ...launchOptions
  };

  debug('Launching browser with options: %O', defaultLaunchOptions);

  let browser;
  try {
    browser = await BROWSER_TYPES[browserType].launch(defaultLaunchOptions);
  }
  catch (ex) {
    if (isMissingBrowserError(ex)) {throw missingBrowserError(browserType, ex);}
    throw ex;
  }

  const constextOptions = {
    ...devices[device],
    viewport: devices[device].viewport,
    locale: 'en-US',
    timezoneId: 'Europe/Brussels',
    permissions: [],
    // geolocation: null,
    ...flow.contextOptions
  };

  debug('Creating browser context with options: %O', constextOptions);
  const context = await browser.newContext(constextOptions);

  const page = await context.newPage();

  // Enhanced error handling and logging
  page.on('console', msg => console.log('Browser console:', msg.text()));
  page.on('pageerror', err => console.error('Browser page error:', err));

  // The actual interesting bit
  await context.route('**.jpg', route => route.abort());

  return { browser, context, page };
};

/**
 * The session called `name`, opening its browser if this is the first step
 * that asks for it.
 */
const acquireSession = (name, flow, browserType, device): Promise<Session> => {
  const existing = sessions.get(name);

  if (existing) {
    debug('Reusing session "%s"', name);
    return existing.then(session => {
      // The browser is already open: a later step asking for a different one
      // gets the one it was given, which is worth saying out loud
      if (session.browserType !== browserType || session.device !== device) {
        debug(
          'Session "%s" runs on %s/%s; the %s/%s this step asks for is ignored',
          name, session.browserType, session.device, browserType, device
        );
      }
      return session;
    });
  }

  debug('Opening session "%s" on %s/%s', name, browserType, device);

  const created = openBrowser(flow, browserType, device)
    .then(({ browser, context, page }) => ({
      name,
      browser,
      context,
      page,
      browserType,
      device,
      keepOpen: Boolean(flow.keepOpen)
    }));

  // Stored before it resolves, so a second run asking for the same name waits
  // for this browser instead of opening another one
  sessions.set(name, created);

  // A browser that never opened must not stay behind as a poisoned entry
  created.catch(() => {
    if (sessions.get(name) === created) {sessions.delete(name);}
  });

  return created;
};

/**
 * Close a session and forget it. Closing one that does not exist is not an
 * error: it is what a flow that already closed it does.
 *
 * @param {string} name
 * @returns {Promise<boolean>} Whether there was a session to close
 */
export const closeSession = async (name) => {
  const pending = sessions.get(name);
  if (!pending) {return false;}

  // Out of the map first: whatever happens below, no step gets a browser
  // that is on its way out
  sessions.delete(name);

  try {
    const session = await pending;
    debug('Closing session "%s"', name);
    await session.context.close();
    await session.browser.close();
  }
  catch (ex) {
    // A browser that died on its own is already as closed as we need it
    debug('Could not close session "%s": %s', name, ex.message);
  }

  return true;
};

/**
 * Close every open session. The runner calls this when a flow finishes, so a
 * browser a flow left open does not outlive it.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.force] - Close even the sessions opened with
 *                                 `keepOpen`, which are otherwise left
 *                                 running for whoever asked to look at them
 * @returns {Promise<string[]>} The names of the sessions that were open
 */
export const closeSessions = async ({ force = false } = {}) => {
  const names = [...sessions.keys()];

  for (const name of names) {
    const session = await (sessions.get(name) || Promise.resolve(null)).catch(() => null);

    if (session && session.keepOpen && !force) {
      debug('Leaving session "%s" open: it was opened with keepOpen', name);
      sessions.delete(name);
      continue;
    }

    await closeSession(name);
  }

  return names;
};

/** Whether a session is open, for an application that branches on it. */
export const hasSession = (name) => sessions.has(name);

/** The names of the open sessions. */
export const openSessions = () => [...sessions.keys()];

const error = (ctx, yamlFile, error) => {
  const message = `Error in ${yamlFile}: ${error}`;
  console.error(message);
  process.exit(9);
};

/**
 * @param {*} result 
 * @param {string} output - The format to have the output in (defaults to string)
 * - number
 * - string
 * - date
 * - boolean
 * @param {string} regexp - The regex to apply to the result
 * @returns 
 */
const formatScrapeResult = async (elements, output, regexp) => {
  // Apply default output
  if (!output) {output = 'string';}

  const expectsArrayAsOutput = output.includes('[]');
  if (expectsArrayAsOutput) {
    return 'not supported yet';
  }

  let firstElement = Array.isArray(elements) ? elements[0] : elements;
  firstElement = await firstElement.textContent();

  if (regexp) {
    const regex = new RegExp(regexp);
    const match = firstElement.match(regex);
    if (match) {
      firstElement = match[0];
    } else {
      return null;
    }
  }

  let result;

  if (output === 'number') {result = Number(firstElement.replace(/[^0-9.]/g, ''));}
  if (output === 'string') {result = firstElement.trim();}
  if (output === 'date') {result = new Date(firstElement).toISOString();}
  if (output === 'boolean') {result = ['true', 'yes', '1', 'si'].includes(firstElement.toLowerCase());}
  return Promise.resolve(result || firstElement);
};

/**
 * Given a list of steps, return a list of steps with unique ids
 * 
 * @param {*} steps 
 * @returns 
 */
const buildSteps = (steps) => {
  // Add "id" property to each step with "applciation.method" as the value
  steps = steps.map((step, _index) => {
    if (typeof step === 'string') {return { id: `${step}`, method: step };}
    if (step.slug) {return { ...step, id: step.slug };}

    const stepIdParts = [
      step.method
    ];

    return {
      id: stepIdParts.filter(Boolean).join('-'),
      ...step
    };
  });

  // ids must be unique. If one is not unique, add a number to it
  const ids = steps.map(step => step.id);
  const uniqueIds = [...new Set(ids)];
  if (ids.length !== uniqueIds.length) {
    steps = steps.map((step, index) => {
      if (ids.filter(id => id === step.id).length === 1) {return step;}
      return { id: `${step.id}-${index}`, ...step };
    });
  }
  return steps;
};

const buildData = (data, vars, _index) => {
  const {
    steps,
    ...rest
  } = vars;

  // Convert each step into a property in a json object
  const stepData = steps.reduce((acc, step) => {
    acc[step.id] = step;
    return acc;
  }, {});

  data = replacer.json(JSON.stringify(data), Object.assign({}, rest, { steps: stepData }));

  return data;
};

/**
 * Run a browser flow.
 *
 * @param {Object} ctx - The application context. `ctx.session` is the session
 *                       the flow step asked for, and `ctx.closeSession` says
 *                       the step is the last one that needs it.
 * @param {string} yamlFile - The yaml file, relative to the application folder
 * @param {Object} stepParams - The parameters of the flow step
 * @param {Object} [options] - Overrides for what the step said
 * @param {string|false} [options.session] - Run on this session, or on a
 *                                           throw-away browser when false
 * @param {boolean} [options.closeSession] - Close the session when the run ends
 */
export const run = (ctx, yamlFile, stepParams, options: Record<string, any> = {}) => {
  const yamlPath = path.join(ctx.path, yamlFile);
  const yaml = fs.readFileSync(yamlPath, 'utf8');

  const flow = YAML.parse(yaml);
  const { keepOpen, browserType = 'chromium' } = flow;
  let { device, steps } = flow;

  // Which browser this run gets: a named one that outlives it, or its own
  const session = sessionName(ctx, flow, stepParams, options);

  // And whether this run is the one that ends the session
  const endSession = Boolean(
    options.closeSession !== undefined ? options.closeSession
      : ctx.closeSession !== undefined ? ctx.closeSession
        : flow.closeSession
  );

  steps = buildSteps(steps);

  // Validate device
  if (!device) {device = 'iPhone 11 Pro';}
  if (!devices[device]) {
    error(ctx, yamlFile, `Invalid device: ${device}`);
  }

  debug('Browser Type: %s', browserType);
  debug('Device: %s', device);

  // Validate browser type
  if (!BROWSER_TYPES[browserType]) {
    error(ctx, yamlFile, `Invalid browser type: ${browserType}. Supported types are: ${Object.keys(BROWSER_TYPES).join(', ')}`);
  }

  // Validate methods
  const methodNames = steps.map(step => step.method);
  const invalidMethods = methodNames.filter(method => !ALLOWED_METHODS.includes(method));
  if (invalidMethods.length) {
    error(ctx, yamlFile, `Invalid methods: ${invalidMethods.join(', ')}`);
  }

  return new Promise(async (resolve, reject) => {
    try {
      // A sessioned run browses in the browser the session already has open,
      // on the page the previous step left behind. Everything below is the
      // same either way: the steps cannot tell the difference.
      const { browser, context, page } = session
        ? await acquireSession(session, flow, browserType, device)
        : await openBrowser(flow, browserType, device);

      let currentStep = 0;

      for (const step of steps) {
        // Replace step values
        steps[currentStep] = buildData(steps[currentStep], {
          ctx,
          steps,
          parameters: stepParams,
          ...step.parameters || {}
        }, currentStep);

        const { method, parameters } = steps[currentStep];

        debug('Executing step %d: %s with parameters: %O', currentStep + 1, method, parameters);
        ctx.reporter.playwrightStep(ctx, method, parameters);
        
        switch (method) {
          case 'goto':
            debug('URL: Navigating to %s', parameters.url);
            await page.goto(parameters.url, { 
              waitUntil: parameters.waitUntil || 'networkidle',
              timeout: parameters.timeout || 30000 
            });
            break;
          case 'click':
            debug('Clicking on selector: %s', parameters.selector);
            await page.click(parameters.selector, { 
              button: parameters.button || 'left',
              clickCount: parameters.clickCount || 1,
              delay: parameters.delay,
              timeout: parameters.timeout
            });
            break;
          case 'type':
            debug('Typing in selector: %s', parameters.selector);
            await page.type(parameters.selector, parameters.text, {
              delay: parameters.delay,
              timeout: parameters.timeout
            });
            break;
          case 'fill':
            debug('Filling selector: %s with value', parameters.selector);
            await page.fill(parameters.selector, parameters.value, {
              timeout: parameters.timeout
            });
            break;
          case 'press':
            debug('Pressing key %s on selector: %s', parameters.key, parameters.selector);
            await page.press(parameters.selector, parameters.key, {
              delay: parameters.delay,
              timeout: parameters.timeout
            });
            break;
          case 'hover':
            debug('Hovering over selector: %s', parameters.selector);
            await page.hover(parameters.selector, {
              position: parameters.position,
              timeout: parameters.timeout
            });
            break;
          case 'dragAndDrop':
            debug('Dragging from %s to %s', parameters.source, parameters.target);
            await page.dragAndDrop(parameters.source, parameters.target, {
              force: parameters.force,
              timeout: parameters.timeout
            });
            break;
          case 'selectOption':
            debug('Selecting option in selector: %s', parameters.selector);
            await page.selectOption(parameters.selector, parameters.values, {
              timeout: parameters.timeout
            });
            break;
          case 'check':
            debug('Checking selector: %s', parameters.selector);
            await page.check(parameters.selector, {
              position: parameters.position,
              timeout: parameters.timeout
            });
            break;
          case 'dblclick':
            debug('Double clicking on selector: %s', parameters.selector);
            await page.dblclick(parameters.selector, {
              button: parameters.button || 'left',
              delay: parameters.delay,
              timeout: parameters.timeout
            });
            break;
          case 'focus':
            debug('Focusing selector: %s', parameters.selector);
            await page.focus(parameters.selector, {
              timeout: parameters.timeout
            });
            break;
          case 'uncheck':
            debug('Unchecking selector: %s', parameters.selector);
            await page.uncheck(parameters.selector, {
              position: parameters.position,
              timeout: parameters.timeout
            });
            break;
          case 'evaluate':
            await page.evaluate(parameters.pageFunction, parameters.arg);
            break;
          case 'keyboard':
            await page.keyboard[parameters.action](...(parameters.args || []));
            break;
          case 'mouse':
            await page.mouse[parameters.action](...(parameters.args || []));
            break;
          case 'waitForTimeout':
            await page.waitForTimeout(parameters.time);
            break;
          case 'waitForSelector':
            debug('Waiting for selector: %s', parameters.selector);
            await page.waitForSelector(parameters.selector);
            break;
          case 'assertTitle':
            assert(await page.title() === parameters.title);
            break;
          case 'screenshot':
            await page.screenshot({ path: parameters.path });
            break;
          case 'waitForInput':
            process.stdout.write(colors.yellow.bold('      Enter an input and press enter to continue: '));
            await new Promise<void>(resolve => process.stdin.once('data', (key) => {
              const input = key.toString().trim().replace('\n', '');
              steps[currentStep].result = { input };
              resolve();
            }));
            break;
          case 'scrape': {
            const results = {};
            for (const key in parameters) {
              const { selector, output, regex } = parameters[key];
              debug('Scraping selector: %s for key: %s', selector, key);
              const elements = await page.$$(selector);
              results[key] = await formatScrapeResult(elements, output, regex);
            }
            debug('Scrape results: %O', results);
            steps[currentStep].result = results;
            break;
          }
          default:
            break;
        }

        currentStep++;
      }

      // Teardown
      if (session) {
        // The browser belongs to the session, not to this run: it closes when
        // the step says so, or when the runner ends the flow
        if (endSession) {
          await closeSession(session);
        } else {
          debug('Leaving session "%s" open for the next step', session);
        }
      } else if (!keepOpen) {
        debug('Closing browser context and browser');
        await context.close();
        await browser.close();
      } else {
        debug('Keeping browser open as requested');
      }
      const allScrappedData = steps
        .filter(step => step.method === 'scrape')
        .map(step => step.result)
        .reduce((acc, result) => Object.assign(acc, result), {});

      debug('Flow completed successfully. Scraped data: %O', allScrappedData);
      resolve([null, null, allScrappedData]);

    } catch (error) {
      debug('Flow execution failed: %s', error.message);
      reject(error);
    }
  });
};
