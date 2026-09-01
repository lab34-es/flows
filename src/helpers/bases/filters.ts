import * as expression from './expression';

/**
 * Filters, as structured data.
 *
 * A filter is never text a person has to get right. It is a property, an
 * operator picked from the ones that property's type allows, and a value:
 *
 *   filters:
 *     conjunction: and
 *     conditions:
 *       - property: note.regression
 *         operator: isTrue
 *       - conjunction: or
 *         conditions:
 *           - { property: file, operator: inFolder, value: payments }
 *           - { property: note.tags, operator: hasAny, value: [smoke] }
 *
 * Nothing here is parsed as code, so nothing here can be a syntax error. The
 * expression language next door still backs `formulas`, and the comparison
 * primitives it already exports are what every operator below is built from,
 * so a filter and a formula agree on what "contains" or "empty" means.
 */

/** How a group combines the conditions under it. */
export type Conjunction = 'and' | 'or' | 'none';

/** One property/operator/value test. */
export interface FilterCondition {
  property: string;
  operator: string;
  value?: any;
}

/** A conjunction and the conditions (or nested groups) under it. */
export interface FilterGroup {
  conjunction: Conjunction;
  conditions: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

const CONJUNCTIONS: Conjunction[] = ['and', 'or', 'none'];

/** The label each conjunction reads as in the editor. */
const CONJUNCTION_LABELS: Record<Conjunction, string> = {
  and: 'All of the following are true',
  or: 'Any of the following is true',
  none: 'None of the following is true'
};

/**
 * What a property holds, which is what decides the operators it is offered
 * and the control its value is typed into.
 */
export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'list' | 'file';

/** The pseudo-property behind the file operators, as Obsidian spells it. */
const FILE_PROPERTY = 'file';

// Where a property id can point. Anything else is shorthand for a frontmatter
// property, so `owner` and `note.owner` are the same property.
const NAMESPACES = ['note', 'file', 'flow', 'formula'];

/**
 * Fully qualify a property id: a bare name means a frontmatter property.
 * `file` on its own is the whole-file pseudo-property, not a frontmatter key
 * called "file".
 * @param {string} id
 * @returns {string}
 */
const normalizeProperty = (id) => {
  const name = String(id ?? '').trim();
  if (!name) { return ''; }
  if (name === FILE_PROPERTY) { return FILE_PROPERTY; }
  const namespace = name.split('.')[0];
  return NAMESPACES.includes(namespace) && name.includes('.') ? name : `note.${name}`;
};

export { NAMESPACES, normalizeProperty };

/**
 * What the value control is: `none` takes no value at all, `same` follows the
 * property's own type, the rest name themselves.
 */
export type ValueInput = 'none' | 'same' | 'text' | 'number' | 'list' | 'folder' | 'tag' | 'property';

/** Types the whole-file operators apply to. */
const FILE_TYPES: PropertyType[] = ['file'];

/** Every type a value-carrying property can have. */
const VALUE_TYPES: PropertyType[] = ['text', 'number', 'checkbox', 'date', 'list'];

/* -------------------------------------------------------------- the values */

/**
 * Read a frontmatter property by its path.
 *
 * A key that literally holds a dot wins, so a document that really does have
 * a "xray.testKey" key keeps working; otherwise the path is walked, which is
 * what turns an embedded object into the `note.xray.testKey` property.
 *
 * @param {Object} meta - Frontmatter
 * @param {string} key - The property id without its `note.` namespace
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

export { readNoteValue };

/**
 * Read one column out of a scope, never throwing: a formula that fails
 * renders as null and reports the reason.
 * @param {string} columnId - A normalized column id
 * @param {Object} scope
 * @returns {{ value: *, error: string|null }}
 */
const readColumn = (columnId, scope) => {
  const [namespace, ...rest] = String(columnId ?? '').split('.');
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

export { readColumn };

/**
 * The moment a date value means. `today` and `now` are written by the date
 * picker's shortcuts rather than by hand, so they never reach the tokenizer.
 * @param {*} value
 * @returns {Date|null}
 */
const toMoment = (value) => {
  if (value === 'today') {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }
  if (value === 'now') { return new Date(); }
  return expression.toDate(value);
};

/** Midnight of the day a value falls on, for day-precision comparisons. */
const toDay = (value) => {
  const date = toMoment(value);
  if (!date) { return null; }
  const day = new Date(date.getTime());
  day.setHours(0, 0, 0, 0);
  return day;
};

/**
 * Compare two dates at day precision: "is" on a date property means the same
 * calendar day, not the same millisecond.
 * @param {*} left
 * @param {*} right
 * @returns {number|null} -1, 0, 1, or null when either side is not a date
 */
const compareDays = (left, right) => {
  const a = toDay(left);
  const b = toDay(right);
  if (!a || !b) { return null; }
  if (a.getTime() === b.getTime()) { return 0; }
  return a.getTime() < b.getTime() ? -1 : 1;
};

/** Every value on the right-hand side of a list operator, flattened. */
const needles = (value) => expression.toList(value).flat();

/* ----------------------------------------------------------- the operators */

/**
 * One operator: which property types offer it, what value it takes, and the
 * test itself. `test` receives the value already read out of the scope, so an
 * operator never has to know how a property was found.
 */
interface Operator {
  label: string;
  types: PropertyType[];
  input: ValueInput;
  test: (left: any, value: any, scope: any) => boolean;
}

const OPERATORS: Record<string, Operator> = {
  is: {
    label: 'is',
    types: ['text', 'number', 'date', 'list'],
    input: 'same',
    test: (left, value) => {
      const days = compareDays(left, value);
      return days === null ? expression.looseEquals(left, value) : days === 0;
    }
  },
  isNot: {
    label: 'is not',
    types: ['text', 'number', 'date', 'list'],
    input: 'same',
    test: (left, value) => !OPERATORS.is.test(left, value, null)
  },

  contains: {
    label: 'contains',
    types: ['text', 'list'],
    input: 'text',
    test: (left, value) => expression.contains(left, value)
  },
  doesNotContain: {
    label: 'does not contain',
    types: ['text', 'list'],
    input: 'text',
    test: (left, value) => !expression.contains(left, value)
  },
  startsWith: {
    label: 'starts with',
    types: ['text'],
    input: 'text',
    test: (left, value) => expression.toText(left).toLowerCase()
      .startsWith(expression.toText(value).toLowerCase())
  },
  endsWith: {
    label: 'ends with',
    types: ['text'],
    input: 'text',
    test: (left, value) => expression.toText(left).toLowerCase()
      .endsWith(expression.toText(value).toLowerCase())
  },

  greaterThan: {
    label: 'is greater than',
    types: ['number'],
    input: 'number',
    test: (left, value) => expression.compare(left, value) > 0
  },
  greaterOrEqual: {
    label: 'is greater than or equal to',
    types: ['number'],
    input: 'number',
    test: (left, value) => expression.compare(left, value) >= 0
  },
  lessThan: {
    label: 'is less than',
    types: ['number'],
    input: 'number',
    test: (left, value) => expression.compare(left, value) < 0
  },
  lessOrEqual: {
    label: 'is less than or equal to',
    types: ['number'],
    input: 'number',
    test: (left, value) => expression.compare(left, value) <= 0
  },

  before: {
    label: 'is before',
    types: ['date'],
    input: 'same',
    test: (left, value) => compareDays(left, value) === -1
  },
  onOrBefore: {
    label: 'is on or before',
    types: ['date'],
    input: 'same',
    test: (left, value) => [-1, 0].includes(compareDays(left, value) as number)
  },
  after: {
    label: 'is after',
    types: ['date'],
    input: 'same',
    test: (left, value) => compareDays(left, value) === 1
  },
  onOrAfter: {
    label: 'is on or after',
    types: ['date'],
    input: 'same',
    test: (left, value) => [0, 1].includes(compareDays(left, value) as number)
  },

  isTrue: {
    label: 'is checked',
    types: ['checkbox'],
    input: 'none',
    test: (left) => left === true
  },
  isFalse: {
    label: 'is not checked',
    types: ['checkbox'],
    input: 'none',
    test: (left) => left !== true
  },

  hasAny: {
    label: 'has any of',
    types: ['list'],
    input: 'list',
    test: (left, value) => needles(value).some(needle => expression.contains(left, needle))
  },
  hasAll: {
    label: 'has all of',
    types: ['list'],
    input: 'list',
    test: (left, value) => needles(value).every(needle => expression.contains(left, needle))
  },
  hasNone: {
    label: 'has none of',
    types: ['list'],
    input: 'list',
    test: (left, value) => !needles(value).some(needle => expression.contains(left, needle))
  },

  isEmpty: {
    label: 'is empty',
    types: VALUE_TYPES,
    input: 'none',
    test: (left) => expression.isEmpty(left)
  },
  isNotEmpty: {
    label: 'is not empty',
    types: VALUE_TYPES,
    input: 'none',
    test: (left) => !expression.isEmpty(left)
  },

  inFolder: {
    label: 'is in folder',
    types: FILE_TYPES,
    input: 'folder',
    test: (left, value, scope) => Boolean(scope && scope.file && scope.file.inFolder(value))
  },
  notInFolder: {
    label: 'is not in folder',
    types: FILE_TYPES,
    input: 'folder',
    test: (left, value, scope) => !(scope && scope.file && scope.file.inFolder(value))
  },
  hasTag: {
    label: 'has tag',
    types: FILE_TYPES,
    input: 'tag',
    test: (left, value, scope) => Boolean(
      scope && scope.file && needles(value).some(tag => scope.file.hasTag(tag))
    )
  },
  doesNotHaveTag: {
    label: 'does not have tag',
    types: FILE_TYPES,
    input: 'tag',
    test: (left, value, scope) => !(
      scope && scope.file && needles(value).some(tag => scope.file.hasTag(tag))
    )
  },
  hasProperty: {
    label: 'has property',
    types: FILE_TYPES,
    input: 'property',
    test: (left, value, scope) => Boolean(scope && scope.file && scope.file.hasProperty(value))
  },
  doesNotHaveProperty: {
    label: 'does not have property',
    types: FILE_TYPES,
    input: 'property',
    test: (left, value, scope) => !(scope && scope.file && scope.file.hasProperty(value))
  }
};

export { OPERATORS, CONJUNCTIONS, CONJUNCTION_LABELS, FILE_PROPERTY, VALUE_TYPES };

/**
 * The operator ids a property of this type is offered, in the order the
 * dropdown lists them.
 * @param {string} type
 * @returns {Array<string>}
 */
const operatorsFor = (type: PropertyType): string[] => Object.entries(OPERATORS)
  .filter(([, operator]) => operator.types.includes(type))
  .map(([id]) => id);

export { operatorsFor };

/**
 * Everything the editor needs to draw the operator dropdowns, as JSON: the
 * catalog is served rather than duplicated, so the UI can never offer an
 * operator this file does not implement.
 * @returns {Object} { conjunctions, operators, types }
 */
const catalog = () => ({
  conjunctions: CONJUNCTIONS.map(id => ({ id, label: CONJUNCTION_LABELS[id] })),
  operators: Object.entries(OPERATORS).map(([id, operator]) => ({
    id,
    label: operator.label,
    types: operator.types,
    input: operator.input
  })),
  types: [...VALUE_TYPES, 'file']
});

export { catalog };

/* ------------------------------------------------------------ the document */

/** Whether a node is a group rather than a single condition. */
const isGroup = (node: any): node is FilterGroup => Boolean(
  node && typeof node === 'object' && !Array.isArray(node) && Array.isArray(node.conditions)
);

export { isGroup };

/**
 * Normalize a filter node read from disk (or sent by the UI). Anything that
 * is not a group or a usable condition is dropped, and a group left with no
 * conditions becomes null, so the rest of the code never guards against a
 * half-written file.
 *
 * @param {*} raw
 * @returns {FilterGroup|null}
 */
const normalize = (raw): FilterGroup | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }

