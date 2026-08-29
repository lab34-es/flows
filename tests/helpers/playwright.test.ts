jest.mock('yargs-parser', () => () => ({}));

// A fake browser: every page method is a spy, so the whole step switch can be
// driven without launching anything.
const page: any = {};
const context: any = {};
const browser: any = {};

const PAGE_METHODS = [
  'goto', 'click', 'type', 'fill', 'press', 'hover', 'dragAndDrop', 'selectOption',
  'check', 'uncheck', 'dblclick', 'focus', 'waitForSelector', 'waitForTimeout',
  'screenshot', 'evaluate', 'title', 'route', 'on', '$$', 'setInputFiles',
  'waitForEvent'
];

const resetBrowser = () => {
  PAGE_METHODS.forEach(m => { page[m] = jest.fn().mockResolvedValue(undefined); });
  page.title = jest.fn().mockResolvedValue('Expected title');
  page.$$ = jest.fn().mockResolvedValue([{ textContent: jest.fn().mockResolvedValue(' 42 items ') }]);
  page.on = jest.fn();
  page.keyboard = { press: jest.fn().mockResolvedValue(undefined) };
  page.mouse = { move: jest.fn().mockResolvedValue(undefined) };

  context.newPage = jest.fn().mockResolvedValue(page);
  context.route = jest.fn().mockResolvedValue(undefined);
  context.close = jest.fn().mockResolvedValue(undefined);

  browser.newContext = jest.fn().mockResolvedValue(context);
  browser.close = jest.fn().mockResolvedValue(undefined);
};

const launch = jest.fn((..._args: any[]) => Promise.resolve(browser));

jest.mock('playwright', () => ({
  chromium: { launch: (options: any) => launch(options) },
  firefox: { launch: (options: any) => launch(options) },
  webkit: { launch: (options: any) => launch(options) },
  devices: {
    'iPhone 11 Pro': { viewport: { width: 375, height: 812 }, userAgent: 'iPhone' },
    'Desktop Chrome': { viewport: { width: 1280, height: 720 }, userAgent: 'Chrome' }
  }
}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';

// An upload resolves its files inside the flows directory of the context, so
// that directory has to be a throwaway one -- the tests must never reach the
// real ~/lab34-flows, nor be able to read anything outside what they wrote.
const mockContext = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-ctx-'));

jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (pathParts) =>
    require('path').join(mockContext, ...(pathParts || []))
}));

import * as playwright from '../../src/helpers/playwright';

const CTX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-'));
const FLOWS_DIR = path.join(mockContext, 'flows');

fs.mkdirSync(FLOWS_DIR, { recursive: true });

