/**
 * The `kafka` latent application: what a system says on Kafka, asserted on.
 *
 * The counterpart of the `mqtt` one, and written the same way. A listener
 * declared in the flow's frontmatter joins the cluster before the first step
 * runs, and everything published to its topics from then on is kept. A step
 * then asserts that a message arrived -- on which topic, under which key and
 * headers, saying what -- and can keep values out of it in the flow memory,
 * which is how an id that only ever exists in an event reaches the steps
 * below.
 *
 *     latentApplications:
 *       - application: kafka
 *         client: orders
 *         connection: shop
 *         subscribe:
 *           - topic: shop.orders
 *
 * `connection: shop` reads the cluster -- brokers, credentials, schema
 * registry -- from the `KAFKA_*` variables of the `shop` application, in the
 * env file of whichever environment the flow runs against. The cluster can
 * be written in the flow instead (`connection: { brokers: [...] }`), and
 * `connection: { application: shop, groupId: ... }` overrides a field of it.
 *
 * Messages in the Confluent wire format are decoded with the Avro schema the
 * registry holds for them, when one is configured; everything else is read
 * as JSON, or as text. Both can arrive on the same topic.
 *
 * A listener only ever sees what is published *after* the flow started: it is
 * there to observe what the steps cause, and a topic's history is somebody
 * else's. It commits nothing, and belongs to a consumer group of its own, so
 * it takes no messages away from the services that are consuming the same
 * topics for real.
 */
import createDebug from 'debug';
import { v4 as uuidv4 } from 'uuid';

import * as avro from '../helpers/avro';
import * as latent from '../helpers/latent';
import { connectionOptions, library, reason, settingsFromEnv } from '../helpers/kafkaConnection';
import type { ConnectionSettings } from '../helpers/kafkaConnection';

const debug = createDebug('ronsel:latentApplications:kafka');

/** One message as a listener keeps it, and as an assertion reads it. */
interface Received {
  topic: string;
  partition: number;
  offset: number;
  key: string | null;
  headers: Record<string, string | null>;
  /** When the producer says it was published, in milliseconds since the epoch. */
  timestamp: number;
  /** The value: parsed when it is JSON, text when not, `null` for a tombstone. */
  message: any;
  /** When the listener received it. */
  date: Date;
}

interface Instance {
  consumer: { close: (force?: boolean) => Promise<void> } | null;
  stream: { close: () => Promise<void> } | null;
  messages: Received[];
  /** Whether it has had to drop messages to stay within MAX_MESSAGES. */
  trimmed: boolean;
  /** What broke the listener after it had started, if anything did. */
  failure: Error | null;
  /** The messages still being decoded, in the order they arrived. */
  pending: Promise<void>;
}

const instances: Record<string, Instance> = {};

/**
 * How many messages a listener keeps. A topic shared with everybody else's
 * traffic can deliver far more than a flow will ever look at, and a run that
 * kept them all would eventually take the process down with it. The oldest
 * are dropped first: what a step is waiting for is what happened last.
 */
const MAX_MESSAGES = 10_000;

/** The topics a listener subscribes to, written as `{ topic }` entries or bare names. */
const subscriptions = (subscribe): string[] => {
  const entries = Array.isArray(subscribe) ? subscribe : subscribe ? [subscribe] : [];
  const topics = entries
    .map(entry => (typeof entry === 'string' ? entry : entry?.topic))
    .filter(topic => topic !== undefined && topic !== null && topic !== '')
    .map(String);

  return [...new Set(topics)];
};

/** Bytes as text, keeping the difference between no value and an empty one. */
const text = (value): string | null => (value === undefined || value === null ? null : value.toString());

/**
 * A message off the wire, as an assertion reads it. Key and value arrive as
 * text, or parsed JSON -- unless `decoded` says what they are, which is how an
 * Avro message arrives.
 */
const receive = (message, decoded: { key?: any; value?: any } = {}): Received => ({
  topic: message.topic,
  partition: message.partition,
  offset: Number(message.offset),
  key: decoded.key !== undefined ? decoded.key : text(message.key),
  headers: Object.fromEntries(
    [...(message.headers || new Map())].map(([name, value]) => [String(name), text(value)])
  ),
  timestamp: Number(message.timestamp),
  message: decoded.value !== undefined ? decoded.value : latent.decode(message.value),
  date: new Date()
});

/**
 * A message whose key or value may be Avro, decoded with the schema the
 * registry holds for it. What cannot be decoded -- a registry that is down,
 * a schema it does not know -- is read as anything else would be, and said
 * once, rather than dropping a message a step may be waiting for.
 */
