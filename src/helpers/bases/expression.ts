/**
 * A lexical token.
 *
 * Modelled as a discriminated union so that narrowing on `type` also narrows
 * `value`: a 'name' token always carries a string, which is what lets it be
 * used directly as a keyword or property lookup.
 */
export type Token =
  | { type: 'number'; value: number; start: number }
  | { type: 'string' | 'name' | 'punct'; value: string; start: number };

/**
 * The little expression language behind "bases" views, modelled on Obsidian
 * Bases: the right-hand side of every entry in `formulas`.
 *
 * Filters do not come through here. They are structured conditions picked
 * from dropdowns (see `./filters`), so that what a person chooses can never
 * be a syntax error. The comparison primitives below are shared, so a filter
 * and a formula agree on what "contains" or "empty" means.
 *
 *   note.zona_usda_min <= 9 && note.tipo_hoja == "caduca"
 *   if(note.envergadura_copa_m >= 6, "yes", "no")
 *   default(note.owner, "nobody")
 *
 * Four namespaces are available:
 *
 *   note.<property>     a frontmatter property of the flow
 *   file.<property>     something about the file itself (name, path, mtime...)
 *   flow.<property>     something the parser knows (title, steps, hasErrors)
 *   formula.<name>      another formula, computed lazily
 *
 * A bare identifier is shorthand for `note.<identifier>`, so `priority` and
 * `note.priority` mean the same thing.
 *
 * Missing properties evaluate to null instead of throwing, so a filter never
 * blows up on a flow that simply does not carry that property.
 */

/* ------------------------------------------------------------------ tokens */

// Longest first: the tokenizer takes the first match, so '>=' must be tried
// before '>'
const PUNCTUATION = [
  '&&', '||', '==', '!=', '>=', '<=',
  '>', '<', '!', '+', '-', '*', '/', '%',
  '(', ')', '[', ']', ',', '.', '?', ':'
];

const KEYWORDS = {
  true: true,
  false: false,
  null: null
};

/**
 * Split an expression into tokens.
 * @param {string} source
 * @returns {Array<Object>} { type: 'number'|'string'|'name'|'punct', value, start }
 */
const tokenize = (source): Token[] => {
  const tokens: Token[] = [];
  const text = String(source ?? '');
  let index = 0;

  const isNameStart = (char) => /[A-Za-z_$]/.test(char);
  const isNameChar = (char) => /[A-Za-z0-9_$]/.test(char);

  while (index < text.length) {
    const char = text[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    // Numbers: 12, 12.5, .5
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[index + 1] || ''))) {
      let end = index;
      while (end < text.length && /[0-9]/.test(text[end])) { end += 1; }
      if (text[end] === '.') {
        end += 1;
        while (end < text.length && /[0-9]/.test(text[end])) { end += 1; }
      }
      tokens.push({ type: 'number', value: Number(text.slice(index, end)), start: index });
      index = end;
      continue;
    }

    // Strings, single or double quoted, with backslash escapes
    if (char === '"' || char === '\'') {
      const quote = char;
      let end = index + 1;
      let value = '';
      let closed = false;

      while (end < text.length) {
        if (text[end] === '\\' && end + 1 < text.length) {
          const escaped = text[end + 1];
          const replacements = { n: '\n', t: '\t', r: '\r' };
          value += replacements[escaped] !== undefined ? replacements[escaped] : escaped;
          end += 2;
          continue;
        }
        if (text[end] === quote) {
          closed = true;
          end += 1;
          break;
        }
        value += text[end];
        end += 1;
      }

      if (!closed) {
        throw new Error(`Unterminated string at position ${index}`);
      }

      tokens.push({ type: 'string', value, start: index });
      index = end;
      continue;
    }

    if (isNameStart(char)) {
      let end = index;
      while (end < text.length && isNameChar(text[end])) { end += 1; }
      tokens.push({ type: 'name', value: text.slice(index, end), start: index });
      index = end;
      continue;
    }

    const punctuation = PUNCTUATION.find(candidate => text.startsWith(candidate, index));
    if (punctuation) {
      tokens.push({ type: 'punct', value: punctuation, start: index });
      index += punctuation.length;
      continue;
    }

    throw new Error(`Unexpected character "${char}" at position ${index}`);
  }

  return tokens;
};

/* ------------------------------------------------------------------ parser */

// Higher binds tighter
const BINARY_PRECEDENCE = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '>': 4,
  '>=': 4,
  '<': 4,
  '<=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6
};

