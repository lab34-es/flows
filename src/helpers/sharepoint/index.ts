import fs from 'fs';
import path from 'path';

import * as configHelper from '../config';
import * as env from '../env';
import * as client from './client';

/**
 * SharePoint integration.
 *
 * When a test run finishes, its standalone HTML report can be uploaded to a
 * SharePoint document library on its own, so the people who never open this
 * tool -- and the CI job that has no UI at all -- still get the report where
 * they already look for documents.
 *
 * The settings live in the context folder, at config/sharepoint.json:
 *
 *   {
 *     "enabled": true,
 *     "tenantId": "00000000-0000-0000-0000-000000000000",
 *     "clientId": "00000000-0000-0000-0000-000000000000",
 *     "siteUrl": "https://acme.sharepoint.com/sites/QA",
 *     "libraryName": "Documents",
 *     "folderPath": "Test reports/{environment}",
 *     "fileName": "{runId}-{status}.html",
 *     "uploadOn": "always"
 *   }
 *
 * The client secret is the one thing that is not in there: it is written to
 * the context's own `.env` file, as SHAREPOINT_CLIENT_SECRET. See ../env.
 */

const CONFIG_NAME = 'sharepoint';

/** The variable of the context .env that holds the client secret. */
const SECRET_ENV_KEY = 'SHAREPOINT_CLIENT_SECRET';

const DEFAULT_FOLDER_PATH = 'Test reports';
const DEFAULT_FILE_NAME = '{runId}.html';

/** When a finished run is uploaded. */
const UPLOAD_ON = [
  { id: 'always', label: 'Every run', hint: 'Upload the report of every finished run.' },
  { id: 'failed', label: 'Failed runs only', hint: 'Upload only when the run has at least one failing flow.' }
];

const UPLOAD_ON_IDS = UPLOAD_ON.map(item => item.id);

/** What a folder path and a file name can be written in terms of. */
const PLACEHOLDERS = [
  { token: '{runId}', hint: 'The run folder name, e.g. 2026-08-20_14-30-05-staging' },
  { token: '{status}', hint: '"passed" or "failed"' },
  { token: '{environment}', hint: 'The environment the run went against' },
  { token: '{trigger}', hint: '"flow", "folder" or "cli"' },
  { token: '{date}', hint: 'The day the run started, as 2026-08-20' },
  { token: '{time}', hint: 'The time it started, as 14-30-05' }
];

export { CONFIG_NAME, SECRET_ENV_KEY, UPLOAD_ON, UPLOAD_ON_IDS, PLACEHOLDERS, DEFAULT_FOLDER_PATH, DEFAULT_FILE_NAME };

/**
 * Trim a URL so it can be concatenated with a path.
 * @param {*} value
 * @returns {string}
 */
const cleanUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

/**
 * A folder path as the settings store it: forward slashes, no leading or
 * trailing ones, no "." or ".." segments.
 * @param {*} value
 * @returns {string}
 */
const cleanFolderPath = (value) => String(value || '')
  .replace(/\\/g, '/')
  .split('/')
  .map(part => part.trim())
  .filter(part => part && part !== '.' && part !== '..')
  .join('/');

export { cleanFolderPath };

/**
 * Normalize a raw config file into the current shape.
 * @param {Object} raw - Contents of config/sharepoint.json
 * @returns {Object}
 */
const normalize = (raw) => {
  const source = (raw && typeof raw === 'object') ? raw : {};

  return {
    enabled: Boolean(source.enabled),
    tenantId: String(source.tenantId || '').trim(),
    clientId: String(source.clientId || '').trim(),
    siteUrl: cleanUrl(source.siteUrl),
    libraryName: String(source.libraryName || '').trim(),
    folderPath: cleanFolderPath(source.folderPath === undefined ? DEFAULT_FOLDER_PATH : source.folderPath),
    fileName: String(source.fileName || '').trim() || DEFAULT_FILE_NAME,
    uploadOn: UPLOAD_ON_IDS.includes(source.uploadOn) ? source.uploadOn : UPLOAD_ON_IDS[0]
  };
};

