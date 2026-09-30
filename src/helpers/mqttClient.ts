/**
 * Publishing to an MQTT broker from an application.
 *
 * The mirror of the `mqtt` latent application: that one *listens* for what a
 * system says out of band, this one *speaks* -- it is how a flow plays a
 * device that is not there, a device that scans a barcode or a sensor that
 * reports a door.
 *
 * Connection details come from the application's environment, so a method
 * takes nothing but the topic and the message, and the same flow runs against
 * a local broker or a mutually authenticated one by swapping env files.
 *
 * | Variable | What it is |
 * | --- | --- |
 * | `MQTT_HOST` | Broker host. Required. |
 * | `MQTT_PORT` | Broker port. The protocol's default when omitted. |
 * | `MQTT_PROTOCOL` | `mqtt`, `mqtts`, `ws`, `wss`. `mqtts` when a certificate is configured, `mqtt` otherwise. |
 * | `MQTT_CLIENT_ID` | Client id to connect as. A random one when omitted. |
 * | `MQTT_USERNAME`, `MQTT_PASSWORD` | Credentials, when the broker asks for them. |
 * | `MQTT_KEY`, `MQTT_CERT`, `MQTT_CA` | Paths to the TLS material, for a mutually authenticated broker such as AWS IoT. |
 * | `MQTT_REJECT_UNAUTHORIZED` | `false` to accept a self-signed broker certificate. |
 * | `MQTT_QOS` | Quality of service of the publish. `1` when omitted. |
 *
 * The connection is opened for the publish and closed again after it: a flow
 * publishes a handful of messages over a run, and a socket left open would
 * hold the process after the last step.
 */
import mqtt from 'mqtt';
import createDebug from 'debug';
import { v4 as uuidv4 } from 'uuid';

import { fromEnv } from './mqttConnection';

const debug = createDebug('ronsel:helpers:mqttClient');

/** What `publish` accepts beyond the topic and the message. */
export interface PublishOptions {
  /** Quality of service. `MQTT_QOS`, then `1`. */
  qos?: 0 | 1 | 2;
  /** Whether the broker keeps the message for later subscribers. `false`. */
  retain?: boolean;
  /**
   * How the message becomes bytes. JSON when omitted -- give an encoder to
   * speak a binary dialect (MessagePack, protobuf) without this helper taking
   * a dependency on it.
   */
  encode?: (message: any) => string | Buffer;
}

/**
 * The connection options, read off the application's environment -- see
 * `mqttConnection` -- as a client of its own.
 */
const options = (ctx): mqtt.IClientOptions => {
  const env = ctx.env || {};

  if (!env.MQTT_HOST) {
    throw new Error('MQTT_HOST is not set: the application has no broker to publish to');
  }

  return {
    ...fromEnv(env),
    clientId: env.MQTT_CLIENT_ID || `ronsel-${uuidv4()}`
  } as mqtt.IClientOptions;
};

/**
 * Publishes one message and disconnects.
 *
 * @param {Object} ctx - The application context, for its `env`.
 * @param {string} topic - Topic to publish on.
 * @param {any} message - The message. Encoded as JSON unless `options.encode` says otherwise.
 * @param {PublishOptions} [opts] - Quality of service, retention, encoding.
 * @returns {Promise<[null, null, Object]>} The `[headers, status, body]` tuple
 *   an application answers with, whose body is what was published -- so a step
 *   can assert on the message it sent, and remember an id it generated.
 * @throws {Error} When the broker cannot be reached, or refuses the publish.
 */
export const publish = (
  ctx,
  topic: string,
  message: any,
  opts: PublishOptions = {}
): Promise<[null, null, Record<string, any>]> => {
  return new Promise((resolve, reject) => {
    // Inside the promise, so a misconfigured environment reaches the step as
    // a rejection like every other failure here rather than as a throw the
    // caller has to catch differently.
    const connectionOptions = options(ctx);
    const qos = (opts.qos ?? (ctx.env?.MQTT_QOS ? parseInt(ctx.env.MQTT_QOS, 10) : 1)) as 0 | 1 | 2;
    const payload = opts.encode ? opts.encode(message) : JSON.stringify(message);

    debug('Publishing to %s on %s as %s', topic, connectionOptions.host, connectionOptions.clientId);

    const client = mqtt.connect(connectionOptions);

    // A broker that never answers would otherwise hang the flow for as long
    // as the run lasts, with nothing on screen to say why.
    let settled = false;
    const done = (err?: Error, body?: Record<string, any>) => {
      if (settled) { return; }
      settled = true;
      client.end(true);
      if (err) { reject(err); } else { resolve([null, null, body as Record<string, any>]); }
    };

    client.on('error', (err) => {
      debug('MQTT error: %s', err.message);
      done(new Error(`Could not publish to ${topic}: ${err.message}`));
    });

    client.on('connect', () => {
      client.publish(topic, payload as any, { qos, retain: opts.retain === true }, (err) => {
        if (err) {
          done(new Error(`Could not publish to ${topic}: ${err.message}`));
          return;
        }

        debug('Published %d bytes to %s', payload.length, topic);
        done(undefined, { topic, qos, message });
      });
    });
  });
};