/** Write a file to upload inside the flows directory, and return its path. */
const writeUpload = (relativePath: string, content = 'hello') => {
  const absolute = path.join(FLOWS_DIR, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
  return absolute;
};

const ctx = () => ({
  path: CTX_DIR,
  env: {},
  reporter: { playwrightStep: jest.fn() }
});

/** Write a browser flow to the context folder and return its file name. */
const writeFlow = (flow: any) => {
  const file = `flow-${Math.random().toString(36).slice(2)}.yaml`;
  fs.writeFileSync(path.join(CTX_DIR, file), YAML.stringify(flow), 'utf8');
  return file;
};

/** Write a browser flow and run it. */
const run = (flow: any, stepParams: any = {}, context: any = ctx()) =>
  playwright.run(context, writeFlow(flow), stepParams);

beforeEach(() => {
  jest.clearAllMocks();
  resetBrowser();
});

afterAll(() => {
  fs.rmSync(CTX_DIR, { recursive: true, force: true });
  fs.rmSync(mockContext, { recursive: true, force: true });
});

describe('playwright.run - setup', () => {
  test('launches the default browser and device', async () => {
    await run({ steps: [{ method: 'goto', parameters: { url: 'https://x.test' } }] });

    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ headless: false, timeout: 30000 }));
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'en-US', timezoneId: 'Europe/Brussels'
    }));
  });

  test('honours an explicit browser type and device', async () => {
    await run({
      browserType: 'firefox',
      device: 'Desktop Chrome',
      steps: [{ method: 'goto', parameters: { url: 'https://x.test' } }]
    });
    expect(launch).toHaveBeenCalled();
  });

  test('launch options are merged over the defaults', async () => {
    await run({
      launchOptions: { headless: true, timeout: 5000 },
      steps: [{ method: 'goto', parameters: { url: 'https://x.test' } }]
    });
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ headless: true, timeout: 5000 }));
  });

  test('context options are merged too', async () => {
    await run({
      contextOptions: { locale: 'fr-BE' },
      steps: [{ method: 'goto', parameters: { url: 'https://x.test' } }]
    });
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ locale: 'fr-BE' }));
  });

  test('images are aborted so runs stay fast', async () => {
    await run({ steps: [{ method: 'goto', parameters: { url: 'https://x.test' } }] });
    expect(context.route).toHaveBeenCalledWith('**.jpg', expect.any(Function));
  });

  test('closes the browser when the flow ends', async () => {
    await run({ steps: [{ method: 'goto', parameters: { url: 'https://x.test' } }] });
    expect(context.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });

  test('keepOpen leaves the browser running', async () => {
    await run({ keepOpen: true, steps: [{ method: 'goto', parameters: { url: 'https://x.test' } }] });
    expect(browser.close).not.toHaveBeenCalled();
  });

  test('an unknown device is fatal', async () => {
    await run({ device: 'Nokia 3310', steps: [{ method: 'goto', parameters: { url: 'https://x' } }] })
      .catch(() => {});
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid device'));
    expect(process.exit).toHaveBeenCalledWith(9);
  });

  test('an unknown browser type is fatal', async () => {
    await run({ browserType: 'netscape', steps: [{ method: 'goto', parameters: { url: 'https://x' } }] })
      .catch(() => {});
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid browser type'));
  });

  test('an unsupported method is fatal', async () => {
    await run({ steps: [{ method: 'teleport', parameters: {} }] });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Invalid methods: teleport'));
  });

  test('a failure inside the run rejects', async () => {
    page.goto = jest.fn().mockRejectedValue(new Error('net down'));
    await expect(run({ steps: [{ method: 'goto', parameters: { url: 'https://x.test' } }] }))
      .rejects.toThrow('net down');
  });
});

describe('playwright.run - steps', () => {
  const single = (method: string, parameters: any = {}) => run({ steps: [{ method, parameters }] });

  test('goto passes waitUntil and timeout', async () => {
    await single('goto', { url: 'https://x.test' });
    expect(page.goto).toHaveBeenCalledWith('https://x.test', { waitUntil: 'networkidle', timeout: 30000 });
  });

  test('goto honours explicit options', async () => {
    await single('goto', { url: 'https://x.test', waitUntil: 'load', timeout: 1000 });
    expect(page.goto).toHaveBeenCalledWith('https://x.test', { waitUntil: 'load', timeout: 1000 });
  });

  test('click defaults the button and count', async () => {
    await single('click', { selector: '#go' });
    expect(page.click).toHaveBeenCalledWith('#go', expect.objectContaining({ button: 'left', clickCount: 1 }));
  });

  test('the simple selector-driven methods', async () => {
    await single('type', { selector: '#a', text: 'hello' });
    expect(page.type).toHaveBeenCalledWith('#a', 'hello', expect.any(Object));

    await single('fill', { selector: '#a', value: 'v' });
    expect(page.fill).toHaveBeenCalledWith('#a', 'v', expect.any(Object));

    await single('press', { selector: '#a', key: 'Enter' });
    expect(page.press).toHaveBeenCalledWith('#a', 'Enter', expect.any(Object));

    await single('hover', { selector: '#a' });
    expect(page.hover).toHaveBeenCalled();

    await single('check', { selector: '#a' });
    expect(page.check).toHaveBeenCalled();

    await single('uncheck', { selector: '#a' });
    expect(page.uncheck).toHaveBeenCalled();

    await single('dblclick', { selector: '#a' });
    expect(page.dblclick).toHaveBeenCalled();

    await single('focus', { selector: '#a' });
    expect(page.focus).toHaveBeenCalled();

    await single('waitForSelector', { selector: '#a' });
    expect(page.waitForSelector).toHaveBeenCalledWith('#a');

    await single('waitForTimeout', { time: 100 });
    expect(page.waitForTimeout).toHaveBeenCalledWith(100);

    await single('screenshot', { path: '/tmp/a.png' });
    expect(page.screenshot).toHaveBeenCalledWith({ path: '/tmp/a.png' });
  });

  test('dragAndDrop and selectOption', async () => {
    await single('dragAndDrop', { source: '#a', target: '#b' });
    expect(page.dragAndDrop).toHaveBeenCalledWith('#a', '#b', expect.any(Object));

    await single('selectOption', { selector: '#s', values: ['x'] });
    expect(page.selectOption).toHaveBeenCalledWith('#s', ['x'], expect.any(Object));
  });

  test('evaluate runs the expression', async () => {
    await single('evaluate', { expression: '1 + 1' });
    expect(page.evaluate).toHaveBeenCalled();
  });

  test('keyboard and mouse forward to their namespaces', async () => {
    await single('keyboard', { action: 'press', args: ['Enter'] });
    expect(page.keyboard.press).toHaveBeenCalledWith('Enter');

    await single('mouse', { action: 'move', args: [1, 2] });
    expect(page.mouse.move).toHaveBeenCalledWith(1, 2);
  });

  test('keyboard and mouse tolerate missing args', async () => {
    await single('keyboard', { action: 'press' });
    expect(page.keyboard.press).toHaveBeenCalledWith();
  });

  test('assertTitle passes when the page title matches', async () => {
    await expect(run({
      steps: [{ method: 'assertTitle', parameters: { title: 'Expected title' } }]
    })).resolves.toBeDefined();
  });

  test('assertTitle fails the run when the title differs', async () => {
    await expect(run({
      steps: [{ method: 'assertTitle', parameters: { title: 'Something else' } }]
    })).rejects.toBeDefined();
  });

  test('every step is announced to the reporter', async () => {
    const context = ctx();
    await run({
      steps: [
        { method: 'goto', parameters: { url: 'https://x.test' } },
        { method: 'click', parameters: { selector: '#a' } }
      ]
    }, {}, context);

    expect(context.reporter.playwrightStep).toHaveBeenCalledTimes(2);
  });
});

