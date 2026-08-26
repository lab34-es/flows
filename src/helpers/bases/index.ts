import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

import * as paths from '../paths';
import * as flows from '../flows';
import * as expression from './expression';

/** One sort clause of a view. */
export interface ViewSort {
  property: string;
  direction: 'ASC' | 'DESC';
}

/** A single view (table or list) declared in views.yaml. */
export interface View {
  type: 'table' | 'list';
  name: string;
  /** The name as the CLI's --view takes it: lowercase, dash separated */
  slug: string;
  filters: any;
  order: string[];
  sort: ViewSort[];
  columnSize: Record<string, number>;
}

/** A normalized views.yaml document. */
export interface BasesDocument {
  filters: any;
  formulas: Record<string, string>;
  properties: Record<string, { displayName: string }>;
  views: View[];
}

/** One flow file discovered under the flows directory. */
export interface FlowEntry {
  absolutePath: string;
  relativePath: string;
  parsed: any;
  stat: any;
}

/**
 * "Bases": the saved views a folder of flows is rendered with.
 *
 * Every view lives in a single `views.yaml` file at the root of the context
 * directory, in the same shape Obsidian Bases uses:
 *
 *   filters:            # applied to every view
 *     and:
 *       - 'flow.steps > 0'
 *   formulas:
 *     coverage: 'if(note.reviewed, "✅", "⚠️")'
 *   properties:
 *     note.owner:
 *       displayName: Owner
 *   views:
 *     - type: table
 *       name: All flows
 *       filters:
 *         and:
 *           - 'note.priority == "high"'
 *       order: [file.name, note.owner, formula.coverage]
 *       sort:
 *         - property: note.owner
 *           direction: ASC
 *       columnSize:
 *         note.owner: 160
 *
 * Views are not tied to a folder: the same view can be opened on any folder
 * of the flows tree, and the folder simply scopes which flows it lists.
 */

const VIEWS_FILE = 'views.yaml';

// Where a column id can point. Anything else is shorthand for a frontmatter
// property, so `owner` and `note.owner` are the same column.
const NAMESPACES = ['note', 'file', 'flow', 'formula'];

// Frontmatter keys that the document view renders on their own, above the
// property list — they are still ordinary properties everywhere else.
const HEADLINE_PROPERTIES = ['title', 'description'];

const FILE_PROPERTIES = ['file.name', 'file.basename', 'file.path', 'file.folder', 'file.ext',
  'file.size', 'file.ctime', 'file.mtime', 'file.tags'];

const FLOW_PROPERTIES = ['flow.title', 'flow.description', 'flow.steps',
  'flow.hasErrors'];

// How deep the fields of an embedded frontmatter object are offered as
// columns of their own
const MAX_PROPERTY_DEPTH = 4;

const DEFAULT_VIEW = {
  type: 'table',
  name: 'All flows',
  order: ['file.name', 'note.title', 'note.description', 'flow.steps']
};

/* ---------------------------------------------------------------- helpers */

/**
 * Fully qualify a column id: a bare name means a frontmatter property.
 * @param {string} id
 * @returns {string}
 */
const normalizeProperty = (id) => {
  const name = String(id ?? '').trim();
  if (!name) { return ''; }
  const namespace = name.split('.')[0];
  return NAMESPACES.includes(namespace) && name.includes('.') ? name : `note.${name}`;
};

export { normalizeProperty };

/**
 * One segment of a property id, as a person would write it.
 * @param {string} part
 * @returns {string}
 */
const humanize = (part) => String(part)
  .replace(/[_-]+/g, ' ')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/^\w/, letter => letter.toUpperCase());

/**
 * The label a column falls back to when `properties` gives it no displayName:
 * the bare property name, with separators turned into spaces.
 * @param {string} id - A normalized column id
 * @returns {string}
 */
const defaultDisplayName = (id) => {
  const segments = String(id).split('.').slice(1);
  // A nested frontmatter field reads as its whole path -- "xray.testKey" is
  // "Xray Test Key", which still tells the two "testKey" columns of a
  // document apart
  return (segments.length ? segments : [String(id)]).map(humanize).join(' ');
};

export { defaultDisplayName };

/**
 * The name of a view as the CLI takes it: what `--view` is given, and what
 * the "Copy CLI command" dialog writes out.
 * @param {string} name
 * @returns {string}
 */