/**
 * Parse an expression into an AST.
 * @param {string} source
 * @returns {Object} AST node
 */
const parse = (source) => {
  const tokens = tokenize(source);
  let position = 0;

  const peek = () => tokens[position];
  const done = () => position >= tokens.length;

  const isPunct = (value) => {
    const token = peek();
    return Boolean(token) && token.type === 'punct' && token.value === value;
  };

  const expectPunct = (value) => {
    if (!isPunct(value)) {
      const token = peek();
      const found = token ? `"${token.value}"` : 'the end of the expression';
      throw new Error(`Expected "${value}" but found ${found}`);
    }
    position += 1;
  };

  /**
   * Comma separated argument list, the opening parenthesis already consumed.
   * @returns {Array<Object>}
   */
  const parseArguments = () => {
    const args: any[] = [];
    if (isPunct(')')) {
      position += 1;
      return args;
    }
    for (;;) {
      args.push(parseExpression(0));
      if (isPunct(',')) {
        position += 1;
        continue;
      }
      expectPunct(')');
      return args;
    }
  };

  const parsePrimary = () => {
    const token = peek();

    if (!token) {
      throw new Error('Unexpected end of expression');
    }

    if (token.type === 'number' || token.type === 'string') {
      position += 1;
      return { type: 'literal', value: token.value };
    }

    if (token.type === 'name') {
      position += 1;
      if (Object.prototype.hasOwnProperty.call(KEYWORDS, token.value)) {
        return { type: 'literal', value: KEYWORDS[token.value] };
      }
      return { type: 'identifier', name: token.value };
    }

    if (isPunct('(')) {
      position += 1;
      const inner = parseExpression(0);
      expectPunct(')');
      return inner;
    }

    // List literal: [1, 2, 3]
    if (isPunct('[')) {
      position += 1;
      const elements: any[] = [];
      if (isPunct(']')) {
        position += 1;
        return { type: 'list', elements };
      }
      for (;;) {
        elements.push(parseExpression(0));
        if (isPunct(',')) {
          position += 1;
          continue;
        }
        expectPunct(']');
        break;
      }
      return { type: 'list', elements };
    }

    throw new Error(`Unexpected "${token.value}"`);
  };

  /**
   * Member access, indexing and calls, which all bind tighter than any
   * operator: `note.a.b`, `note["my prop"]`, `file.inFolder("x")`.
   * @param {Object} node
   * @returns {Object}
   */
  const parsePostfix = (node) => {
    for (;;) {
      if (isPunct('.')) {
        position += 1;
        const token = peek();
        if (!token || token.type !== 'name') {
          throw new Error('Expected a property name after "."');
        }
        position += 1;
        node = { type: 'member', object: node, property: token.value };
        continue;
      }

      if (isPunct('[')) {
        position += 1;
        const index = parseExpression(0);
        expectPunct(']');
        node = { type: 'index', object: node, index };
        continue;
      }

      if (isPunct('(')) {
        position += 1;
        node = { type: 'call', callee: node, args: parseArguments() };
        continue;
      }

      return node;
    }
  };

  const parseUnary = () => {
    if (isPunct('!') || isPunct('-')) {
      const operator = peek().value;
      position += 1;
      return { type: 'unary', operator, argument: parseUnary() };
    }
    return parsePostfix(parsePrimary());
  };

  const parseExpression = (minPrecedence) => {
    let left = parseUnary();

    for (;;) {
      const token = peek();
      if (!token || token.type !== 'punct') { return left; }

      // Ternary: cond ? a : b
      if (token.value === '?' && minPrecedence === 0) {
        position += 1;
        const consequent = parseExpression(0);
        expectPunct(':');
        const alternate = parseExpression(0);
        left = { type: 'conditional', test: left, consequent, alternate };
        continue;
      }

      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence === undefined || precedence <= minPrecedence) { return left; }

      position += 1;
      const right = parseExpression(precedence);
      left = { type: 'binary', operator: token.value, left, right };
    }
  };

  const ast = parseExpression(0);

  if (!done()) {
    throw new Error(`Unexpected "${peek().value}" after the end of the expression`);
  }

  return ast;
};

/* -------------------------------------------------------------- coercions */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;

/**
 * A Date when the value looks like one, null otherwise. Only strings that
 * really are dates are converted, so "2 apples" stays a string.
 * @param {*} value
 * @returns {Date|null}
 */
