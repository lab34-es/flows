import fs from 'fs';
import path from 'path';

import * as paths from './paths';
import * as apps from './applications';
import * as aiFlows from './aiFlows';
import * as markdownFlows from './markdownFlows';
import * as testRuns from './testRuns';

/**
 * A node of the flows tree: either a folder (with children) or a flow file.
 * Folders sort before flows, alphabetically within each group.
 */
export interface FlowTreeNode {
  type: 'folder' | 'flow';
  name: string;
  relativePath: string;
  children?: FlowTreeNode[];
  title?: string;
  path?: string;
  stepsCount?: number;
  hasErrors?: boolean;
}

const ALLOWED_FILE_FORMATS = ['md', 'markdown'];

/**
 * Generate a brand new Markdown flow from a natural language description.
 * Only available from the UI: see helpers/aiFlows.
 * @param {Object} body - { prompt }
 * @returns {Promise<{flow: string, provider: string, model: string}>}
 */
export const createAI = async (body) => aiFlows.create(body || {});

/**
 * Rewrite an existing flow following an instruction.
 * @param {Object} body - { prompt, content }
 * @returns {Promise<{flow: string, provider: string, model: string}>}
 */
export const editAI = async (body) => aiFlows.edit(body || {});

export const listCapabilities = async () => {
  return apps.summary();
};

/**
 * Build a human readable title from a flow file name.
 * @param {string} fileName
 * @returns {string}
 */
const titleFromFileName = (fileName) => {
  return fileName
    .replace(new RegExp(`\\.(${ALLOWED_FILE_FORMATS.join('|')})$`, 'i'), '')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
};

/**
 * The flow-level Xray link, out of the frontmatter "xray" block.
 * Only a trimmed, non-empty testKey makes it through: anything else is as
 * good as no link at all.
 * @param {*} source - Whatever the "xray" key holds in the file
 * @returns {Object|null} { testKey } or null
 */
const flowXray = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }

  const testKey = String(source.testKey || '').trim();
  return testKey ? { testKey } : null;
};

/**
 * Parse raw flow content into a normalized structure shared by the API and
 * the UI: { title, description, properties, segments, steps, errors }
 *
 * Segments describe the document in order, so the UI can render it as a
 * notebook: markdown segments are plain content, step segments are the
 * executable cells.
 *
 * @param {string} value - Raw file content
 * @returns {Object}
 */
const parseValue = (value) => {
  const parsed = markdownFlows.parse(value);

  return {
    title: parsed.title,
    description: parsed.description,
    version: parsed.version,
    xray: flowXray(parsed.xray),
    // The frontmatter as written, so the UI can render it as a property
    // list and the folder views can filter and sort on it
    properties: parsed.meta,
    segments: parsed.segments,
    steps: parsed.steps,
    errors: parsed.errors
  };
};

export { parseValue };

/**
 * Given the location of a flow file, return its parsed content, or null when
 * it cannot be parsed at all.
 * @param {string} flowPath
 * @returns {Object|null}
 */
const getContent = (flowPath) => {
  const fileName = path.basename(flowPath);

  let contents;

  try {
    const raw = fs.readFileSync(flowPath, 'utf8');
    const parsed = parseValue(raw);

    contents = {
      title: parsed.title,
      description: parsed.description,
      stepsCount: parsed.steps.length,
      errors: parsed.errors
    };

    if (!contents.title) {
      contents.title = titleFromFileName(fileName);
    }
  }
  catch {
    contents = null;
  }

  return contents;
};

export const getUserFlow = async (flowPath) => {
  if (!flowPath || !fs.existsSync(flowPath)) {
    return Promise.reject(new Error('Flow not found'));
  }

  // Only serve flow files that live inside the flows directory, with an
  // allowed extension — this API must not read arbitrary files from disk.
  const flowsDir = await paths.contextDir(['flows']);
  const resolved = path.resolve(flowPath);
  const relative = path.relative(flowsDir, resolved);
  const isInside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);

  const ext = path.extname(resolved).toLowerCase().substring(1);
  if (!isInside || !ALLOWED_FILE_FORMATS.includes(ext)) {
    return Promise.reject(new Error('Flow not found'));
  }

  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = parseValue(raw);

  return {
    ...parsed,
    title: parsed.title || titleFromFileName(path.basename(resolved)),
    path: resolved,
    relativePath: relative.split(path.sep).join('/'),
    plainText: raw
  };
};