const viewSlug = (name) => String(name ?? '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

export { viewSlug };

/**
 * The view a `--view` (or `?view=`) argument means: its exact name, its name
 * however it was capitalized, or its slug.
 * @param {Array<Object>} views - Normalized views
 * @param {string} wanted
 * @returns {Object|null} null when nothing matches
 */
const findView = (views, wanted) => {
  const needle = String(wanted ?? '').trim();
  if (!needle) { return views[0] || null; }

  const slug = viewSlug(needle);

  return views.find(view => view.name === needle)
    || views.find(view => view.name.toLowerCase() === needle.toLowerCase())
    || (slug ? views.find(view => view.slug === slug) : null)
    || null;
};

export { findView };

/**
 * The tags of a flow, out of its frontmatter: a list, or a comma/space
 * separated string, with any leading "#" dropped.
 * @param {Object} meta - Frontmatter
 * @returns {Array<string>}
 */
const tagsOf = (meta) => {
  const raw = (meta && (meta.tags ?? meta.tag)) ?? [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/);
  return list
    .map(tag => String(tag ?? '').trim().replace(/^#/, ''))
    .filter(Boolean);
};

/* ------------------------------------------------------------ the document */

/**
 * Normalize a views document read from disk (or sent by the UI), so the rest
 * of the code never has to guard against a half-written file.
 * @param {*} raw
 * @returns {Object} { filters, formulas, properties, views }
 */
const normalizeDocument = (raw): BasesDocument => {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};

  const formulas = {};
  if (source.formulas && typeof source.formulas === 'object' && !Array.isArray(source.formulas)) {
    Object.entries(source.formulas).forEach(([name, formula]) => {
      if (typeof formula === 'string' && formula.trim()) {
        formulas[name] = formula;
      }
    });
  }

  const properties: Record<string, { displayName: string }> = {};
  if (source.properties && typeof source.properties === 'object' && !Array.isArray(source.properties)) {
    Object.entries(source.properties).forEach(([id, config]) => {
      if (!config || typeof config !== 'object' || Array.isArray(config)) { return; }
      const displayName = String((config as Record<string, any>).displayName ?? '').trim();
      if (displayName) {
        properties[normalizeProperty(id)] = { displayName };
      }
    });
  }

  const rawViews = (Array.isArray(source.views) ? source.views : [])
    .filter(view => view && typeof view === 'object' && !Array.isArray(view));

  // Two views can be named so alike that they slug the same; the second one
  // gets a number, the way a duplicated file does
  const takenSlugs = new Set<string>();
  const uniqueSlug = (name, index) => {
    const base = viewSlug(name) || `view-${index + 1}`;
    let slug = base;
    let attempt = 2;
    while (takenSlugs.has(slug)) {
      slug = `${base}-${attempt}`;
      attempt += 1;
    }
    takenSlugs.add(slug);
    return slug;
  };

  // A document with no usable view still opens: it falls back to the default
  const views = (rawViews.length ? rawViews : [DEFAULT_VIEW])
    .map((view, index) => ({
      type: view.type === 'list' ? 'list' : 'table',
      name: String(view.name ?? '').trim() || `View ${index + 1}`,
      slug: uniqueSlug(String(view.name ?? '').trim() || `View ${index + 1}`, index),
      filters: view.filters ?? null,
      order: (Array.isArray(view.order) ? view.order : [])
        .map(normalizeProperty)
        .filter(Boolean),
      sort: (Array.isArray(view.sort) ? view.sort : [])
        .filter(entry => entry && typeof entry === 'object')
        .map(entry => ({
          property: normalizeProperty(entry.property),
          direction: String(entry.direction ?? 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
        }))
        .filter(entry => entry.property),
      columnSize: (view.columnSize && typeof view.columnSize === 'object' && !Array.isArray(view.columnSize))
        ? Object.fromEntries(
          Object.entries(view.columnSize)
            .map(([id, size]) => [normalizeProperty(id), Number(size)] as [string, number])
            .filter(([, size]) => Number.isFinite(size) && size > 0)
        )
        : {}
    }));

  return {
    filters: source.filters ?? null,
    formulas,
    properties,
    views
  };
};

export { normalizeDocument };

/**
 * Absolute path of the views file inside the context directory.
 * @returns {Promise<string>}
 */
const viewsFilePath = async () => paths.contextDir([VIEWS_FILE]);

export { viewsFilePath };

/**
 * Read `views.yaml`. A missing file is not an error: it yields the default
 * document, and nothing is written to disk until the user saves a view.
 * @returns {Promise<Object>}
 */
const load = async () => {
  const filePath = await viewsFilePath();

  if (!fs.existsSync(filePath)) {
    return normalizeDocument(null);
  }

  const raw = fs.readFileSync(filePath, 'utf8');

  let parsed;
  try {
    parsed = YAML.parse(raw);
  }
  catch (ex) {
    throw new Error(`Invalid ${VIEWS_FILE}: ${ex.message}`, { cause: ex });
  }

  return normalizeDocument(parsed);
};

export { load };

/**
 * Write `views.yaml`, keeping the Obsidian Bases key order so the file stays
 * readable (and diffable) for whoever edits it by hand.
 * @param {Object} document
 * @returns {Promise<Object>} The normalized document that was written
 */
const save = async (document) => {
  const normalized = normalizeDocument(document);
  const filePath = await viewsFilePath();

  const out: Record<string, any> = {};
  if (normalized.filters) { out.filters = normalized.filters; }
  if (Object.keys(normalized.formulas).length) { out.formulas = normalized.formulas; }
  if (Object.keys(normalized.properties).length) { out.properties = normalized.properties; }
  out.views = normalized.views.map(view => {
    const entry: Record<string, any> = { type: view.type, name: view.name };
    if (view.filters) { entry.filters = view.filters; }
    if (view.order.length) { entry.order = view.order; }
    if (view.sort.length) { entry.sort = view.sort; }
    if (Object.keys(view.columnSize).length) { entry.columnSize = view.columnSize; }
    return entry;
  });

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(out), 'utf8');

  return normalized;
};

export { save };

/* -------------------------------------------------------------- the rows */

/**
 * Build the scope one flow is evaluated against: its frontmatter under
 * `note`, the file itself under `file` (with the `file.hasTag(...)` style
 * helpers), what the parser knows under `flow`, and every formula under
 * `formula`, computed on demand.
 *
 * @param {Object} entry - { absolutePath, relativePath, parsed, stat }
 * @param {Object} formulas - name -> expression
 * @returns {Object} scope
 */
const buildScope = (entry, formulas) => {
  const { absolutePath, relativePath, parsed, stat } = entry;

  const meta = (parsed && parsed.properties && typeof parsed.properties === 'object')
    ? parsed.properties
    : {};

  const name = path.basename(relativePath);
  const ext = path.extname(name).substring(1).toLowerCase();
  const folder = path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath);
  const tags = tagsOf(meta);

  const file = {
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    path: relativePath,
    folder,
    ext,
    size: stat ? stat.size : null,
    ctime: stat ? stat.birthtime : null,
    mtime: stat ? stat.mtime : null,
    tags,
    hasTag: (...candidates) => candidates.flat().some(
      candidate => tags.some(tag => tag.toLowerCase() === String(candidate ?? '').trim().replace(/^#/, '').toLowerCase())
    ),
    hasProperty: (property) => Object.prototype.hasOwnProperty.call(meta, String(property ?? '')),
    // A folder matches itself and everything below it, so a filter written
    // for "payments" also keeps "payments/refunds/…"
    inFolder: (candidate) => {
      const target = String(candidate ?? '').replace(/^\/+|\/+$/g, '');
      if (!target) { return true; }
      return folder === target || folder.startsWith(`${target}/`);
    },
    asLink: () => relativePath
  };

  const flow = {
    title: parsed ? parsed.title : null,
    description: parsed ? parsed.description : null,
    steps: parsed && Array.isArray(parsed.steps) ? parsed.steps.length : 0,
    hasErrors: Boolean(parsed && parsed.errors && parsed.errors.length)
  };

  const scope: Record<string, any> = { note: meta, file, flow, absolutePath };

  // Formulas are lazy so one can build on another, and a cycle reports
  // itself instead of hanging the request
  const computing = new Set();
  const cache = new Map();
  const formula: Record<string, any> = {};

  Object.keys(formulas).forEach(formulaName => {
    Object.defineProperty(formula, formulaName, {
      enumerable: true,
      get: () => {
        if (cache.has(formulaName)) { return cache.get(formulaName); }
        if (computing.has(formulaName)) {
          throw new Error(`Formula "${formulaName}" refers to itself`);
        }
        computing.add(formulaName);
        try {
          const value = expression.evaluate(formulas[formulaName], scope);
          cache.set(formulaName, value);
          return value;
        }
        finally {
          computing.delete(formulaName);
        }
      }
    });
  });

  scope.formula = formula;

  return scope;
};

/**
 * Every flow at or below a folder of the flows directory.
 * @param {string} folderRelativePath - '' for the whole flows directory
 * @returns {Promise<Array<Object>>} entries
 */
const collectFlows = async (folderRelativePath) => {
  const { flowsDir, absolute } = await flows.resolveWithinFlows(folderRelativePath || '');

  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error('Folder not found');
  }

  const entries: FlowEntry[] = [];

  const scan = (dir) => {
    let items;
    try {
      items = fs.readdirSync(dir);
    }
    catch {
      return;
    }

    for (const item of items) {
      if (item.startsWith('.')) { continue; }

      const fullPath = path.join(dir, item);

      let stat;
      try {
        stat = fs.statSync(fullPath);
      }
      catch {
        continue;
      }

      if (stat.isDirectory()) {
        scan(fullPath);
        continue;
      }

      const ext = path.extname(item).toLowerCase().substring(1);
      if (!['md', 'markdown'].includes(ext)) { continue; }

      let parsed: any = null;
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        parsed = flows.parseValue(raw);
      }
      catch {
        parsed = null;
      }

      entries.push({
        absolutePath: fullPath,
        relativePath: path.relative(flowsDir, fullPath).split(path.sep).join('/'),
        parsed,
        stat
      });
    }
  };

  scan(absolute);

  return entries;
};

export { collectFlows };

/* ----------------------------------------------------------- the filters */

/**
 * Evaluate a filter node: either a group ({ and: [...] }, { or: [...] },
 * { not: [...] }) or a single expression string. Errors are collected rather
 * than thrown — one broken filter must not take the whole view down.
 *
 * @param {*} node
 * @param {Object} scope
 * @param {Array<string>} errors - Collected filter errors
 * @returns {boolean}
 */
const matchesFilter = (node, scope, errors) => {
  if (node === null || node === undefined || node === '') { return true; }

  if (typeof node === 'boolean') { return node; }

  if (typeof node === 'string') {
    const result = expression.test(node, scope);
    if (result.error) { errors.push(`${node} — ${result.error}`); }
    return result.matches;
  }

  if (Array.isArray(node)) {
    return node.every(child => matchesFilter(child, scope, errors));
  }

  if (typeof node === 'object') {
    const keys = Object.keys(node);

    // An object with no known conjunction is an "and" of its entries
    return keys.every(key => {
      const child = node[key];
      const children = Array.isArray(child) ? child : [child];

      if (key === 'and') { return children.every(item => matchesFilter(item, scope, errors)); }
      if (key === 'or') { return children.some(item => matchesFilter(item, scope, errors)); }
      if (key === 'not') { return !children.some(item => matchesFilter(item, scope, errors)); }

      return matchesFilter(child, scope, errors);
    });
  }

  return true;
};

export { matchesFilter };

/* ------------------------------------------------------------ the values */

/**
 * Turn a value into something JSON can carry, keeping enough type
 * information for the UI to render and sort it.
 * @param {*} value
 * @returns {*}
 */
const serialize = (value) => {
  if (value === undefined) { return null; }
  if (value instanceof Date) { return Number.isNaN(value.getTime()) ? null : value.toISOString(); }
  if (Array.isArray(value)) { return value.map(serialize); }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
};

/**
 * Read a frontmatter property by its path.
 *
 * A key that literally holds a dot wins, so a document that really does have
 * a "xray.testKey" key keeps working; otherwise the path is walked, which is
 * what turns an embedded object into the `note.xray.testKey` column.
 *
 * @param {Object} meta - Frontmatter
 * @param {string} key - The column id without its `note.` namespace
 * @returns {*} null when nothing is there
 */
const readNoteValue = (meta, key) => {
  if (!meta || typeof meta !== 'object') { return null; }
  if (Object.prototype.hasOwnProperty.call(meta, key)) { return meta[key]; }

  let current = meta;

  for (const segment of String(key).split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) { return null; }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) { return null; }
    current = current[segment];
  }

  return current === undefined ? null : current;
};