const toDate = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' && ISO_DATE_RE.test(value.trim())) {
    const date = new Date(value.trim());
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

/**
 * A number when the value is one, or a string holding nothing but one.
 * @param {*} value
 * @returns {number|null}
 */
const toNumber = (value) => {
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
};

/**
 * Whether a value counts as "empty" — the test behind `isEmpty()` and behind
 * the truthiness of a filter.
 * @param {*} value
 * @returns {boolean}
 */
const isEmpty = (value) => {
  if (value === null || value === undefined) { return true; }
  if (typeof value === 'string') { return value.trim() === ''; }
  if (Array.isArray(value)) { return value.length === 0; }
  if (value instanceof Date) { return Number.isNaN(value.getTime()); }
  if (typeof value === 'object') { return Object.keys(value).length === 0; }
  return false;
};

/**
 * Truthiness, as a filter sees it: an empty value is false, `false` is false,
 * 0 is false, everything else is true.
 * @param {*} value
 * @returns {boolean}
 */
const isTruthy = (value) => {
  if (typeof value === 'boolean') { return value; }
  if (typeof value === 'number') { return value !== 0; }
  return !isEmpty(value);
};

const toText = (value) => {
  if (value === null || value === undefined) { return ''; }
  if (value instanceof Date) { return value.toISOString(); }
  if (Array.isArray(value)) { return value.map(toText).join(', '); }
  if (typeof value === 'object') { return JSON.stringify(value); }
  return String(value);
};

/**
 * Order two values: numbers numerically, dates chronologically, everything
 * else as case-insensitive text. Returns NaN when they cannot be compared.
 * @param {*} left
 * @param {*} right
 * @returns {number} -1, 0, 1 or NaN
 */
