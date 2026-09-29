/**
 * How an MQTT broker is reached, read off an application's environment.
 *
 * `mqttClient` publishes with it, and the `mqtt` latent application listens
 * with it when a flow says `connection: <application>` -- so a broker, and
 * the credentials to it, are written once, in the env file of the environment
 * they belong to, and never in a flow.
 */
import fs from 'fs';

/**
 * The connection options an env file describes: host, port, protocol,
 * credentials and TLS material. The client id is left to the caller -- a
 * publisher and a listener must never share one, or the broker would drop
 * one of them for the other.
 *
 * TLS material is read from disk here rather than passed as text, which is
 * what lets an env file name a certificate the way AWS IoT hands it out.
 *
 * @param {Object} env - The parsed env file.
 * @returns {Object} Options for `mqtt.connect`, without `clientId`.
 */
export const fromEnv = (env: Record<string, string> = {}): Record<string, any> => {
  const tls = env.MQTT_CERT || env.MQTT_KEY;
  const opts: Record<string, any> = {
    protocol: env.MQTT_PROTOCOL || (tls ? 'mqtts' : 'mqtt')
  };

  if (env.MQTT_HOST) { opts.host = env.MQTT_HOST; }
  if (env.MQTT_PORT) { opts.port = parseInt(env.MQTT_PORT, 10); }
  if (env.MQTT_USERNAME) { opts.username = env.MQTT_USERNAME; }
  if (env.MQTT_PASSWORD) { opts.password = env.MQTT_PASSWORD; }

  if (env.MQTT_KEY) { opts.key = fs.readFileSync(env.MQTT_KEY); }
  if (env.MQTT_CERT) { opts.cert = fs.readFileSync(env.MQTT_CERT); }
  if (env.MQTT_CA) { opts.ca = fs.readFileSync(env.MQTT_CA); }

  if (env.MQTT_REJECT_UNAUTHORIZED === 'false') { opts.rejectUnauthorized = false; }

  return opts;
};