export { normalize };

/**
 * The settings as stored on disk, with the client secret read back from the
 * context's .env. Internal use only -- this is the one shape that carries
 * the secret.
 * @returns {Promise<Object>}
 */
const loadSettings = async () => {
  const settings = normalize(await configHelper.load(CONFIG_NAME));
  return { ...settings, clientSecret: await env.read(SECRET_ENV_KEY) };
};

export { loadSettings };

/**
 * Whether the integration has everything it needs to reach SharePoint.
 * @param {Object} settings - Full settings, as returned by loadSettings
 * @returns {boolean}
 */
const isConfigured = (settings) => Boolean(
  settings
  && settings.tenantId
  && settings.clientId
  && settings.clientSecret
  && settings.siteUrl
);

export { isConfigured };

/**
 * Settings as the UI sees them: no secret, just whether one is stored.
 * @returns {Promise<Object>}
 */
const getSettings = async () => {
  const settings = await loadSettings();

  return {
    enabled: settings.enabled,
    tenantId: settings.tenantId,
    clientId: settings.clientId,
    siteUrl: settings.siteUrl,
    libraryName: settings.libraryName,
    folderPath: settings.folderPath,
    fileName: settings.fileName,
    uploadOn: settings.uploadOn,
    hasClientSecret: Boolean(settings.clientSecret),
    // So the UI can say where the secret went, and where to put it by hand
    secretEnvKey: SECRET_ENV_KEY,
    envFile: env.FILE,
    configFile: `config/${CONFIG_NAME}.json`,
    available: UPLOAD_ON,
    placeholders: PLACEHOLDERS,
    defaults: { folderPath: DEFAULT_FOLDER_PATH, fileName: DEFAULT_FILE_NAME },
    configured: isConfigured(settings)
  };
};

export { getSettings };

/**
 * Update the settings. The client secret is written to the context's .env
 * rather than to the config file: undefined keeps the stored one (the UI
 * never receives it, so it cannot send it back), null clears it.
 *
 * @param {Object} body - { enabled, tenantId, clientId, clientSecret, siteUrl,
 *                          libraryName, folderPath, fileName, uploadOn }
 * @returns {Promise<Object>} The public settings, as returned by getSettings
 */
const saveSettings = async (body) => {
  const input = (body && typeof body === 'object') ? body : {};
  const current = await loadSettings();

  if (input.uploadOn !== undefined && !UPLOAD_ON_IDS.includes(input.uploadOn)) {
    throw new Error(`Unknown upload rule "${input.uploadOn}"`);
  }

  const next = {
    enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled),
    tenantId: input.tenantId === undefined ? current.tenantId : String(input.tenantId || '').trim(),
    clientId: input.clientId === undefined ? current.clientId : String(input.clientId || '').trim(),
    siteUrl: input.siteUrl === undefined ? current.siteUrl : cleanUrl(input.siteUrl),
    libraryName: input.libraryName === undefined
      ? current.libraryName
      : String(input.libraryName || '').trim(),
    folderPath: input.folderPath === undefined ? current.folderPath : cleanFolderPath(input.folderPath),
    fileName: input.fileName === undefined
      ? current.fileName
      : (String(input.fileName || '').trim() || DEFAULT_FILE_NAME),
    uploadOn: input.uploadOn || current.uploadOn
  };

  if (next.siteUrl && !/^https?:\/\//i.test(next.siteUrl)) {
    throw new Error('The SharePoint site URL must start with http:// or https://');
  }

  if (next.siteUrl) {
    // Fails on anything Graph could not address, before it is stored
    client.parseSiteUrl(next.siteUrl);
  }

  if (/[\\/]/.test(next.fileName.replace(/\{[^}]*\}/g, ''))) {
    throw new Error('The file name cannot contain slashes. Use the folder path for that.');
  }

  if (next.enabled && !next.siteUrl) {
    throw new Error('Add the SharePoint site URL before enabling the upload.');
  }

  await configHelper.save(CONFIG_NAME, next);

  if (input.clientSecret !== undefined) {
    await env.write(SECRET_ENV_KEY, input.clientSecret === null ? null : String(input.clientSecret).trim());
  }

  // The next upload must authenticate with whatever was just configured
  client.resetToken();

  return getSettings();
};