const compare = (left, right) => {
  if (isEmpty(left) || isEmpty(right)) {
    // Empty sorts before anything, and equals another empty
    if (isEmpty(left) && isEmpty(right)) { return 0; }
    return NaN;
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

  const leftText = toText(left).toLowerCase();
  const rightText = toText(right).toLowerCase();
  return Math.sign(leftText.localeCompare(rightText));
};

/**
 * Loose equality: 2 equals "2", an empty string equals null, and a list
 * equals a list with the same items.
 * @param {*} left
 * @param {*} right
 * @returns {boolean}
 */
const looseEquals = (left, right) => {
  if (isEmpty(left) && isEmpty(right)) { return true; }
  if (isEmpty(left) || isEmpty(right)) { return false; }

  if (Array.isArray(left) || Array.isArray(right)) {
    const leftList = Array.isArray(left) ? left : [left];
    const rightList = Array.isArray(right) ? right : [right];
    return leftList.length === rightList.length &&
      leftList.every((item, index) => looseEquals(item, rightList[index]));
  }

  if (typeof left === 'boolean' || typeof right === 'boolean') {
    return isTruthy(left) === isTruthy(right);
  }

  const comparison = compare(left, right);
  return comparison === 0;
};

/**
 * Does `haystack` contain `needle`? Works for strings (substring, case
 * insensitive) and for lists (any item loosely equal to the needle).
 * @param {*} haystack
 * @param {*} needle
 * @returns {boolean}
 */
const contains = (haystack, needle) => {
  if (Array.isArray(haystack)) {
    return haystack.some(item => looseEquals(item, needle));
  }
  if (isEmpty(haystack)) { return false; }
  return toText(haystack).toLowerCase().includes(toText(needle).toLowerCase());
};

const toList = (value) => {
  if (Array.isArray(value)) { return value; }
  if (value === null || value === undefined) { return []; }
  return [value];
};

/* ------------------------------------------------------------------ dates */

const pad = (value, length = 2) => String(value).padStart(length, '0');

/**
 * Format a date with a small subset of the moment.js tokens Obsidian uses.
 * @param {Date} date
 * @param {string} pattern
 * @returns {string}
 */
const formatDate = (date, pattern) => {
  const tokens = {
    YYYY: () => String(date.getFullYear()),
    YY: () => pad(date.getFullYear() % 100),
    MM: () => pad(date.getMonth() + 1),
    M: () => String(date.getMonth() + 1),
    DD: () => pad(date.getDate()),
    D: () => String(date.getDate()),
    HH: () => pad(date.getHours()),
    H: () => String(date.getHours()),
    mm: () => pad(date.getMinutes()),
    ss: () => pad(date.getSeconds())
  };

  return String(pattern || 'YYYY-MM-DD').replace(
    /YYYY|YY|MM|M|DD|D|HH|H|mm|ss/g,
    token => tokens[token]()
  );
};

/* -------------------------------------------------------- value functions */

/**
 * Methods callable on any value, chosen by the receiver's type. They come
 * second: a receiver that carries its own function under that name (the
 * `file` namespace and its `inFolder`, `hasTag`...) wins.
 */
const VALUE_METHODS = {
  // Shared by every type
  isEmpty: (receiver) => isEmpty(receiver),
  isNotEmpty: (receiver) => !isEmpty(receiver),
  toString: (receiver) => toText(receiver),
  contains: (receiver, needle) => contains(receiver, needle),
  containsAny: (receiver, ...needles) => toList(needles).flat().some(needle => contains(receiver, needle)),
  containsAll: (receiver, ...needles) => toList(needles).flat().every(needle => contains(receiver, needle)),

  // Strings
  startsWith: (receiver, prefix) =>
    toText(receiver).toLowerCase().startsWith(toText(prefix).toLowerCase()),
  endsWith: (receiver, suffix) =>
    toText(receiver).toLowerCase().endsWith(toText(suffix).toLowerCase()),
  lower: (receiver) => toText(receiver).toLowerCase(),
  upper: (receiver) => toText(receiver).toUpperCase(),
  trim: (receiver) => toText(receiver).trim(),
  title: (receiver) => toText(receiver).replace(/\b\w/g, letter => letter.toUpperCase()),
  replace: (receiver, search, replacement) =>
    toText(receiver).split(toText(search)).join(toText(replacement)),
  split: (receiver, separator) => toText(receiver).split(toText(separator ?? ',')).map(part => part.trim()),
  slice: (receiver, start, end) => (
    Array.isArray(receiver)
      ? receiver.slice(toNumber(start) ?? 0, end === undefined ? undefined : (toNumber(end) ?? undefined))
      : toText(receiver).slice(toNumber(start) ?? 0, end === undefined ? undefined : (toNumber(end) ?? undefined))
  ),

  // Lists
  join: (receiver, separator) => toList(receiver).map(toText).join(toText(separator ?? ', ')),
  unique: (receiver) => toList(receiver).filter(
    (item, index, list) => list.findIndex(other => looseEquals(other, item)) === index
  ),
  sort: (receiver) => [...toList(receiver)].sort((a, b) => {
    const result = compare(a, b);
    return Number.isNaN(result) ? 0 : result;
  }),
  reverse: (receiver) => (
    Array.isArray(receiver) ? [...receiver].reverse() : toText(receiver).split('').reverse().join('')
  ),
  first: (receiver) => toList(receiver)[0] ?? null,
  last: (receiver) => toList(receiver)[toList(receiver).length - 1] ?? null,

  // Numbers
  abs: (receiver) => Math.abs(toNumber(receiver) ?? 0),
  round: (receiver, digits) => {
    const factor = 10 ** (toNumber(digits) ?? 0);
    return Math.round((toNumber(receiver) ?? 0) * factor) / factor;
  },
  floor: (receiver) => Math.floor(toNumber(receiver) ?? 0),
  ceil: (receiver) => Math.ceil(toNumber(receiver) ?? 0),
  toFixed: (receiver, digits) => (toNumber(receiver) ?? 0).toFixed(toNumber(digits) ?? 0),

  // Dates
  format: (receiver, pattern) => {
    const date = toDate(receiver);
    return date ? formatDate(date, toText(pattern)) : '';
  },
  date: (receiver) => {
    const date = toDate(receiver);
    return date ? formatDate(date, 'YYYY-MM-DD') : '';
  },
  time: (receiver) => {
    const date = toDate(receiver);
    return date ? formatDate(date, 'HH:mm') : '';
  }
};

/**
 * Global functions. `if` and `choice` are special forms: they receive the
 * unevaluated argument nodes so only the branch that is taken runs.
 */
const FUNCTIONS = {
  number: (value) => toNumber(value),
  string: (value) => toText(value),
  date: (value) => toDate(value),
  now: () => new Date(),
  today: () => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  },
  list: (...values) => values.flat(),
  length: (value) => (Array.isArray(value) ? value.length : toText(value).length),
  min: (...values) => {
    const numbers = values.flat().map(toNumber).filter(value => value !== null);
    return numbers.length ? Math.min(...numbers) : null;
  },
  max: (...values) => {
    const numbers = values.flat().map(toNumber).filter(value => value !== null);
    return numbers.length ? Math.max(...numbers) : null;
  },
  sum: (...values) => values.flat().map(toNumber).filter(value => value !== null)
    .reduce((total, value) => total + value, 0),
  round: (value, digits) => VALUE_METHODS.round(value, digits),
  floor: (value) => Math.floor(toNumber(value) ?? 0),
  ceil: (value) => Math.ceil(toNumber(value) ?? 0),
  abs: (value) => Math.abs(toNumber(value) ?? 0),
  lower: (value) => toText(value).toLowerCase(),
  upper: (value) => toText(value).toUpperCase(),
  trim: (value) => toText(value).trim(),
  concat: (...values) => values.map(toText).join(''),
  join: (value, separator) => VALUE_METHODS.join(value, separator),
  contains: (haystack, needle) => contains(haystack, needle),
  isEmpty: (value) => isEmpty(value),
  empty: (value) => isEmpty(value),
  not: (value) => !isTruthy(value),
  default: (value, fallback) => (isEmpty(value) ? fallback : value)
};

