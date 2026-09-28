/**
 * Publishing to Kafka from an application.
 *
 * The mirror of the `kafka` latent application: that one *listens* for what a
 * system says out of band, this one *speaks* -- it is how a flow plays a
 * service that is not there, the payment provider confirming a charge or the
 * warehouse announcing a shipment.
 *
 * Connection details come from the application's environment, so a method
 * takes nothing but the topic and the message, and the same flow runs against
 * a local broker or a secured cluster by swapping env files.
 *
 * | Variable | What it is |
 * | --- | --- |
 * | `KAFKA_BROKERS` | Bootstrap brokers, `host:port`, comma separated. Required. |
 * | `KAFKA_CLIENT_ID` | What the cluster knows the client as. `ronsel` when omitted. |
 * | `KAFKA_SSL` | `true` to connect over TLS. Implied when a certificate is configured. |
 * | `KAFKA_CA`, `KAFKA_CERT`, `KAFKA_KEY` | Paths to the TLS material, for a cluster that checks client certificates. |
 * | `KAFKA_REJECT_UNAUTHORIZED` | `false` to accept a self-signed broker certificate. |
 * | `KAFKA_SASL_MECHANISM` | `PLAIN`, `SCRAM-SHA-256` or `SCRAM-SHA-512`. `PLAIN` when omitted. |
 * | `KAFKA_USERNAME`, `KAFKA_PASSWORD` | Credentials, when the cluster asks for them. |
 *
 * A publish is only over once every in-sync replica has the message
 * (`acks=all`), so whatever consumes it can read it the moment the step ends.
 * A keyed message goes to the partition a Java producer would pick for that
 * key, so it keeps its place in line with what the real services publish.
 * A topic that does not exist yet is asked for, as a Java producer does: the
 * broker creates it if it is configured to, and refuses the publish if not.
 *
 * The connection is opened for the publish and closed again after it, as in
 * `mqttClient`: a flow publishes a handful of messages over a run, and a
 * producer left open would hold the process after the last step.
 */
import createDebug from 'debug';

import { connectionOptions, library, reason } from './kafkaConnection';
import type { ConnectionSettings } from './kafkaConnection';

const debug = createDebug('ronsel:helpers:kafkaClient');

/** What `publish` accepts beyond the topic and the message. */
export interface PublishOptions {
  /**
   * The message key. It decides the partition -- every message about one
   * order lands in the same one, in order -- and tells a consumer which
   * entity the message is about.
   */
  key?: string;
  /** Message headers: a correlation id, an event type, a schema version. */
  headers?: Record<string, string>;
  /** The partition to write to. The one the key hashes to when omitted. */
  partition?: number;
  /**
   * How the message becomes bytes. JSON when omitted -- give an encoder to
   * speak a binary dialect (Avro, protobuf) without this helper taking a
   * dependency on it. A Buffer is sent exactly as it is.
   */
  encode?: (message: any) => string | Buffer;
}

/** The cluster, read off the application's environment. */
const settings = (ctx): ConnectionSettings => {
  const env = ctx.env || {};

  if (!env.KAFKA_BROKERS) {
    throw new Error('KAFKA_BROKERS is not set: the application has no cluster to publish to');
  }

  return {
    brokers: env.KAFKA_BROKERS,
    clientId: env.KAFKA_CLIENT_ID,
    ssl: env.KAFKA_SSL === 'true',
    ca: env.KAFKA_CA,
    cert: env.KAFKA_CERT,
    key: env.KAFKA_KEY,
    rejectUnauthorized: env.KAFKA_REJECT_UNAUTHORIZED === 'false' ? false : undefined,
    sasl: env.KAFKA_USERNAME || env.KAFKA_SASL_MECHANISM
      ? { mechanism: env.KAFKA_SASL_MECHANISM, username: env.KAFKA_USERNAME, password: env.KAFKA_PASSWORD }
      : undefined
  };
};

/** The message as bytes: JSON, unless it already is bytes or an encoder says otherwise. */
const encode = (topic: string, message: any, opts: PublishOptions): Buffer => {
  if (message === undefined) {
    throw new Error(`Nothing to publish to ${topic}: the message is missing`);
  }

  if (opts.encode) { return Buffer.from(opts.encode(message)); }
  if (Buffer.isBuffer(message)) { return message; }
  return Buffer.from(JSON.stringify(message));
};

/**
 * Publishes one message and disconnects.
 *
 * @param {Object} ctx - The application context, for its `env`.
 * @param {string} topic - Topic to publish on.
 * @param {any} message - The message. Encoded as JSON unless `opts.encode` says otherwise.
 * @param {PublishOptions} [opts] - Key, headers, partition, encoding.
 * @returns {Promise<[null, null, Object]>} The `[headers, status, body]` tuple
 *   an application answers with. The body is what was published and where it
 *   landed -- `{ topic, partition, offset, key, headers, message }` -- so a
 *   step can assert on the message it sent, and remember an id it generated.
 * @throws {Error} When the cluster cannot be reached, or refuses the publish.
 */
export const publish = async (
  ctx,
  topic: string,
  message: any,
  opts: PublishOptions = {}
): Promise<[null, null, Record<string, any>]> => {
  const connection = connectionOptions(settings(ctx));
  const kafka = library();
  const value = encode(topic, message, opts);
  const headers = Object.fromEntries(
    Object.entries(opts.headers || {}).map(([name, header]) => [name, String(header)])
  );
  const key = opts.key === undefined || opts.key === null ? undefined : String(opts.key);

  debug('Publishing to %s on %s', topic, connection.bootstrapBrokers.join(','));

  const producer = new kafka.Producer<string, Buffer, string, string>({
    ...connection,
    serializers: {
      key: kafka.stringSerializer,
      headerKey: kafka.stringSerializer,
      headerValue: kafka.stringSerializer
    },
    // Hash the key the way the Java client does. The library's own default
    // disagrees with it for about half of all keys, so a message a flow
    // publishes under an order id would land on another partition than the
    // real service's messages about that order -- and a consumer relying on
    // them arriving in order would see it overtake them.
    partitioner: kafka.compatibilityPartitioner
  });

  try {
    const result = await producer.send({
      messages: [{ topic, key, value, headers, partition: opts.partition }],
      acks: kafka.ProduceAcks.ALL,
      autocreateTopics: true
    });

    const written = result.offsets?.[0];

    debug('Published %d bytes to %s', value.length, topic);

    return [null, null, {
      topic,
      partition: written ? written.partition : opts.partition ?? null,
      offset: written ? Number(written.offset) : null,
      key: key ?? null,
      headers,
      message
    }];
  } catch (error) {
    throw new Error(`Could not publish to ${topic}: ${reason(error)}`, { cause: error });
  } finally {
    await producer.close(true).catch(() => {});
  }
};