describe('playwright.run - scraping', () => {
  test('collects scraped values into the result', async () => {
    const [, , scraped]: any = await run({
      steps: [{ method: 'scrape', parameters: { total: { selector: '#total', output: 'string' } } }]
    });
    expect(scraped).toEqual({ total: '42 items' });
  });

  test('a number output strips everything but digits', async () => {
    const [, , scraped]: any = await run({
      steps: [{ method: 'scrape', parameters: { total: { selector: '#total', output: 'number' } } }]
    });
    expect(scraped.total).toBe(42);
  });

  test('a boolean output recognises the truthy words', async () => {
    page.$$ = jest.fn().mockResolvedValue([{ textContent: jest.fn().mockResolvedValue('yes') }]);
    const [, , scraped]: any = await run({
      steps: [{ method: 'scrape', parameters: { flag: { selector: '#f', output: 'boolean' } } }]
    });
    expect(scraped.flag).toBe(true);
  });

  test('a date output is normalised to ISO', async () => {
    page.$$ = jest.fn().mockResolvedValue([{ textContent: jest.fn().mockResolvedValue('2026-01-15') }]);
    const [, , scraped]: any = await run({
      steps: [{ method: 'scrape', parameters: { when: { selector: '#d', output: 'date' } } }]
    });
    expect(scraped.when).toContain('2026-01-15');
  });

  test('a regex narrows the scraped text', async () => {
    const [, , scraped]: any = await run({
      steps: [{ method: 'scrape', parameters: { n: { selector: '#t', output: 'string', regex: '\\d+' } } }]
    });
    expect(scraped.n).toBe('42');
  });

  test('a regex that does not match yields null', async () => {
    const [, , scraped]: any = await run({
      steps: [{ method: 'scrape', parameters: { n: { selector: '#t', output: 'string', regex: 'zzz' } } }]
    });
    expect(scraped.n).toBeNull();
  });

  test('array outputs are not supported yet', async () => {
    const [, , scraped]: any = await run({
      steps: [{ method: 'scrape', parameters: { n: { selector: '#t', output: 'string[]' } } }]
    });
    expect(scraped.n).toBe('not supported yet');
  });

  test('the output defaults to string', async () => {
    const [, , scraped]: any = await run({
      steps: [{ method: 'scrape', parameters: { n: { selector: '#t' } } }]
    });
    expect(scraped.n).toBe('42 items');
  });

  test('a flow with no scrape steps returns an empty object', async () => {
    const [, , scraped]: any = await run({
      steps: [{ method: 'goto', parameters: { url: 'https://x.test' } }]
    });
    expect(scraped).toEqual({});
  });
});