  const conjunction: Conjunction = CONJUNCTIONS.includes(raw.conjunction) ? raw.conjunction : 'and';
  const source = Array.isArray(raw.conditions) ? raw.conditions : [];

  const conditions = source
    .map(child => {
      if (isGroup(child)) { return normalize(child); }
      if (!child || typeof child !== 'object' || Array.isArray(child)) { return null; }

      const property = normalizeProperty(child.property);
      const operator = String(child.operator ?? '').trim();
      if (!property || !operator) { return null; }

      // An operator this file does not implement is kept rather than dropped:
      // a hand-edited views.yaml with a typo in it must say so, not quietly
      // widen the view to everything
      const condition: FilterCondition = { property, operator };
      if (!OPERATORS[operator] || OPERATORS[operator].input !== 'none') {
        condition.value = child.value ?? null;
      }
      return condition;
    })
    .filter(Boolean) as FilterNode[];

  return conditions.length ? { conjunction, conditions } : null;
};

export { normalize };

/**
 * How many conditions a node holds, counting the ones inside nested groups:
 * the number the Filter button wears.
 * @param {*} node
 * @returns {number}
 */
const count = (node): number => {
  if (!isGroup(node)) { return node ? 1 : 0; }
  return node.conditions.reduce((total, child) => total + count(child), 0);
};