export { saveSettings };

/**
 * Validate the stored credentials against SharePoint.
 * @returns {Promise<Object>} { message, site, library }
 */
const test = async () => {
  const settings = await loadSettings();

  if (!isConfigured(settings)) {
    throw new Error('Add the tenant id, the application id, the client secret and the site URL first.');
  }

  return client.verify(settings);
};

export { test };

/**
 * A file-system-safe version of one placeholder's value: SharePoint refuses
 * a handful of characters in a name, and so does everything downstream.
 * @param {*} value
 * @returns {string}
 */
const safe = (value) => String(value ?? '')
  .replace(/[\\/:*?"<>|#%]+/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * Replace the {placeholders} of a folder path or file name with what the run
 * they belong to says. An unknown placeholder is left alone rather than
 * silently emptied -- a name with a visible `{typo}` in it is easier to
 * understand than a name missing a piece.
 *
 * @param {string} template
 * @param {Object} summary - The run.json document
 * @returns {string}
 */
const render = (template, summary) => {
  const start = (summary && summary.times && summary.times.start) || Date.now();
  const at = new Date(start);
  const pad = (value) => String(value).padStart(2, '0');

  const values = {
    runId: summary && summary.id,
    status: summary && summary.status,
    environment: summary && summary.environment,
    trigger: summary && summary.trigger,
    date: [at.getFullYear(), pad(at.getMonth() + 1), pad(at.getDate())].join('-'),
    time: [pad(at.getHours()), pad(at.getMinutes()), pad(at.getSeconds())].join('-')
  };

  return String(template || '').replace(/\{(\w+)\}/g, (whole, key) => (
    key in values ? safe(values[key]) : whole
  ));
};

export { render };

/**
 * Whether a finished run is one the settings ask to upload.
 * @param {Object} settings - Full settings
 * @param {Object} summary - The run.json document
 * @returns {boolean}
 */
const shouldUpload = (settings, summary) => {
  if (!settings.enabled || !isConfigured(settings)) { return false; }
  if (settings.uploadOn === 'failed') { return summary && summary.status === 'failed'; }
  return true;
};

export { shouldUpload };

/**
 * Upload the HTML report of a finished run.
 *
 * Answers with what happened rather than throwing: the caller records it in
 * the run summary, and an upload that failed must never turn a run that
 * passed into a failure.
 *
 * @param {Object} options
 * @param {string} options.dir - The run folder
 * @param {string} options.file - Name of the report inside it
 * @param {Object} options.summary - The run.json document
 * @returns {Promise<Object|null>} null when this run is not to be uploaded
 */
const uploadReport = async ({ dir, file, summary }) => {
  const settings = await loadSettings();

  if (!shouldUpload(settings, summary)) { return null; }

  const reportPath = path.join(dir, file);

  if (!fs.existsSync(reportPath)) {
    return { target: 'sharepoint', status: 'failed', at: Date.now(), error: 'The run has no HTML report to upload.' };
  }

  const folderPath = cleanFolderPath(render(settings.folderPath, summary));
  const fileName = safe(render(settings.fileName, summary)) || `${summary.id}.html`;

  try {
    const uploaded = await client.upload(settings, {
      folderPath,
      fileName,
      content: fs.readFileSync(reportPath),
      contentType: 'text/html'
    });

    return {
      target: 'sharepoint',
      status: 'uploaded',
      at: Date.now(),
      path: uploaded.path,
      url: uploaded.url,
      library: uploaded.library,
      site: uploaded.site
    };
  }
  catch (ex) {
    return {
      target: 'sharepoint',
      status: 'failed',
      at: Date.now(),
      path: [folderPath, fileName].filter(Boolean).join('/'),
      error: (ex && ex.message) || String(ex)
    };
  }
};

export { uploadReport };