const SPECIAL_FORMS = {
  if: true,
  choice: true
};

/* --------------------------------------------------------------- evaluator */

const NAMESPACES = ['note', 'file', 'formula', 'flow'];

/**
 * Evaluate an AST against a row scope.
 *
 * @param {Object} node - AST node, from parse()
 * @param {Object} scope - { note, file, formula } — `formula` may expose lazy
 *                         getters, so a formula can build on another one
 * @returns {*}
 */
const evaluateNode = (node, scope) => {
  switch (node.type) {
    case 'literal':
      return node.value;

    case 'list':
      return node.elements.map(element => evaluateNode(element, scope));

    case 'identifier': {
      if (NAMESPACES.includes(node.name)) {
        return scope[node.name] ?? {};
      }
      // A bare name is a frontmatter property
      const note = scope.note || {};
      return Object.prototype.hasOwnProperty.call(note, node.name) ? note[node.name] : null;
    }

    case 'member': {
      const object = evaluateNode(node.object, scope);
      if (object === null || object === undefined) { return null; }

      if (typeof object === 'string' || Array.isArray(object)) {
        if (node.property === 'length') { return object.length; }
      }

      if (typeof object !== 'object' && typeof object !== 'function') { return null; }

      const value = object[node.property];
      return value === undefined ? null : value;
    }

    case 'index': {
      const object = evaluateNode(node.object, scope);
      const index = evaluateNode(node.index, scope);
      if (object === null || object === undefined) { return null; }
      const key = Array.isArray(object) ? (toNumber(index) ?? 0) : toText(index);
      const value = object[key];
      return value === undefined ? null : value;
    }

    case 'unary': {
      if (node.operator === '!') {
        return !isTruthy(evaluateNode(node.argument, scope));
      }
      return -(toNumber(evaluateNode(node.argument, scope)) ?? 0);
    }

    case 'conditional':
      return isTruthy(evaluateNode(node.test, scope))
        ? evaluateNode(node.consequent, scope)
        : evaluateNode(node.alternate, scope);

    case 'binary':
      return evaluateBinary(node, scope);

    case 'call':
      return evaluateCall(node, scope);

    default:
      throw new Error(`Cannot evaluate a "${node.type}" node`);
  }
};

/**
 * @param {Object} node - A 'binary' AST node
 * @param {Object} scope
 * @returns {*}
 */