/**
 * List all available flows from the flows directory
 * @returns {Promise<Array>} Array of flow objects
 */
export const list = async () => {
  const flowsDir = await paths.contextDir(['flows']);

  if (!fs.existsSync(flowsDir)) {
    return [];
  }

  const flows: Record<string, any>[] = [];
  
  const scanDirectory = (dir, relativePath = '') => {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Recursively scan subdirectories
        scanDirectory(fullPath, path.join(relativePath, item));
      } else if (stat.isFile()) {
        // Check if it's a flow file
        const ext = path.extname(item).toLowerCase().substring(1);
        if (ALLOWED_FILE_FORMATS.includes(ext)) {
          const content = getContent(fullPath);
          if (content) {
            flows.push({
              ...content,
              path: fullPath,
              relativePath: path.join(relativePath, item),
              name: content.title || item.replace(new RegExp(`\\.(${ALLOWED_FILE_FORMATS.join('|')})$`, 'i'), ''),
              category: relativePath || 'root'
            });
          }
        }
      }
    }
  };
  
  scanDirectory(flowsDir);

  return flows;
};

/**
 * Resolve a user-provided relative path inside the flows directory,
 * rejecting any attempt to escape it.
 * @param {string} relativePath
 * @returns {Promise<{flowsDir: string, absolute: string, relative: string}>}
 */
const resolveWithinFlows = async (relativePath) => {
  const flowsDir = await paths.contextDir(['flows']);
  const absolute = path.resolve(flowsDir, relativePath || '.');

  if (absolute !== flowsDir && !absolute.startsWith(flowsDir + path.sep)) {
    throw new Error('Invalid path: outside of the flows directory');
  }

  return {
    flowsDir,
    absolute,
    relative: path.relative(flowsDir, absolute)
  };
};

export { resolveWithinFlows };

/**
 * Return the flows directory as a nested tree of folders and flow files,
 * including empty folders, so the UI can render a file explorer.
 * @returns {Promise<Array>} tree nodes:
 *   { type: 'folder', name, relativePath, children }
 *   { type: 'flow', name, title, relativePath, path, stepsCount }
 */
export const tree = async () => {
  const flowsDir = await paths.contextDir(['flows']);

  if (!fs.existsSync(flowsDir)) {
    return [];
  }

  const scan = (dir, relativePath): FlowTreeNode[] => {
    const nodes: FlowTreeNode[] = [];
    const items = fs.readdirSync(dir);

    for (const item of items) {
      if (item.startsWith('.')) { continue; }

      const fullPath = path.join(dir, item);
      const itemRelative = relativePath ? path.posix.join(relativePath, item) : item;

      let stat;
      try {
        stat = fs.statSync(fullPath);
      }
      catch {
        // Broken symlink or unreadable entry: skip it instead of failing
        continue;
      }

      if (stat.isDirectory()) {
        nodes.push({
          type: 'folder',
          name: item,
          relativePath: itemRelative,
          children: scan(fullPath, itemRelative)
        });
        continue;
      }

      const ext = path.extname(item).toLowerCase().substring(1);
      if (!ALLOWED_FILE_FORMATS.includes(ext)) { continue; }

      const content = getContent(fullPath);
      nodes.push({
        type: 'flow',
        name: item,
        title: (content && content.title) || titleFromFileName(item),
        relativePath: itemRelative,
        path: fullPath,
        stepsCount: content ? content.stepsCount : 0,
        hasErrors: Boolean(content && content.errors && content.errors.length)
      });
    }

    // Folders first, then flows; alphabetical within each group
    return nodes.sort((a, b) => {
      if (a.type !== b.type) { return a.type === 'folder' ? -1 : 1; }
      return a.name.localeCompare(b.name);
    });
  };

  return scan(flowsDir, '');
};

