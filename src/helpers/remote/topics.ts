/**
 * The MQTT topics a remote run travels on.
 *
 * Every agent owns one prefix, `flows/agents/<agent>`, and the broker's ACL is
 * written against exactly these shapes: an agent may only publish under its
 * own name, and a person may only publish the two channels an agent reads.
 * Nothing here talks to a broker -- it only names things, so both sides name
 * them the same way.
 *
 *   flows/agents/<agent>/status                 retained + last will
 *   flows/agents/<agent>/jobs/<job>/request     person -> agent
 *   flows/agents/<agent>/jobs/<job>/input       person -> agent
 *   flows/agents/<agent>/jobs/<job>/events      agent -> person
 *   flows/agents/<agent>/jobs/<job>/result      agent -> person
 */

const PREFIX = 'flows/agents';

/** Agent and job names become topic segments, so they are validated as such. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Channel = 'request' | 'input' | 'events' | 'result';

const CHANNELS: Channel[] = ['request', 'input', 'events', 'result'];

/**
 * Refuse a name that could not be a topic segment.
 * @param {string} value
 * @param {string} what - What the name is, for the error
 * @returns {string} The name, unchanged
 */
const assertName = (value: string, what = 'Name'): string => {
  if (!NAME.test(String(value || ''))) {
    throw new Error(`${what} "${value}" is not usable: letters, digits, dots, dashes and underscores only`);
  }
  return value;
};

/** Where an agent says whether it is online and busy. */
const status = (agent: string) => `${PREFIX}/${assertName(agent, 'Agent name')}/status`;

/** Every agent's status, for whoever wants to list them. */
const allStatus = () => `${PREFIX}/+/status`;

/** One channel of one job. */
const job = (agent: string, id: string, channel: Channel) =>
  `${PREFIX}/${assertName(agent, 'Agent name')}/jobs/${assertName(id, 'Job id')}/${channel}`;

/** One channel of every job of an agent, for the side that listens. */
const jobs = (agent: string, channel: Channel) =>
  `${PREFIX}/${assertName(agent, 'Agent name')}/jobs/+/${channel}`;

interface ParsedTopic {
  agent: string;
  /** Absent for a status topic */
  job?: string;
  channel: Channel | 'status';
}

/**
 * Read an agent, a job and a channel back out of a topic. Null for a topic
 * that is not one of ours.
 * @param {string} topic
 * @returns {ParsedTopic|null}
 */
const parse = (topic: string): ParsedTopic | null => {
  const parts = String(topic || '').split('/');

  if (parts[0] !== 'flows' || parts[1] !== 'agents' || !NAME.test(parts[2] || '')) {
    return null;
  }

  if (parts.length === 4 && parts[3] === 'status') {
    return { agent: parts[2], channel: 'status' };
  }

  if (parts.length === 6 && parts[3] === 'jobs' && NAME.test(parts[4]) && CHANNELS.includes(parts[5] as Channel)) {
    return { agent: parts[2], job: parts[4], channel: parts[5] as Channel };
  }

  return null;
};

/**
 * Whether a topic matches a subscription filter, with MQTT's `+` and `#`.
 * @param {string} filter
 * @param {string} topic
 * @returns {boolean}
 */
const matches = (filter: string, topic: string): boolean => {
  const pattern = String(filter || '').split('/');
  const actual = String(topic || '').split('/');

  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index];

    if (segment === '#') {
      return true;
    }

    if (index >= actual.length) {
      return false;
    }

    if (segment !== '+' && segment !== actual[index]) {
      return false;
    }
  }

  return pattern.length === actual.length;
};

export type { Channel, ParsedTopic };
export { PREFIX, NAME, assertName, status, allStatus, job, jobs, parse, matches };
