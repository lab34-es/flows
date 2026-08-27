// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

// The settings live in the user's context folder: keep them in memory instead
jest.mock('../../src/helpers/config', () => {
  let stored = {};
  return {
    load: jest.fn(async () => stored),
    save: jest.fn(async (name, data) => { stored = data; return data; }),
    __set: (value) => { stored = value; },
    __get: () => stored
  };
});

// ...and so does the .env the client secret is written to
jest.mock('../../src/helpers/env', () => {
  let stored: Record<string, string> = {};
  return {
    FILE: '.env',
    filePath: jest.fn(async () => '/context/.env'),
    readAll: jest.fn(async () => stored),
    read: jest.fn(async (key) => stored[key]),
    write: jest.fn(async (key, value) => {
      if (value) { stored[key] = String(value); }
      else { delete stored[key]; }
    }),
    __set: (value) => { stored = value; },
    __get: () => stored
  };
});

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn()
}));

import fs from 'fs';
import os from 'os';
import path from 'path';

import axios from 'axios';
import * as configHelper from '../../src/helpers/config';
import * as env from '../../src/helpers/env';
import * as sharepoint from '../../src/helpers/sharepoint';
import * as client from '../../src/helpers/sharepoint/client';

const SETTINGS = {
  enabled: true,
  tenantId: 'tenant-id',
  clientId: 'client-id',
  siteUrl: 'https://acme.sharepoint.com/sites/QA',
  libraryName: '',
  folderPath: 'Test reports',
  fileName: '{runId}.html',
  uploadOn: 'always'
};

const SUMMARY = {
  id: '2026-08-20_14-30-05-staging',
  trigger: 'folder',
  environment: 'staging',
  status: 'failed',
  times: { start: Date.parse('2026-08-20T12:30:05Z') },
  flows: []
};