/**
 * Create a folder inside the flows directory.
 * @param {string} relativePath
 */
export const createFolder = async (relativePath) => {
  if (!relativePath || !relativePath.trim()) {
    throw new Error('Folder path is required');
  }

  const { absolute, relative } = await resolveWithinFlows(relativePath);

  if (!relative) {
    throw new Error('Folder path is required');
  }

  fs.mkdirSync(absolute, { recursive: true });
  return { relativePath: relative };
};

/**
 * Create or update a flow file inside the flows directory.
 * @param {Object} options
 * @param {string} options.relativePath - File path relative to the flows dir
 * @param {string} options.content - File content
 * @param {boolean} options.overwrite - Allow overwriting an existing file
 */
export const saveFile = async ({ relativePath, content, overwrite = false }) => {
  if (!relativePath || !relativePath.trim()) {
    throw new Error('File path is required');
  }

  const ext = path.extname(relativePath).toLowerCase().substring(1);
  if (!ALLOWED_FILE_FORMATS.includes(ext)) {
    throw new Error(`Unsupported file format ".${ext}". Allowed: ${ALLOWED_FILE_FORMATS.join(', ')}`);
  }

  const { absolute, relative } = await resolveWithinFlows(relativePath);

  if (fs.existsSync(absolute)) {
    if (fs.statSync(absolute).isDirectory()) {
      throw new Error('A folder with that name already exists');
    }
    if (!overwrite) {
      const err: NodeJS.ErrnoException = new Error('File already exists');
      err.code = 'EEXISTS';
      throw err;
    }
  }

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content ?? '', 'utf8');

  return { relativePath: relative, path: absolute };
};

/**
 * Rewrite the frontmatter of a flow, leaving its body untouched.
 *
 * "title" and "description" are written first, because the document view
 * renders them above the property list and reading the file should match what
 * the UI shows.
 *
 * @param {Object} options
 * @param {string} options.relativePath - Flow path relative to the flows dir
 * @param {Object} options.properties - The frontmatter to write
 * @returns {Promise<Object>} { relativePath, path, properties }
 */
export const saveProperties = async ({ relativePath, properties }) => {
  if (!relativePath || !relativePath.trim()) {
    throw new Error('File path is required');
  }

  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error('"properties" must be an object');
  }

  const { absolute, relative } = await resolveWithinFlows(relativePath);

  if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) {
    throw new Error('Flow not found');
  }

  // An empty text property is written as a bare "key:" rather than 'key: ""',
  // so a property that exists but has no value yet reads as one
  const normalize = (value) => (value === '' ? null : value);

  const ordered = {};
  ['title', 'description'].forEach(key => {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      ordered[key] = normalize(properties[key]);
    }
  });
  Object.entries(properties).forEach(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(ordered, key)) {
      ordered[key] = normalize(value);
    }
  });

  const raw = fs.readFileSync(absolute, 'utf8');
  const next = markdownFlows.withFrontmatter(raw, ordered);

  fs.writeFileSync(absolute, next, 'utf8');

  return { relativePath: relative, path: absolute, properties: ordered, plainText: next };
};

/**
 * Rename (or move, when the new path has folders) a flow file or a folder
 * inside the flows directory.
 * @param {string} fromPath - Existing path, relative to the flows dir
 * @param {string} toPath - New path, relative to the flows dir
 */