/**
 * Every column id a flow's frontmatter offers: its own keys, and the keys of
 * any embedded object below them -- `xray: { testKey: ... }` is offered as
 * `note.xray` and as `note.xray.testKey`.
 *
 * A list is a value rather than a group of columns, so arrays are not walked.
 *
 * @param {*} meta - Frontmatter, or an object inside it
 * @param {Set<string>} into - Collected ids
 * @param {string} [prefix] - The id of the object being walked
 * @param {number} [depth]
 */
const collectNoteProperties = (meta, into: Set<string>, prefix = 'note', depth = 0) => {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) { return; }

  Object.keys(meta).forEach(key => {
    const id = `${prefix}.${key}`;
    into.add(id);

    // Deeper than this and a column id stops being something anyone would
    // want to read in a table header
    if (depth + 1 < MAX_PROPERTY_DEPTH) {
      collectNoteProperties(meta[key], into, id, depth + 1);
    }
  });
};

/**
 * Read one column out of a scope, never throwing: a formula that fails
 * renders as null and reports the reason.
 * @param {string} columnId - A normalized column id
 * @param {Object} scope
 * @returns {{ value: *, error: string|null }}
 */
const readColumn = (columnId, scope) => {
  const [namespace, ...rest] = columnId.split('.');
  const key = rest.join('.');

  try {
    if (namespace === 'note') {
      return { value: readNoteValue(scope.note || {}, key), error: null };
    }
    if (namespace === 'file' || namespace === 'flow') {
      const source = scope[namespace] || {};
      const value = source[key];
      return { value: typeof value === 'function' ? null : (value ?? null), error: null };
    }
    if (namespace === 'formula') {
      return { value: scope.formula ? scope.formula[key] ?? null : null, error: null };
    }
  }
  catch (ex) {
    return { value: null, error: `${columnId} — ${ex.message}` };
  }

  return { value: null, error: null };
};