/** Graph answering the site and drive lookups an upload starts with. */
const graphFinds = () => {
  (axios.post as jest.Mock).mockResolvedValue({ data: { access_token: 'jwt', expires_in: 3600 } });
  (axios.get as jest.Mock).mockImplementation(async (url) => {
    if (url.endsWith('/sites/site-id/drive')) {
      return { data: { id: 'drive-id', name: 'Documents' } };
    }
    if (url.endsWith('/sites/site-id/drives')) {
      return { data: { value: [{ id: 'drive-id', name: 'Documents' }, { id: 'other-id', name: 'Reports' }] } };
    }
    if (url.includes('/sites/acme.sharepoint.com')) {
      return { data: { id: 'site-id', displayName: 'QA', webUrl: 'https://acme.sharepoint.com/sites/QA' } };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
};

beforeEach(() => {
  (configHelper as any).__set({});
  (env as any).__set({});
  (axios.get as jest.Mock).mockReset();
  (axios.post as jest.Mock).mockReset();
  (axios.put as jest.Mock).mockReset();
  client.resetToken();
});

describe('settings', () => {
  test('describes an empty configuration', async () => {
    const settings = await sharepoint.getSettings();

    expect(settings.configured).toBe(false);
    expect(settings.enabled).toBe(false);
    expect(settings.uploadOn).toBe('always');
    expect(settings.folderPath).toBe('Test reports');
    expect(settings.fileName).toBe('{runId}.html');
    expect(settings.secretEnvKey).toBe('SHAREPOINT_CLIENT_SECRET');
  });

  test('never sends the client secret to the client', async () => {
    (configHelper as any).__set(SETTINGS);
    (env as any).__set({ SHAREPOINT_CLIENT_SECRET: 'super-secret' });

    const settings = await sharepoint.getSettings();

    expect(JSON.stringify(settings)).not.toContain('super-secret');
    expect(settings.hasClientSecret).toBe(true);
    expect(settings.configured).toBe(true);
  });

  test('stores the secret in the context .env, not in the config file', async () => {
    await sharepoint.saveSettings({
      ...SETTINGS,
      clientSecret: 'super-secret'
    });

    expect(JSON.stringify((configHelper as any).__get())).not.toContain('super-secret');
    expect((env as any).__get().SHAREPOINT_CLIENT_SECRET).toBe('super-secret');
  });

  test('keeps the stored secret when the client sends none, and clears it on null', async () => {
    (env as any).__set({ SHAREPOINT_CLIENT_SECRET: 'super-secret' });

    await sharepoint.saveSettings(SETTINGS);
    expect((env as any).__get().SHAREPOINT_CLIENT_SECRET).toBe('super-secret');

    await sharepoint.saveSettings({ clientSecret: null });
    expect((env as any).__get().SHAREPOINT_CLIENT_SECRET).toBeUndefined();
  });

  test('tidies the folder path and refuses a file name with a folder in it', async () => {
    const settings = await sharepoint.saveSettings({ ...SETTINGS, folderPath: '/Reports/../{environment}/ ' });
    expect(settings.folderPath).toBe('Reports/{environment}');

    await expect(sharepoint.saveSettings({ fileName: 'reports/{runId}.html' }))
      .rejects.toThrow(/cannot contain slashes/);
  });

  test('refuses a site URL that is not one, and an unknown upload rule', async () => {
    await expect(sharepoint.saveSettings({ siteUrl: 'acme.sharepoint.com' }))
      .rejects.toThrow(/must start with http/);

    await expect(sharepoint.saveSettings({ siteUrl: 'https://acme sharepoint.com/sites/QA' }))
      .rejects.toThrow(/is not a SharePoint site URL/);

    await expect(sharepoint.saveSettings({ uploadOn: 'sometimes' }))
      .rejects.toThrow(/Unknown upload rule/);
  });

  test('refuses to enable the upload with nowhere to upload to', async () => {
    await expect(sharepoint.saveSettings({ enabled: true }))
      .rejects.toThrow(/site URL/);
  });

  test('testing the connection says what is missing before it calls anyone', async () => {
    await expect(sharepoint.test()).rejects.toThrow(/tenant id/);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('testing the connection resolves the site and the library', async () => {
    (configHelper as any).__set({ ...SETTINGS, libraryName: 'Reports' });
    (env as any).__set({ SHAREPOINT_CLIENT_SECRET: 'super-secret' });
    graphFinds();

    const result = await sharepoint.test();

    expect(result.site).toBe('QA');
    expect(result.library).toBe('Reports');
  });

  test('says so when the library does not exist', async () => {
    (configHelper as any).__set({ ...SETTINGS, libraryName: 'Nowhere' });
    (env as any).__set({ SHAREPOINT_CLIENT_SECRET: 'super-secret' });
    graphFinds();

    await expect(sharepoint.test()).rejects.toThrow(/no document library called "Nowhere"/);
  });
});

describe('naming', () => {
  test('writes a name in terms of the run', () => {
    expect(sharepoint.render('{runId}-{status}.html', SUMMARY))
      .toBe('2026-08-20_14-30-05-staging-failed.html');
    expect(sharepoint.render('Reports/{environment}/{trigger}', SUMMARY))
      .toBe('Reports/staging/folder');
  });

  test('leaves an unknown placeholder alone rather than emptying it', () => {
    expect(sharepoint.render('{typo}-{runId}.html', SUMMARY))
      .toBe('{typo}-2026-08-20_14-30-05-staging.html');
  });

  test('replaces the characters SharePoint refuses in a name', () => {
    expect(sharepoint.render('{environment}.html', { ...SUMMARY, environment: 'stag/ing:*' }))
      .toBe('stag-ing-.html');
  });
});

describe('shouldUpload', () => {
  const configured = { ...SETTINGS, clientSecret: 'super-secret' };

  test('is off unless the integration is both enabled and configured', () => {
    expect(sharepoint.shouldUpload(configured, SUMMARY)).toBe(true);
    expect(sharepoint.shouldUpload({ ...configured, enabled: false }, SUMMARY)).toBe(false);
    expect(sharepoint.shouldUpload({ ...configured, clientSecret: undefined }, SUMMARY)).toBe(false);
  });

  test('"failed runs only" skips a run that passed', () => {
    const onFailure = { ...configured, uploadOn: 'failed' };
    expect(sharepoint.shouldUpload(onFailure, SUMMARY)).toBe(true);
    expect(sharepoint.shouldUpload(onFailure, { ...SUMMARY, status: 'passed' })).toBe(false);
  });
});

describe('uploadReport', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab34-sharepoint-'));
    (configHelper as any).__set(SETTINGS);
    (env as any).__set({ SHAREPOINT_CLIENT_SECRET: 'super-secret' });
  });

  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('uploads the report and answers where it landed', async () => {
    fs.writeFileSync(path.join(dir, 'report.html'), '<html>the report</html>');
    graphFinds();
    (axios.put as jest.Mock).mockResolvedValue({
      data: { name: '2026-08-20_14-30-05-staging.html', size: 23, webUrl: 'https://acme.sharepoint.com/r.html' }
    });

    const result = await sharepoint.uploadReport({ dir, file: 'report.html', summary: SUMMARY });

    expect(result).toMatchObject({
      target: 'sharepoint',
      status: 'uploaded',
      path: 'Test reports/2026-08-20_14-30-05-staging.html',
      url: 'https://acme.sharepoint.com/r.html',
      library: 'Documents',
      site: 'QA'
    });

    const [url, body, options] = (axios.put as jest.Mock).mock.calls[0];
    expect(url).toContain('/drives/drive-id/root:/Test%20reports/2026-08-20_14-30-05-staging.html:/content');
    expect(url).toContain('conflictBehavior=replace');
    expect(body.toString()).toBe('<html>the report</html>');
    expect(options.headers.Authorization).toBe('Bearer jwt');
  });

  test('does nothing when the integration is off', async () => {
    (configHelper as any).__set({ ...SETTINGS, enabled: false });

    expect(await sharepoint.uploadReport({ dir, file: 'report.html', summary: SUMMARY })).toBeNull();
    expect(axios.put).not.toHaveBeenCalled();
  });

  test('answers with the failure rather than throwing it', async () => {
    fs.writeFileSync(path.join(dir, 'report.html'), '<html>the report</html>');
    graphFinds();
    (axios.put as jest.Mock).mockRejectedValue({
      response: { status: 403, data: { error: { code: 'accessDenied', message: 'Access denied' } } }
    });

    const result = await sharepoint.uploadReport({ dir, file: 'report.html', summary: SUMMARY });

    expect(result).toMatchObject({ status: 'failed', path: 'Test reports/2026-08-20_14-30-05-staging.html' });
    expect(result!.error).toContain('Access denied');
    expect(result!.error).toContain('403');
  });

  test('a run with no report on disk is a failure, not a crash', async () => {
    graphFinds();

    const result = await sharepoint.uploadReport({ dir, file: 'report.html', summary: SUMMARY });

    expect(result).toMatchObject({ status: 'failed' });
    expect(result!.error).toContain('no HTML report');
  });
});
