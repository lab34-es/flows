/**
 * Frontmatter properties, as the UI sees them.
 *
 * Types are never stored anywhere: exactly like Obsidian Bases, a property is
 * whatever its value says it is. `views.yaml` only ever remembers a display
 * name for a property, which is what `displayName` below reads.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

// The namespaces a column id can point at. A bare name is frontmatter.
const NAMESPACES = ['note', 'file', 'flow', 'formula'];

// Rendered above the property list in the document view, Obsidian style
export const HEADLINE_PROPERTIES = ['title', 'description'];

/**
 * Fully qualify a column id: `owner` and `note.owner` are the same column.
 * @param {string} id
 * @returns {string}
 */
export function normalizeProperty(id) {
  const name = String(id ?? '').trim();
  if (!name) { return ''; }
  const namespace = name.split('.')[0];
  return NAMESPACES.includes(namespace) && name.includes('.') ? name : `note.${name}`;
}

/**
 * The property name without its namespace.
 * @param {string} id
 * @returns {string}
 */
export function bareName(id) {
  const parts = String(id ?? '').split('.');
  return parts.length > 1 ? parts.slice(1).join('.') : String(id ?? '');
}

/**
 * One segment of a property id, as a person would write it.
 * @param {string} part
 * @returns {string}
 */
function humanize(part) {
  return String(part)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

/**
 * The label a column falls back to when views.yaml gives it no displayName.
 *
 * A field of an embedded frontmatter object reads as its whole path, so
 * `note.xray.testKey` is "Xray Test Key" — which still tells apart the two
 * "testKey" columns a document can have.
 *
 * @param {string} id
 * @returns {string}
 */
export function defaultDisplayName(id) {
  const bare = bareName(id);
  return bare.split('.').map(humanize).join(' ');
}

/**
 * How a column is labelled: the views.yaml displayName, or a humanized name.
 * @param {string} id
 * @param {Object} properties - The views.yaml `properties` map
 * @returns {string}
 */
export function displayName(id, properties) {
  const configured = properties?.[id]?.displayName;
  return configured || defaultDisplayName(id);
}

/**
 * What kind of value this is, for rendering and for picking an editor.
 * @param {*} value
 * @returns {'checkbox'|'number'|'date'|'list'|'object'|'text'}
 */
export function inferType(value) {
  if (typeof value === 'boolean') { return 'checkbox'; }
  if (typeof value === 'number') { return 'number'; }
  if (Array.isArray(value)) { return 'list'; }
  if (typeof value === 'string' && ISO_DATE_RE.test(value.trim())) { return 'date'; }
  if (value && typeof value === 'object') { return 'object'; }
  return 'text';
}

/**
 * Whether a value counts as empty — the same rule the filters use.
 * @param {*} value
 * @returns {boolean}
 */
export function isEmpty(value) {
  if (value === null || value === undefined) { return true; }
  if (typeof value === 'string') { return value.trim() === ''; }
  if (Array.isArray(value)) { return value.length === 0; }
  if (typeof value === 'object') { return Object.keys(value).length === 0; }
  return false;
}

/**
 * A value as one line of text, for a table cell or a search haystack.
 * @param {*} value
 * @returns {string}
 */
export function formatValue(value) {
  if (value === null || value === undefined) { return ''; }
  if (typeof value === 'boolean') { return value ? 'Yes' : 'No'; }
  if (Array.isArray(value)) { return value.map(formatValue).join(', '); }
  if (typeof value === 'object') { return JSON.stringify(value); }
  return String(value);
}

/**
 * Order two values the way the backend does: numbers numerically, dates
 * chronologically, everything else as case-insensitive text. Empty values
 * always sort last, whatever the direction, so a half-filled column still
 * reads top-down.
 *
 * @param {*} left
 * @param {*} right
 * @returns {number}
 */
export function compareValues(left, right) {
  const leftEmpty = isEmpty(left);
  const rightEmpty = isEmpty(right);
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) { return 0; }
    return leftEmpty ? 1 : -1;
  }

  const leftNumber = toNumber(left);
  const rightNumber = toNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return Math.sign(leftNumber - rightNumber);
  }

  const leftDate = toDate(left);
  const rightDate = toDate(right);
  if (leftDate && rightDate) {
    return Math.sign(leftDate.getTime() - rightDate.getTime());
  }

  return formatValue(left).toLowerCase().localeCompare(formatValue(right).toLowerCase());
}

function toNumber(value) {
  if (typeof value === 'number') { return Number.isNaN(value) ? null : value; }
  if (typeof value === 'boolean') { return value ? 1 : 0; }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function toDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value.trim())) { return null; }
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Turn what the user typed into the value that goes into the frontmatter.
 * The type of the value being replaced decides how the text is read, so
 * editing a number keeps it a number and editing a list keeps it a list.
 *
 * @param {string} text
 * @param {string} type - As returned by inferType()
 * @returns {*}
 */
export function parseInputValue(text, type) {
  const raw = String(text ?? '');

  if (type === 'number') {
    if (raw.trim() === '') { return null; }
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? raw : parsed;
  }

  if (type === 'list') {
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }

  if (type === 'checkbox') {
    return raw === 'true' || (raw as unknown) === true;
  }

  return raw;
}

/**
 * How a value is shown inside a text input while it is being edited.
 * @param {*} value
 * @returns {string}
 */
export function toInputValue(value) {
  if (value === null || value === undefined) { return ''; }
  if (Array.isArray(value)) { return value.map((item) => formatValue(item)).join(', '); }
  if (typeof value === 'object') { return JSON.stringify(value); }
  return String(value);
}

/**
 * Does a row match a plain-text search? Its name and path always count, plus
 * the value of every visible column.
 *
 * @param {Object} row - A row from /api/views/query
 * @param {Array<Object>} columns - The visible columns
 * @param {string} query
 * @returns {boolean}
 */
export function matchesSearch(row, columns, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) { return true; }

  const haystack = [row.name, row.title, row.relativePath]
    .concat(columns.map((column) => formatValue(row.values?.[column.id])))
    .join(' ')
    .toLowerCase();

  return haystack.includes(needle);
}