describe('playwright.run - step ids', () => {
  test('a bare string step is accepted and reaches the reporter', async () => {
    const context = ctx();
    // A string step carries no parameters, so a method that needs them still
    // fails -- but it passes validation and is announced first.
    await run({ steps: ['screenshot'] }, {}, context).catch(() => {});
    expect(context.reporter.playwrightStep).toHaveBeenCalledWith(context, 'screenshot', undefined);
  });

  test('a slug is used as the id', async () => {
    await expect(run({
      steps: [{ slug: 'open-home', method: 'goto', parameters: { url: 'https://x.test' } }]
    })).resolves.toBeDefined();
  });

  test('repeated methods get distinct ids', async () => {
    await expect(run({
      steps: [
        { method: 'click', parameters: { selector: '#a' } },
        { method: 'click', parameters: { selector: '#b' } }
      ]
    })).resolves.toBeDefined();
    expect(page.click).toHaveBeenCalledTimes(2);
  });
});

describe('playwright.run - sessions', () => {
  // Sessions outlive a run by design, so every test has to hand its browser
  // back -- the next one gets fresh spies and would otherwise drive the old
  // ones through a session left behind here.
  afterEach(() => playwright.closeSessions({ force: true }));

  const goto = (url = 'https://x.test') => ({ method: 'goto', parameters: { url } });

  test('a named session is opened once and reused by the next run', async () => {
    await run({ session: 'shop', steps: [goto()] });
    await run({ session: 'shop', steps: [goto('https://x.test/cart')] });

    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(1);
    expect(context.newPage).toHaveBeenCalledTimes(1);
    // Both runs browsed, on the one page the session holds
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  test('without a session every run gets its own browser', async () => {
    await run({ steps: [goto()] });
    await run({ steps: [goto()] });

    expect(launch).toHaveBeenCalledTimes(2);
  });

  test('a sessioned run leaves the browser open', async () => {
    await run({ session: 'shop', steps: [goto()] });

    expect(context.close).not.toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
    expect(playwright.hasSession('shop')).toBe(true);
    expect(playwright.openSessions()).toEqual(['shop']);
  });

  test('the flow step names the session, through the context', async () => {
    await run({ steps: [goto()] }, {}, { ...ctx(), session: 'from-the-step' });

    expect(playwright.hasSession('from-the-step')).toBe(true);
  });

  test('the step parameters can name it too', async () => {
    await run({ steps: [goto()] }, { session: 'from-the-parameters' });

    expect(playwright.hasSession('from-the-parameters')).toBe(true);
  });

  test('the step wins over the yaml file', async () => {
    await run({ session: 'from-the-yaml', steps: [goto()] }, {}, { ...ctx(), session: 'from-the-step' });

    expect(playwright.openSessions()).toEqual(['from-the-step']);
  });

  test('session: false on the step asks for a throw-away browser', async () => {
    await run({ session: 'from-the-yaml', steps: [goto()] }, {}, { ...ctx(), session: false });

    expect(playwright.openSessions()).toEqual([]);
    expect(browser.close).toHaveBeenCalled();
  });

  test('closeSession ends the session when the run is done', async () => {
    await run({ session: 'shop', steps: [goto()] });
    await run({ session: 'shop', closeSession: true, steps: [goto()] });

    expect(browser.close).toHaveBeenCalled();
    expect(playwright.hasSession('shop')).toBe(false);
  });

  test('a step can end the session through the context', async () => {
    await run({ session: 'shop', steps: [goto()] });
    await run({ steps: [goto()] }, {}, { ...ctx(), session: 'shop', closeSession: true });

    expect(playwright.hasSession('shop')).toBe(false);
  });

  test('two runs asking at once share one browser', async () => {
    await Promise.all([
      run({ session: 'shop', steps: [goto()] }),
      run({ session: 'shop', steps: [goto()] })
    ]);

    expect(launch).toHaveBeenCalledTimes(1);
  });

  test('the next run keeps the browser the session was opened with', async () => {
    await run({ session: 'shop', browserType: 'chromium', steps: [goto()] });
    await run({ session: 'shop', browserType: 'firefox', steps: [goto()] });

    expect(launch).toHaveBeenCalledTimes(1);
  });

  test('a browser that fails to open leaves no session behind', async () => {
    launch.mockRejectedValueOnce(new Error('no display'));

    await expect(run({ session: 'shop', steps: [goto()] })).rejects.toThrow('no display');
    expect(playwright.hasSession('shop')).toBe(false);
  });

  test('scraping still returns what the run collected', async () => {
    const [, , scraped]: any = await run({
      session: 'shop',
      steps: [{ method: 'scrape', parameters: { total: { selector: '#total' } } }]
    });

    expect(scraped).toEqual({ total: '42 items' });
  });
});

describe('playwright.closeSessions', () => {
  afterEach(() => playwright.closeSessions({ force: true }));

  test('closes every open session and names them', async () => {
    await playwright.run(ctx(), writeFlow({ session: 'a', steps: [] }), {});
    await playwright.run(ctx(), writeFlow({ session: 'b', steps: [] }), {});

    await expect(playwright.closeSessions()).resolves.toEqual(['a', 'b']);
    expect(playwright.openSessions()).toEqual([]);
    expect(browser.close).toHaveBeenCalledTimes(2);
  });

  test('a session opened with keepOpen is left running', async () => {
    await playwright.run(ctx(), writeFlow({ session: 'a', keepOpen: true, steps: [] }), {});

    await playwright.closeSessions();

    expect(browser.close).not.toHaveBeenCalled();
    // Forgotten all the same: the flow that opened it is over
    expect(playwright.hasSession('a')).toBe(false);
  });

  test('force closes it anyway', async () => {
    await playwright.run(ctx(), writeFlow({ session: 'a', keepOpen: true, steps: [] }), {});

    await playwright.closeSessions({ force: true });

    expect(browser.close).toHaveBeenCalled();
  });

  test('closing a session nobody opened is not an error', async () => {
    await expect(playwright.closeSession('nope')).resolves.toBe(false);
  });
});

describe('playwright.run - uploads', () => {
  const upload = (parameters: any, method = 'upload') =>
    run({ steps: [{ method, parameters }] });

  test('a file named by the step is uploaded from the flows directory', async () => {
    const report = writeUpload('report.txt');

    await upload({ selector: 'input[type=file]', files: './report.txt' });

    expect(page.setInputFiles).toHaveBeenCalledWith(
      'input[type=file]', [report], { timeout: undefined }
    );
  });

  test('a path with no leading ./ resolves inside the flows directory too', async () => {
    const invoice = writeUpload('invoices/march.pdf');

    await upload({ selector: '#file', files: 'invoices/march.pdf' });

    expect(page.setInputFiles).toHaveBeenCalledWith('#file', [invoice], expect.any(Object));
  });

  test('several files are uploaded at once, in the order given', async () => {
    const a = writeUpload('a.txt');
    const b = writeUpload('b.txt');

    await upload({ selector: '#file', files: ['./b.txt', './a.txt'] });

    expect(page.setInputFiles).toHaveBeenCalledWith('#file', [b, a], expect.any(Object));
  });

  test('"file" names a single upload just as well as "files"', async () => {
    const report = writeUpload('single.txt');

    await upload({ selector: '#file', file: './single.txt' });

    expect(page.setInputFiles).toHaveBeenCalledWith('#file', [report], expect.any(Object));
  });

  test('an absolute path inside the flows directory is accepted', async () => {
    const report = writeUpload('absolute.txt');

    await upload({ selector: '#file', files: report });

    expect(page.setInputFiles).toHaveBeenCalledWith('#file', [report], expect.any(Object));
  });

  test('the timeout is passed through', async () => {
    writeUpload('timed.txt');

    await upload({ selector: '#file', files: './timed.txt', timeout: 5000 });

    expect(page.setInputFiles).toHaveBeenCalledWith('#file', expect.any(Array), { timeout: 5000 });
  });

  test('setInputFiles is the same step under its playwright name', async () => {
    const report = writeUpload('aliased.txt');

    await upload({ selector: '#file', files: './aliased.txt' }, 'setInputFiles');

    expect(page.setInputFiles).toHaveBeenCalledWith('#file', [report], expect.any(Object));
  });

  test('a trigger uploads through the file chooser instead of an input', async () => {
    const report = writeUpload('chooser.txt');
    const chooser = { setFiles: jest.fn().mockResolvedValue(undefined) };
    page.waitForEvent = jest.fn().mockResolvedValue(chooser);

    await upload({ trigger: '#attach', files: './chooser.txt', timeout: 1000 });

    expect(page.waitForEvent).toHaveBeenCalledWith('filechooser', { timeout: 1000 });
    expect(page.click).toHaveBeenCalledWith('#attach', { timeout: 1000 });
    expect(chooser.setFiles).toHaveBeenCalledWith([report]);
    expect(page.setInputFiles).not.toHaveBeenCalled();
  });

  test('the flow step decides which file the yaml uploads', async () => {
    const report = writeUpload('from-the-step.txt');

    // What the markdown step wrote reaches the yaml as a parameter, exactly
    // like every other value a step passes in
    await run(
      { steps: [{ method: 'upload', parameters: { selector: '#file', files: '{{ parameters.report }}' } }] },
      { report: './from-the-step.txt' }
    );

    expect(page.setInputFiles).toHaveBeenCalledWith('#file', [report], expect.any(Object));
  });

  test('a later step can read back what was uploaded', async () => {
    const report = writeUpload('result.txt');

    await run({
      steps: [
        { slug: 'attach', method: 'upload', parameters: { selector: '#file', files: './result.txt' } },
        { method: 'fill', parameters: { selector: '#name', value: '{{ steps.attach.result.files.[0] }}' } }
      ]
    });

    expect(page.fill).toHaveBeenCalledWith('#name', report, expect.any(Object));
  });

  test('a file outside the flows directory is refused', async () => {
    await expect(upload({ selector: '#file', files: '../escape.txt' }))
      .rejects.toThrow(/outside the flows directory/);
    expect(page.setInputFiles).not.toHaveBeenCalled();
  });

  test('an absolute path outside the flows directory is refused', async () => {
    await expect(upload({ selector: '#file', files: '/etc/passwd' }))
      .rejects.toThrow(/outside the flows directory/);
  });

  test('a file that is not there is reported by name', async () => {
    await expect(upload({ selector: '#file', files: './nope.txt' }))
      .rejects.toThrow(/file not found/);
  });

  test('a directory is not a file to upload', async () => {
    fs.mkdirSync(path.join(FLOWS_DIR, 'a-folder'), { recursive: true });

    await expect(upload({ selector: '#file', files: './a-folder' }))
      .rejects.toThrow(/file not found/);
  });

  test('a step with nothing to upload says so', async () => {
    await expect(upload({ selector: '#file' })).rejects.toThrow(/no file to upload/);
    await expect(upload({ selector: '#file', files: [] })).rejects.toThrow(/no file to upload/);
    await expect(upload({ selector: '#file', files: '' })).rejects.toThrow(/no file to upload/);
  });

  test('a step with no parameters at all says so too', async () => {
    await expect(run({ steps: ['upload'] })).rejects.toThrow(/no file to upload/);
  });

  test('something that is not a path is refused', async () => {
    await expect(upload({ selector: '#file', files: [42] })).rejects.toThrow(/invalid file to upload/);
    await expect(upload({ selector: '#file', files: ['  '] })).rejects.toThrow(/invalid file to upload/);
  });
});

describe('playwright.resolveUploadFiles', () => {
  test('resolves a single path to its absolute one', async () => {
    const report = writeUpload('direct.txt');

    await expect(playwright.resolveUploadFiles('./direct.txt')).resolves.toEqual([report]);
  });

  test('trims the path a flow author left padded', async () => {
    const report = writeUpload('padded.txt');

    await expect(playwright.resolveUploadFiles('  ./padded.txt  ')).resolves.toEqual([report]);
  });

  test('refuses a path that climbs out of the flows directory', async () => {
    await expect(playwright.resolveUploadFiles('nested/../../outside.txt'))
      .rejects.toThrow(/outside the flows directory/);
  });

  test('refuses the flows directory itself', async () => {
    await expect(playwright.resolveUploadFiles('.')).rejects.toThrow(/file not found/);
  });
});
