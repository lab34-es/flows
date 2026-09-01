/**
 * Filters, as the editor holds them.
 *
 * A filter is a tree: a group carries a conjunction and the conditions under
 * it, and a condition is a property, an operator and a value. Nothing here is
 * text to be parsed, so nothing here can be a syntax error — the whole point
 * of the structured editor. The operators themselves live in the backend and
 * arrive through /api/views/operators, so this file never decides what a
 * property can be asked.
 */

/** Whether a node is a group rather than a single condition. */
export function isGroup(node) {
  return Boolean(node && typeof node === 'object' && Array.isArray(node.conditions));
}

/** How many conditions a node holds, nested ones included. */
export function countConditions(node) {
  if (!node) { return 0; }
  if (!isGroup(node)) { return 1; }
  return node.conditions.reduce((total, child) => total + countConditions(child), 0);
}

/** An empty group, which is what "no filter" turns into when you add one. */
export function emptyGroup(conjunction = 'and') {
  return { conjunction, conditions: [] };
}

/**
 * The operators a property of this type is offered, in catalog order.
 * @param {Object} catalog - From /api/views/operators
 * @param {string} type
 * @returns {Array<Object>}
 */
export function operatorsForType(catalog, type) {
  return (catalog?.operators || []).filter((operator) => operator.types.includes(type));
}

/**
 * One operator's entry in the catalog.
 * @param {Object} catalog
 * @param {string} id
 * @returns {Object|null}
 */
export function findOperator(catalog, id) {
  return (catalog?.operators || []).find((operator) => operator.id === id) || null;
}

/**
 * What a property holds. `file` is the whole-file pseudo-property; everything
 * else is whatever the folder's flows were seen to carry.
 * @param {Object} types - propertyTypes from /api/views/query
 * @param {string} propertyId
 * @returns {string}
 */
export function typeOf(types, propertyId) {
  if (propertyId === 'file') { return 'file'; }
  return types?.[propertyId] || 'text';
}

/**
 * The value control an operator wants: `same` follows the property's own
 * type, so it is resolved here rather than in the component.
 * @param {Object} operator - A catalog entry
 * @param {string} type - The property's type
 * @returns {string} none | text | number | checkbox | date | list | folder | tag | property
 */
export function inputFor(operator, type) {
  if (!operator) { return 'none'; }
  return operator.input === 'same' ? type : operator.input;
}

/**
 * A condition for a property, keeping the current operator when the new
 * property still offers it and falling back to the first one it does.
 *
 * @param {Object} catalog
 * @param {Object} types
 * @param {string} propertyId
 * @param {string} [preferred] - An operator to keep if it still applies
 * @returns {Object} { property, operator, value }
 */
export function conditionFor(catalog, types, propertyId, preferred?) {
  const type = typeOf(types, propertyId);
  const offered = operatorsForType(catalog, type);
  const operator = offered.find((entry) => entry.id === preferred) || offered[0];

  if (!operator) { return { property: propertyId, operator: '', value: null }; }

  const input = inputFor(operator, type);
  const condition: Record<string, any> = { property: propertyId, operator: operator.id };
  if (input !== 'none') { condition.value = input === 'list' ? [] : ''; }
  return condition;
}

/**
 * Replace (or, with null, remove) the node at a path of child indexes.
 *
 * @param {Object} group
 * @param {Array<number>} path
 * @param {*} next - The replacement, or null to remove
 * @returns {Object}
 */
export function replaceAt(group, path, next) {
  if (!path.length) { return next; }

  const [head, ...rest] = path;
  const conditions = group.conditions
    .map((child, index) => (index === head ? replaceAt(child, rest, next) : child))
    .filter(Boolean);

  return { ...group, conditions };
}

/**
 * Append a node to the group at a path.
 * @param {Object} group
 * @param {Array<number>} path - The group to append to ([] for the root)
 * @param {Object} node
 * @returns {Object}
 */
export function appendAt(group, path, node) {
  if (!path.length) { return { ...group, conditions: [...group.conditions, node] }; }

  const [head, ...rest] = path;
  return {
    ...group,
    conditions: group.conditions.map((child, index) => (
      index === head ? appendAt(child, rest, node) : child
    )),
  };
}

/**
 * What is saved to views.yaml: a group with nothing in it is no filter at
 * all, and an empty nested group never reaches the file.
 * @param {Object} group
 * @returns {Object|null}
 */
export function prune(group) {
  if (!isGroup(group)) { return group || null; }

  const conditions = group.conditions
    .map((child) => (isGroup(child) ? prune(child) : child))
    .filter(Boolean);

  return conditions.length ? { ...group, conditions } : null;
}