/* -------------------------------------------------------------- ordering */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

/**
 * Whether a value counts as empty -- the same rule the filters use.
 * @param {*} value
 * @returns {boolean}
 */
const isEmpty = (value) => {
  if (value === null || value === undefined) { return true; }
  if (typeof value === 'string') { return value.trim() === ''; }
  if (Array.isArray(value)) { return value.length === 0; }
  if (typeof value === 'object') { return Object.keys(value).length === 0; }
  return false;
};

const asNumber = (value) => {
  if (typeof value === 'number') { return Number.isNaN(value) ? null : value; }
  if (typeof value === 'boolean') { return value ? 1 : 0; }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
};

const asDate = (value) => {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value.trim())) { return null; }
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
};

const asText = (value) => {
  if (value === null || value === undefined) { return ''; }
  if (typeof value === 'boolean') { return value ? 'Yes' : 'No'; }
  if (Array.isArray(value)) { return value.map(asText).join(', '); }
  if (typeof value === 'object') { return JSON.stringify(value); }
  return String(value);
};

/**
 * Order two values: numbers numerically, dates chronologically, everything
 * else as case-insensitive text. Empty values always sort last, whatever the
 * direction, so a half-filled column still reads top-down.
 *
 * The UI's lib/properties compares the same way -- a view has one order,
 * whether it is read on screen or run from the CLI.
 *
 * @param {*} left
 * @param {*} right
 * @returns {number}
 */
