/**
 * Resolving a `memory` mapping -- the flow's own way of saying what is worth
 * remembering out of something that just happened.
 *
 * Two places need exactly the same rules: a step's `memory:` block, resolved
 * against the response the step just gave, and a latent application's
 * `memory:` block, resolved against the message that arrived out of band. The
 * scope differs; the rules do not, so they live here.
 */
import 'colors';

import * as replacer from './replacer';

/**
 * A mapping value that is nothing but one `{{ expression }}`.
 *
 * Rendering such a value through Handlebars would turn it into text, and
 * escape it on the way: a bearer token would arrive with its padding as
 * `&#x3D;`, and a number as a string. So a lone expression is read straight
 * off the scope instead, and keeps whatever type it had.
 */
export const LONE_EXPRESSION = /^\s*\{\{\{?\s*([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*)\s*\}?\}\}\s*$/;

/** Read `a.b.c` off a value without throwing halfway down. */
export const at = (value, path) => String(path).split('.').reduce(
  (acc, key) => (acc === null || acc === undefined ? undefined : acc[key]),
  value
);

/**
 * What a `memory` mapping keeps, resolved against the scope it is written
 * against.
 *
 * A value that is not a string is kept as written -- `environment: "local"`
 * is a constant, not a template. A key that resolves to nothing is not
 * written: an undefined value would otherwise shadow whatever an earlier step
 * remembered under that name.
 *
 * @param {Object} mapping - The `memory` block, as the flow wrote it.
 * @param {Object} scope - What the templates may read.
 * @param {string} [label='Step memory'] - How the skipped keys are announced.
 * @returns {Object} The keys to merge into the flow memory.
 */
export const resolve = (mapping, scope, label = 'Step memory') => {
  const resolved = {};

  for (const key in mapping) {
    const template = mapping[key];

    // Anything that is not a template is what the flow wants remembered
    if (typeof template !== 'string') {
      resolved[key] = template;
      continue;
    }

    const lone = template.match(LONE_EXPRESSION);
    const value = lone ? at(scope, lone[1]) : replacer.string(template, scope);

    if (value === undefined || value === null || value === '') {
      console.log(`${label}: "${key}" resolved to nothing, so it was not remembered`.yellow);
      continue;
    }

    resolved[key] = value;
  }

  return resolved;
};