export { count };

/* ----------------------------------------------------------- the evaluator */

/**
 * Evaluate one condition against a flow's scope.
 * @param {FilterCondition} condition
 * @param {Object} scope
 * @returns {{ matches: boolean, error: string|null }}
 */
const testCondition = (condition: FilterCondition, scope) => {
  const operator = OPERATORS[condition.operator];

  if (!operator) {
    return { matches: false, error: `Unknown operator "${condition.operator}"` };
  }

  const left = condition.property === FILE_PROPERTY
    ? null
    : readColumn(condition.property, scope).value;

  try {
    return { matches: Boolean(operator.test(left, condition.value, scope)), error: null };
  }
  catch (ex) {
    return { matches: false, error: `${condition.property} ${operator.label} — ${ex.message}` };
  }
};

export { testCondition };

/**
 * Whether a flow passes a filter node.
 *
 * Errors are collected rather than thrown, and each distinct one is recorded
 * once however many flows hit it: a single broken condition reports a single
 * problem, not one per flow in the folder.
 *
 * @param {*} node - A normalized group, or null for "keep everything"
 * @param {Object} scope
 * @param {Array<string>} errors - Collected, deduplicated
 * @returns {boolean}
 */
const matches = (node, scope, errors: string[] = []): boolean => {
  if (!node) { return true; }

  if (!isGroup(node)) {
    const result = testCondition(node as FilterCondition, scope);
    if (result.error && !errors.includes(result.error)) { errors.push(result.error); }
    return result.matches;
  }

  const results = node.conditions.map(child => matches(child, scope, errors));

  if (node.conjunction === 'or') { return results.some(Boolean); }
  if (node.conjunction === 'none') { return !results.some(Boolean); }
  return results.every(Boolean);
};