const evaluateBinary = (node, scope) => {
  // Short-circuit, so `note.a != null && note.a > 2` is safe
  if (node.operator === '&&') {
    return isTruthy(evaluateNode(node.left, scope)) && isTruthy(evaluateNode(node.right, scope));
  }
  if (node.operator === '||') {
    return isTruthy(evaluateNode(node.left, scope)) || isTruthy(evaluateNode(node.right, scope));
  }

  const left = evaluateNode(node.left, scope);
  const right = evaluateNode(node.right, scope);

  switch (node.operator) {
    case '==':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);
    case '>':
    case '>=':
    case '<':
    case '<=': {
      const comparison = compare(left, right);
      // Incomparable values (a missing property against a number) are never
      // greater or smaller: the row just does not match
      if (Number.isNaN(comparison)) { return false; }
      if (node.operator === '>') { return comparison > 0; }
      if (node.operator === '>=') { return comparison >= 0; }
      if (node.operator === '<') { return comparison < 0; }
      return comparison <= 0;
    }
    case '+': {
      // Numbers add up, anything else concatenates
      const leftNumber = toNumber(left);
      const rightNumber = toNumber(right);
      if (leftNumber !== null && rightNumber !== null &&
        typeof left !== 'string' && typeof right !== 'string') {
        return leftNumber + rightNumber;
      }
      if (typeof left === 'string' || typeof right === 'string') {
        return toText(left) + toText(right);
      }
      return (leftNumber ?? 0) + (rightNumber ?? 0);
    }
    case '-':
      return (toNumber(left) ?? 0) - (toNumber(right) ?? 0);
    case '*':
      return (toNumber(left) ?? 0) * (toNumber(right) ?? 0);
    case '/': {
      const divisor = toNumber(right) ?? 0;
      return divisor === 0 ? null : (toNumber(left) ?? 0) / divisor;
    }
    case '%': {
      const divisor = toNumber(right) ?? 0;
      return divisor === 0 ? null : (toNumber(left) ?? 0) % divisor;
    }
    default:
      throw new Error(`Unknown operator "${node.operator}"`);
  }
};

/**
 * @param {Object} node - A 'call' AST node
 * @param {Object} scope
 * @returns {*}
 */
const evaluateCall = (node, scope) => {
  const { callee, args } = node;

  // Global function, or one of the two special forms
  if (callee.type === 'identifier' && !NAMESPACES.includes(callee.name)) {
    if (SPECIAL_FORMS[callee.name]) {
      if (args.length < 2) {
        throw new Error(`${callee.name}() needs a condition and at least one branch`);
      }
      return isTruthy(evaluateNode(args[0], scope))
        ? evaluateNode(args[1], scope)
        : (args[2] === undefined ? null : evaluateNode(args[2], scope));
    }

    const fn = FUNCTIONS[callee.name];
    if (typeof fn === 'function') {
      return fn(...args.map(argument => evaluateNode(argument, scope)));
    }

    throw new Error(`Unknown function "${callee.name}()"`);
  }

  // Method call: the receiver's own function first, then the generic ones
  if (callee.type === 'member') {
    const receiver = evaluateNode(callee.object, scope);
    const values = args.map(argument => evaluateNode(argument, scope));

    if (receiver !== null && receiver !== undefined && typeof receiver === 'object' &&
      typeof receiver[callee.property] === 'function') {
      return receiver[callee.property](...values);
    }

    const method = VALUE_METHODS[callee.property];
    if (typeof method === 'function') {
      return method(receiver, ...values);
    }

    throw new Error(`Unknown method "${callee.property}()"`);
  }

  throw new Error('Only functions and methods can be called');
};

/* ---------------------------------------------------------------- caching */

// Filters and formulas are evaluated once per row, so the same handful of
// expressions is parsed over and over: keep the ASTs around.
const astCache = new Map();

/**
 * Parse an expression, reusing the AST of an expression already seen.
 * @param {string} source
 * @returns {Object} AST node
 */
const parseCached = (source) => {
  const key = String(source ?? '');
  if (!astCache.has(key)) {
    astCache.set(key, parse(key));
  }
  return astCache.get(key);
};

/**
 * Evaluate an expression against a row scope.
 *
 * @param {string} source - Expression, e.g. 'note.priority == "high"'
 * @param {Object} scope - { note, file, formula }
 * @returns {*}
 */
const evaluate = (source, scope) => evaluateNode(parseCached(source), scope || {});

/**
 * Evaluate an expression as a filter: any error (an unknown function, a typo)
 * means "does not match", and is reported instead of thrown, so one broken
 * filter cannot take the whole view down.
 *
 * @param {string} source
 * @param {Object} scope
 * @returns {{ matches: boolean, error: string|null }}
 */
const test = (source, scope) => {
  try {
    return { matches: isTruthy(evaluate(source, scope)), error: null };
  }
  catch (ex) {
    return { matches: false, error: ex.message };
  }
};

export {
  tokenize,
  parse,
  evaluate,
  test,
  compare,
  contains,
  formatDate,
  isEmpty,
  isTruthy,
  looseEquals,
  toDate,
  toList,
  toNumber,
  toText,
  FUNCTIONS,
  VALUE_METHODS
};