const receiveAvro = async (id: string, decoder, message, reported: Set<string>): Promise<Received> => {
  const decode = async (bytes) => {
    if (!avro.framed(bytes)) { return undefined; }

    try {
      return await decoder.decode(bytes);
    } catch (error) {
      const problem = reason(error);
      if (!reported.has(problem)) {
        reported.add(problem);
        console.error(`Kafka client '${id}' could not decode an Avro message, and kept it as text: ${problem}`);
      }
      return undefined;
    }
  };

  return receive(message, { key: await decode(message.key), value: await decode(message.value) });
};

/**
 * Keep a message, dropping the oldest ones in a batch once there are too many,
 * rather than one per message -- and saying so once, not once per batch.
 */
const keep = (id: string, instance: Instance, received: Received) => {
  instance.messages.push(received);

  if (instance.messages.length > MAX_MESSAGES + MAX_MESSAGES / 10) {
    instance.messages.splice(0, instance.messages.length - MAX_MESSAGES);

    if (!instance.trimmed) {
      instance.trimmed = true;
      console.log(`Kafka client '${id}' has received more than ${MAX_MESSAGES} messages: only the latest ${MAX_MESSAGES} are kept`);
    }
  }
};

/**
 * Join the cluster and start listening, before the first step runs.
 *
 * Where "from now on" begins is pinned first, as the end of every partition
 * of every topic, and the listener reads from exactly there. It does not
 * matter how long the consumer group then takes to form, nor what the steps
 * publish meanwhile: all of it is past those offsets, so none of it is missed.
 *
 * The group is joined with the protocol Kafka 4 introduced (KIP-848), which
 * hands a new member its partitions in milliseconds; the classic one waits
 * out the broker's initial rebalance delay -- three seconds, by default -- on
 * every run. A cluster that predates it is joined the classic way instead.
 *
 * A topic that does not exist yet is asked for, as a Java consumer does, so a
 * listener can be declared before anything was ever published to its topic;
 * a cluster that does not create topics on demand refuses it instead.
 *
 * @param {Object} flow
 * @param {Object} details - The frontmatter entry: `client`, `connection`,
 *   `subscribe` and, where the cluster's ACLs ask for a known name, `groupId`.
 */
const start = async (flow, details) => {
  const { client: id } = details;

  if (instances[id]) {
    return;
  }

  const topics = subscriptions(details.subscribe);

  if (!topics.length) {
    throw new Error(`Kafka client '${id}' has nothing to listen to: name its topics under "subscribe"`);
  }

  const kafka = library();
  const instance: Instance = {
    consumer: null,
    stream: null,
    messages: [],
    trimmed: false,
    failure: null,
    pending: Promise.resolve()
  };

  // A consumer that cannot rejoin its group says so with an 'error' event,
  // and an event nobody listens to would crash the process -- the whole
  // server, when the flow runs from the UI. It is kept instead, and handed to
  // the next assertion that finds nothing -- but only while the listener is
  // live, and only from what it listens with: a consumer that was replaced
  // while joining, or one being closed, has nothing left to say about it.
  const broken = (source) => (error) => {
    if (instances[id] !== instance || (source !== instance.consumer && source !== instance.stream)) { return; }
    instance.failure = error;
    console.error(`Kafka client '${id}' stopped listening: ${reason(error)}`);
  };

  let consumer;

  try {
    // The env file of the application `connection` names, if it names one,
    // and then whatever the flow wrote itself
    const settings: ConnectionSettings = {
      ...(details.env ? settingsFromEnv(details.env) : {}),
      ...latent.connectionOverrides(details.connection)
    };

    const decoder = settings.schemaRegistry?.url ? avro.registry(settings.schemaRegistry) : null;
    const reported = new Set<string>();

    const options = {
      ...connectionOptions(settings),
      // A group of its own, so no service consuming the same topics has a
      // single message taken away from it
      groupId: details.groupId || `ronsel-${id}-${uuidv4()}`,
      autocommit: false,
      autocreateTopics: true
    };

    const consumerFor = (modern: boolean) => {
      const created = new kafka.Consumer(modern
        ? { ...options, groupProtocol: kafka.GroupProtocols.CONSUMER }
        : { ...options, groupProtocol: kafka.GroupProtocols.CLASSIC });
      created.on('error', broken(created));
      return created;
    };

    consumer = consumerFor(true);

    const ends = await consumer.listOffsets({ topics });
    const offsets: { topic: string; partition: number; offset: bigint }[] = [];

    for (const [topic, partitions] of ends) {
      partitions.forEach((offset, partition) => offsets.push({ topic, partition, offset }));
    }

    const consume = () => consumer.consume({
      topics,
      mode: kafka.MessagesStreamModes.MANUAL,
      offsets,
      autocommit: false
    });

    let stream;

    try {
      stream = await consume();
    } catch (modern) {
      debug('Kafka client %s could not join with the consumer protocol, joining the classic way: %s', id, reason(modern));
      await consumer.close(true).catch(() => {});
      consumer = consumerFor(false);
      stream = await consume();
    }

    stream.on('data', (message) => {
      if (!decoder) {
        keep(id, instance, receive(message));
        return;
      }

      // Decoding may wait on the registry; messages still keep their order
      instance.pending = instance.pending
        .then(() => receiveAvro(id, decoder, message, reported))
        .then(received => keep(id, instance, received));
    });
    stream.on('error', broken(stream));

    instance.consumer = consumer;
    instance.stream = stream;
    instances[id] = instance;
  } catch (error) {
    await consumer?.close(true).catch(() => {});
    throw new Error(`Kafka client '${id}' could not listen to ${topics.join(', ')}: ${reason(error)}`, { cause: error });
  }
};