const compareValues = (left, right) => {
  const leftEmpty = isEmpty(left);
  const rightEmpty = isEmpty(right);
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) { return 0; }
    return leftEmpty ? 1 : -1;
  }

  const leftNumber = asNumber(left);
  const rightNumber = asNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return Math.sign(leftNumber - rightNumber);
  }

  const leftDate = asDate(left);
  const rightDate = asDate(right);
  if (leftDate && rightDate) {
    return Math.sign(leftDate.getTime() - rightDate.getTime());
  }

  return asText(left).toLowerCase().localeCompare(asText(right).toLowerCase());
};

export { compareValues };

/**
 * Put the rows of a view in its own order. The first sort entry that
 * separates two flows decides, so stacked sorts read as "by priority, then by
 * owner".
 *
 * @param {Array<Object>} rows
 * @param {Array<Object>} sort - [{ property, direction }]
 * @returns {Array<Object>} A new array
 */
const sortRows = (rows, sort) => {
  if (!sort || !sort.length) { return rows; }

  return [...rows].sort((left, right) => {
    for (const entry of sort) {
      const comparison = compareValues(left.values[entry.property], right.values[entry.property]);
      if (comparison !== 0) { return entry.direction === 'DESC' ? -comparison : comparison; }
    }
    return 0;
  });
};

