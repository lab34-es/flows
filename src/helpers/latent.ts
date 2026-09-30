/**
 * What every latent application does the same way: decide whether a message
 * that arrived is the one a step expected, keep what the flow asked to keep
 * out of it, and look again while it has not arrived yet.
 *
 * A latent application only knows its own transport -- MQTT topics and their
 * wildcards, Kafka keys and headers. What "the message says what the test
 * expected" means does not depend on the transport, so it lives here, and an
 * assertion on MQTT reads exactly like one on Kafka.
 */
import * as memory from './memory';

/**
 * What arrived, as something a test can look into.
 *
 * A payload that is not JSON is kept as text rather than thrown away: a
 * broker carrying MessagePack, or a device publishing a bare string, would
 * otherwise take the whole run down from inside an event handler, where
 * nothing can catch it. No payload at all -- a Kafka tombstone -- is `null`.
 *
 * @param {Buffer|null|undefined} payload
 * @returns {any}
 */
export const decode = (payload) => {
  if (payload === undefined || payload === null) { return null; }

  const text = payload.toString();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/**
 * A template with what the flow already knows filled in.
 *
 * A device id is looked up by a step; the topic it publishes on is only known
 * once that step has run. `msg/cloud/{{ memory.device }}/command` is
 * therefore resolved against the memory as it stands when the assertion is
 * made -- unlike a `test` body, which is compared literally. Anything nothing
 * has remembered yet is left as written, so the report shows what was asked.
 *
 * @param {*} template - Usually a topic or a key; anything else is returned as is.
 * @param {Object} flow - The flow, for its memory.
 * @returns {*}
 */
export const interpolate = (template, flow) => {
  if (typeof template !== 'string' || !template.includes('{{')) {return template;}

  return template.replace(
    /\{\{\{?\s*([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*)\s*\}?\}\}/g,
    (whole, path) => {
      const value = memory.at({ memory: flow?.memory || {} }, path);
      return value === undefined || value === null ? whole : String(value);
    }
  );
};

/**
 * Whether a received value says what the test expected of it.
 *
 * Only the keys the test names are looked at, at any depth, so a test states
 * the two fields it cares about rather than the whole envelope a device
 * sends. A `$expr:` value is a JavaScript expression over the actual value,
 * exactly as in a step's `body` assertion -- which is how a list is asserted
 * on without pinning the order its items arrived in. `memory` is in scope
 * there too, so a message can be matched against what an earlier step
 * remembered -- `$expr: value.some(b => b.bcd === memory.barcode)`.
 *
 * @param {*} expected
 * @param {*} actual
 * @param {Object} [flow]
 * @returns {boolean}
 */
export const matches = (expected, actual, flow?) => {
  if (typeof expected === 'string' && expected.startsWith('$expr:')) {
    try {
      return !!new Function('value', 'memory', 'flow', `return ${expected.substring(6)}`)(
        actual, flow?.memory || {}, flow || {}
      );
    } catch (error) {
      console.log(`Error evaluating expression: ${expected}`, error);
      return false;
    }
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length < expected.length) {return false;}
    return expected.every((item, index) => matches(item, actual[index], flow));
  }

  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') {return false;}
    return Object.keys(expected).every(key => matches(expected[key], actual[key], flow));
  }

  return expected === actual;
};

/** What a latent application found when it looked for one expected message. */
export type Lookup =
  /** It arrived. `scope` is what the expectation's `memory` mapping may read. */
  | { found: true; scope: Record<string, any> }
  /** It did not. `missing` is how the report describes it. */
  | { found: false; missing: Record<string, any> };

/** How many times to look, and how many **seconds** to wait between two looks. */
export interface Retry {
  attempts?: number;
  delay?: number;
}

/**
 * Look for every message a step expects, as many times as `retry` allows.
 *
 * Each look goes through the whole list, so a message that has arrived keeps
 * its `memory` mapping applied however long the others take. The last look
 * decides: what is still missing then is what the step reports.
 *
 * @param {Object} flow - The flow, whose memory a matched message writes to.
 * @param {Object[]} expectations - The assertion's `test` list.
 * @param {Retry} [retry] - One look, straight away, when omitted.
 * @param {Function} find - Looks for one expectation among what arrived. It may
 *   throw to say it never will -- the listener behind it broke -- which fails
 *   the assertion with that error rather than with a list of what is missing.
 * @param {string} [label='latent'] - The application, for the error an
 *   assertion without a `test` list gets.
 * @returns {Promise<Object[]>} What never arrived: an empty list is a pass.
 */
export const check = (
  flow,
  expectations,
  retry: Retry | undefined,
  find: (expected: Record<string, any>) => Lookup,
  label = 'latent'
): Promise<Record<string, any>[]> => new Promise((resolve, reject) => {
  if (!Array.isArray(expectations)) {
    reject(new Error(`The ${label} assertion lists no messages: write them under its "test" key`));
    return;
  }

  const attempts = retry?.attempts || 1;
  const delay = retry?.delay || 0;
  let attempt = 0;

  const look = () => {
    attempt++;

    // From a timer, so nothing above could catch what escaped
    try {
      const missing: Record<string, any>[] = [];

      expectations.forEach((expected) => {
        const lookup = find(expected);

        if (!lookup.found) {
          missing.push(lookup.missing);
          return;
        }

        // What the flow wants to keep out of the message that arrived. The
        // scope is the message itself, so a value that exists nowhere else
        // -- an order created by a device -- reaches the steps below.
        if (expected.memory && flow) {
          flow.memory = Object.assign(
            flow.memory || {},
            memory.resolve(expected.memory, { ...lookup.scope, memory: flow.memory || {} }, 'Latent memory')
          );
        }
      });

      if (!missing.length || attempt >= attempts) {
        resolve(missing);
        return;
      }

      setTimeout(look, delay * 1000);
    } catch (error) {
      reject(error);
    }
  };

  look();
});

/**
 * Which application's env file a listener takes its connection from, if any.
 *
 * A flow names the broker or the cluster once, in an application it already
 * has -- `connection: orders` -- instead of writing a host, and credentials,
 * into the flow. The environment the flow runs against then decides which
 * env file of that application is read, so one flow runs against every
 * environment, and no secret ever lives in it.
 *
 * @param {*} connection - The frontmatter entry's `connection`: an
 *   application name, an object naming one as `application`, or an object
 *   that is the whole connection.
 * @returns {string|null}
 */
export const connectionSource = (connection): string | null => {
  if (typeof connection === 'string') { return connection.trim() || null; }
  if (connection && typeof connection === 'object' && typeof connection.application === 'string') {
    return connection.application.trim() || null;
  }
  return null;
};

/**
 * The connection fields the flow wrote itself, which win over what the env
 * file says: `connection: { application: orders, groupId: qa }` changes one
 * thing and keeps the rest.
 *
 * @param {*} connection
 * @returns {Object}
 */
export const connectionOverrides = (connection): Record<string, any> => {
  if (!connection || typeof connection !== 'object') { return {}; }

  const { application: _application, ...overrides } = connection;
  return overrides;
};