export { matches };

/* ----------------------------------------------------------- the inference */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

/** Types the known file and flow properties carry, which never need guessing. */
const KNOWN_TYPES: Record<string, PropertyType> = {
  'file.name': 'text',
  'file.basename': 'text',
  'file.path': 'text',
  'file.folder': 'text',
  'file.ext': 'text',
  'file.size': 'number',
  'file.ctime': 'date',
  'file.mtime': 'date',
  'file.tags': 'list',
  'flow.title': 'text',
  'flow.description': 'text',
  'flow.steps': 'number',
  'flow.hasErrors': 'checkbox'
};

export { KNOWN_TYPES };

/**
 * The type a single value looks like.
 * @param {*} value
 * @returns {PropertyType|null} null for a value that says nothing (empty)
 */
const typeOfValue = (value): PropertyType | null => {
  if (value === null || value === undefined || value === '') { return null; }
  if (typeof value === 'boolean') { return 'checkbox'; }
  if (typeof value === 'number') { return 'number'; }
  if (Array.isArray(value)) { return value.length ? 'list' : null; }
  if (value instanceof Date) { return 'date'; }
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) { return 'date'; }
  return 'text';
};

export { typeOfValue };

/**
 * The type a property carries, from the values the folder's flows actually
 * hold. A property written as a checkbox in one flow and as text in another
 * falls back to text, which offers the operators that work on anything.
 *
 * @param {string} propertyId
 * @param {Array<*>} values - Sampled values, empties included
 * @returns {PropertyType}
 */
const inferType = (propertyId: string, values: any[] = []): PropertyType => {
  if (propertyId === FILE_PROPERTY) { return 'file'; }
  if (KNOWN_TYPES[propertyId]) { return KNOWN_TYPES[propertyId]; }

  const seen = new Set<PropertyType>();
  values.forEach(value => {
    const type = typeOfValue(value);
    if (type) { seen.add(type); }
  });

  if (seen.size === 1) { return [...seen][0]; }

  // A list of one is still a list: a property that is sometimes a bare value
  // and sometimes an array of them is offered the list operators
  if (seen.has('list')) { return 'list'; }

  return 'text';
};

export { inferType };