export const rename = async (fromPath, toPath) => {
  if (!fromPath || !fromPath.trim() || !toPath || !toPath.trim()) {
    throw new Error('Both the current and the new path are required');
  }

  const from = await resolveWithinFlows(fromPath);
  const to = await resolveWithinFlows(toPath);

  if (!from.relative || !to.relative) {
    throw new Error('Refusing to rename the flows directory itself');
  }

  if (!fs.existsSync(from.absolute)) {
    throw new Error('Path not found');
  }

  const isFolder = fs.statSync(from.absolute).isDirectory();

  if (!isFolder) {
    const ext = path.extname(to.absolute).toLowerCase().substring(1);
    if (!ALLOWED_FILE_FORMATS.includes(ext)) {
      throw new Error(`Unsupported file format ".${ext}". Allowed: ${ALLOWED_FILE_FORMATS.join(', ')}`);
    }
  }

  if (from.absolute === to.absolute) {
    return { relativePath: to.relative, previousPath: from.relative, path: to.absolute };
  }

  // Changing only the casing is a no-op collision on case-insensitive file
  // systems, so only guard against a genuinely different target
  if (fs.existsSync(to.absolute) && from.absolute.toLowerCase() !== to.absolute.toLowerCase()) {
    const error: NodeJS.ErrnoException = new Error('A file or folder with that name already exists');
    error.code = 'EEXISTS';
    throw error;
  }

  if (isFolder && to.absolute.startsWith(from.absolute + path.sep)) {
    throw new Error('Cannot move a folder inside itself');
  }

  fs.mkdirSync(path.dirname(to.absolute), { recursive: true });
  fs.renameSync(from.absolute, to.absolute);

  return { relativePath: to.relative, previousPath: from.relative, path: to.absolute };
};

/**
 * Delete a flow file or folder inside the flows directory.
 * @param {string} relativePath
 */
export const remove = async (relativePath) => {
  if (!relativePath || !relativePath.trim()) {
    throw new Error('Path is required');
  }

  const { absolute, relative } = await resolveWithinFlows(relativePath);

  if (!relative) {
    throw new Error('Refusing to delete the flows directory itself');
  }

  // lstat instead of existsSync so broken symlinks can still be deleted
  let exists = true;
  try {
    fs.lstatSync(absolute);
  }
  catch {
    exists = false;
  }

  if (!exists) {
    throw new Error('Path not found');
  }

  fs.rmSync(absolute, { recursive: true, force: true });
  return { relativePath: relative };
};

/**
 * Method called from API
 *
 * @param {*} body
 * @returns
 */
export const start = async (body, opts) => {
  const {
    value,
    environment,
    path: flowRelativePath // where the flow lives, so the test run can name its copy
  } = body;

  const {
    io // socketio instance
  } = opts;

  const required = ['value', 'environment'];

  if (!required.every(key => body[key])) {
    return Promise.reject(new Error('Invalid request: "value" and "environment" are required'));
  }

  // Throws a descriptive error when a step block contains invalid YAML
  const flowAsJson = markdownFlows.toFlow(value);

  if (!flowAsJson || !Array.isArray(flowAsJson.steps) || !flowAsJson.steps.length) {
    return Promise.reject(new Error('Flow has no steps to execute'));
  }

  // Make sure application methods are loaded (the CLI does this itself,
  // but API-triggered runs need it too)
  await apps.loadAll();

  // Everything the flow needs to run on this environment, before a test run
  // is recorded for something that cannot start: the environment has to
  // exist, and every application the flow uses needs its env file. Only
  // those: the environment does not have to be declared everywhere.
  const readiness = await apps.environmentReadiness(flowAsJson.steps, environment);
  const notReady = apps.readinessError(readiness);

  if (notReady) {
    return Promise.reject(new Error(notReady));
  }

  const runner = require(`./runner/v${flowAsJson.version || '1'}`);

  if (typeof runner.isRunning === 'function' && runner.isRunning()) {
    return Promise.reject(new Error('Another flow is already running. Wait for it to finish.'));
  }

  // Deciding to run is what creates the test run; the copy with the results
  // is written by onFinished when the runner is done
  const file = await testRuns.copyFileName({ relativePath: flowRelativePath, title: flowAsJson.title });
  const record = await testRuns.single({
    trigger: 'flow',
    environment,
    file,
    title: flowAsJson.title,
    content: value,
    io
  });

  let result;
  try {
    result = await runner.run(flowAsJson, {
      environment,
      reporter: {
        cli: false,
        server: io
      },
      onFinished: record.onFinished
    });
  }
  catch (ex) {
    record.discard();
    throw ex;
  }

  // The runner refuses to start when another flow is already running
  if (!result) {
    record.discard();
    return Promise.reject(new Error('Another flow is already running. Wait for it to finish.'));
  }

  return result;
};
