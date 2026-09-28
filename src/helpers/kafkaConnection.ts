/**
 * What `kafkaClient` and the `kafka` latent application share: the client
 * library, how a cluster is reached, and how its errors are put into words.
 *
 * Both describe a cluster the same way -- the helper reads it off an
 * application's environment, the latent application off the flow's
 * frontmatter -- so TLS and SASL are worked out once, here.
 */
import fs from 'fs';

import type { SASLOptions } from '@platformatic/kafka';

/** The client library, as its module exports it. */
export type KafkaLibrary = typeof import('@platformatic/kafka');

/**
 * The client library, loaded the first time a flow uses Kafka.
 *
 * It is not imported up front: loading it takes the better part of half a
 * second, and every run of the tool would pay that whether or not a single
 * flow in it went near a Kafka cluster. It is an ES module, which a `require`
 * loads synchronously on the Node this package supports.
 */
export const library = (): KafkaLibrary => require('@platformatic/kafka');

/**
 * Where a cluster is and how to get in.
 *
 * The frontmatter of a flow writes exactly this under a latent application's
 * `connection`; `kafkaClient` builds it out of the `KAFKA_*` variables.
 */
export interface ConnectionSettings {
  /** Bootstrap brokers, `host:port`: a list, or one comma-separated string. */
  brokers?: string | string[];
  /** What the cluster's logs and quotas know this client as. `ronsel`. */
  clientId?: string;
  /** Connect over TLS. Implied by any of the settings below it. */
  ssl?: boolean;
  /** Paths to the TLS material, for a cluster that checks client certificates. */
  ca?: string;
  cert?: string;
  key?: string;
  /** `false` to accept a broker certificate nobody signed. */
  rejectUnauthorized?: boolean;
  /** Credentials, for a cluster that asks for them. */
  sasl?: {
    /** `PLAIN`, `SCRAM-SHA-256` or `SCRAM-SHA-512`. `PLAIN` when omitted. */
    mechanism?: string;
    username?: string;
    password?: string;
  };
}

/** The part of the client options that says where the cluster is. */
export interface ConnectionOptions {
  clientId: string;
  bootstrapBrokers: string[];
  tls?: Record<string, any>;
  sasl?: SASLOptions;
}

/**
 * The client options for a cluster, out of the way a flow describes it.
 *
 * TLS material is read from disk here rather than passed as text, which is
 * what lets a file name a certificate the way a cluster's operators hand it
 * out.
 *
 * @param {ConnectionSettings} settings - Where the cluster is.
 * @returns {ConnectionOptions}
 * @throws {Error} When no broker is named.
 */
export const connectionOptions = (settings: ConnectionSettings = {}): ConnectionOptions => {
  const listed = Array.isArray(settings.brokers)
    ? settings.brokers
    : String(settings.brokers ?? '').split(',');

  const brokers = listed.map(broker => String(broker).trim()).filter(Boolean);

  if (!brokers.length) {
    throw new Error('No Kafka brokers configured: name at least one, as host:port');
  }

  const options: ConnectionOptions = {
    clientId: settings.clientId || 'ronsel',
    bootstrapBrokers: brokers
  };

  if (settings.ssl || settings.ca || settings.cert || settings.key || settings.rejectUnauthorized === false) {
    const tls: Record<string, any> = {};

    if (settings.ca) { tls.ca = fs.readFileSync(settings.ca); }
    if (settings.cert) { tls.cert = fs.readFileSync(settings.cert); }
    if (settings.key) { tls.key = fs.readFileSync(settings.key); }
    if (settings.rejectUnauthorized === false) { tls.rejectUnauthorized = false; }

    options.tls = tls;
  }

  const { sasl } = settings;

  if (sasl && (sasl.mechanism || sasl.username)) {
    options.sasl = {
      mechanism: String(sasl.mechanism || 'PLAIN').toUpperCase() as SASLOptions['mechanism'],
      username: sasl.username,
      password: sasl.password
    };
  }

  return options;
};

/**
 * The most specific thing an error has to say.
 *
 * The client wraps what went wrong in what it was doing at the time: a refused
 * connection surfaces as "metadata failed 4 times", and only three levels down
 * does it say which broker refused. That innermost message is the one worth
 * putting in front of somebody reading why their step failed; the whole chain
 * stays on the error as its `cause`.
 *
 * @param {*} error
 * @returns {string}
 */
export const reason = (error): string => {
  let current = error;

  for (let depth = 0; depth < 8; depth++) {
    const next = Array.isArray(current?.errors) && current.errors.length
      ? current.errors[0]
      : current?.cause;

    if (!next) { break; }
    current = next;
  }

  const message = current?.message || error?.message;
  return message ? String(message) : String(error);
};