/* -------------------------------------------------------- the evaluation */

/**
 * Run a view over a folder of flows.
 *
 * Filtering, formulas and the view's own ordering happen here, so a view
 * lists the same flows in the same order whether it is read on screen or run
 * from the CLI. Searching and column widths are presentation, and stay in the
 * UI.
 *
 * @param {Object} options
 * @param {string} options.folder - Folder path relative to the flows dir ('' = all)
 * @param {string} [options.view] - Name of the view to run; the first one by default
 * @param {Object} [options.document] - A views document; read from disk when absent
 * @returns {Promise<Object>} { folder, view, views, properties, columns, availableProperties, rows, errors }
 */
const query = async ({ folder = '', view: viewName, document }: {
  folder?: string;
  view?: string;
  document?: any;
} = {}) => {
  const doc = document ? normalizeDocument(document) : await load();

  const view = findView(doc.views, viewName) || doc.views[0];

  const entries = await collectFlows(folder);
  const errors: string[] = [];

  const scopes = entries.map(entry => ({ entry, scope: buildScope(entry, doc.formulas) }));

  const matching = scopes.filter(({ scope }) => {
    // The document-wide filters apply to every view, on top of the view's own
    if (!matchesFilter(doc.filters, scope, errors)) { return false; }
    return matchesFilter(view.filters, scope, errors);
  });

  // Every property any of the listed flows carries, so the column picker can
  // offer them without a second request
  const noteProperties = new Set<string>();
  matching.forEach(({ scope }) => {
    collectNoteProperties(scope.note, noteProperties);
  });

  const availableProperties = [
    ...FILE_PROPERTIES,
    ...FLOW_PROPERTIES,
    ...[...noteProperties].sort((a, b) => a.localeCompare(b)),
    ...Object.keys(doc.formulas).sort((a, b) => a.localeCompare(b)).map(name => `formula.${name}`)
  ];

  // Values are computed for every available column, not only the visible
  // ones, so showing a column is instant and sorting never needs the server.
  // A column the view asks for is read even when no listed flow carries it,
  // so the table shows it as empty rather than dropping it
  const valueColumns = [...new Set([...availableProperties, ...view.order])];

  const rows = matching.map(({ entry, scope }) => {
    const values: Record<string, any> = {};
    valueColumns.forEach(columnId => {
      const { value, error } = readColumn(columnId, scope);
      values[columnId] = serialize(value);
      if (error && !errors.includes(error)) { errors.push(error); }
    });

    return {
      path: entry.absolutePath,
      relativePath: entry.relativePath,
      name: path.basename(entry.relativePath),
      title: (entry.parsed && entry.parsed.title) || path.basename(entry.relativePath),
      hasErrors: Boolean(entry.parsed && entry.parsed.errors && entry.parsed.errors.length),
      values
    };
  });

  const ordered = sortRows(rows, view.sort);

  // A view with no explicit order shows whatever the flows actually carry
  // Without an explicit order only the top-level properties are shown: the
  // fields inside an embedded object are there to be picked, not to fill a
  // table nobody asked for
  const columns = (view.order.length ? view.order : availableProperties.filter(
    id => id === 'file.name' || (noteProperties.has(id) && id.split('.').length === 2)
  )).map(id => ({
    id,
    displayName: (doc.properties[id] && doc.properties[id].displayName) || defaultDisplayName(id),
    width: view.columnSize[id] || null
  }));

  return {
    folder: folder || '',
    view,
    // How many flows the folder holds before any filter, so the UI can say
    // "12 of 40"
    total: entries.length,
    views: doc.views.map(candidate => ({
      name: candidate.name,
      slug: candidate.slug,
      type: candidate.type
    })),
    properties: doc.properties,
    formulas: doc.formulas,
    columns,
    availableProperties,
    rows: ordered,
    errors
  };
};

export { query };

export { HEADLINE_PROPERTIES };
export { VIEWS_FILE };
export { DEFAULT_VIEW };