/**
 * Leave the group and disconnect. The runner does it when the flow is over,
 * so a listener never outlives the run it was declared for.
 *
 * @param {string} id - The `client` of the frontmatter entry.
 */
const stop = async (id) => {
  const instance = instances[id];

  if (!instance) {
    return;
  }

  delete instances[id];

  try {
    await instance.stream?.close();
  } catch (error) {
    console.error(`Kafka client '${id}' did not close cleanly: ${reason(error)}`);
  }

  try {
    await instance.consumer?.close(true);
  } catch (error) {
    console.error(`Kafka client '${id}' did not leave its group cleanly: ${reason(error)}`);
  }
};

/** A key or a header value, written in YAML, as the text Kafka carries: `key: 42` means "42". */
const asText = (value) => (typeof value === 'number' || typeof value === 'boolean' ? String(value) : value);

/**
 * Whether the messages a step expects have arrived.
 *
 * Everything is optional but the topic, and everything named has to match:
 *
 * - `topic` is the exact name, with `{{ memory.* }}` filled in.
 * - `key` is compared the same way -- an id a step looked up usually is the
 *   key -- or evaluated, when it is a `$expr:`.
 * - `headers` are matched by the ones named, as the message is.
 * - `message` is the value, matched exactly like an MQTT message: only the
 *   keys named, at any depth, `$expr:` where a value is not enough. `value`,
 *   which is what Kafka calls it, is read when `message` is not there. Leave
 *   both out to match on the topic, key and headers alone.
 *
 * A matched message's `memory` mapping reads `topic`, `partition`, `offset`,
 * `key`, `headers`, `timestamp` and `message` (also as `value`). An Avro
 * message reads exactly like a JSON one: it has been decoded by then.
 *
 * @returns {Promise<Object[]>} What never arrived: an empty list is a pass.
 */
const test = (flow, test, _contents) => {
  const { client: id, test: expectations, retry } = test;
  const instance = instances[id];

  if (!instance) {
    return Promise.reject(new Error(`Kafka client '${id}' does not exist or is not connected`));
  }

  return latent.check(flow, expectations, retry, (expected) => {
    if (expected.topic === undefined || expected.topic === null || expected.topic === '') {
      throw new Error(`Kafka client '${id}' was asked for a message without a topic: every message under "test" names one`);
    }

    const topic = asText(latent.interpolate(expected.topic, flow));
    const key = expected.key === undefined ? undefined : asText(latent.interpolate(expected.key, flow));
    const headers = expected.headers === undefined || expected.headers === null
      ? undefined
      : Object.fromEntries(Object.entries(expected.headers).map(([name, value]) => [name, asText(value)]));
    const message = expected.message !== undefined ? expected.message : expected.value;

    const found = instance.messages.find(m =>
      m.topic === topic &&
      (key === undefined || latent.matches(key, m.key, flow)) &&
      (headers === undefined || latent.matches(headers, m.headers, flow)) &&
      (message === undefined || latent.matches(message, m.message, flow))
    );

    if (found) {
      const { date: _date, ...scope } = found;
      return { found: true, scope: { ...scope, value: found.message } };
    }

    // It will not arrive either: the listener has stopped listening
    if (instance.failure) {
      throw new Error(`Kafka client '${id}' stopped listening: ${reason(instance.failure)}`, { cause: instance.failure });
    }

    const missing: Record<string, any> = { topic };
    if (key !== undefined) { missing.key = key; }
    if (headers !== undefined) { missing.headers = headers; }
    if (message !== undefined) { missing.message = message; }

    return { found: false, missing };
  }, 'kafka');
};

export { start };
export { stop };
export { test };
