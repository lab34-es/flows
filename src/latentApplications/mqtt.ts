/**
 * The `mqtt` latent application: what a system says out of band, asserted on.
 *
 * A client declared in the flow's frontmatter is connected and subscribed
 * before the first step runs, and everything it hears is kept. A step then
 * asserts that a message arrived -- on which topic, with which content -- and
 * can keep values out of it in the flow memory, which is how an id that only
 * ever exists in an MQTT message reaches the steps below.
 */
import mqtt from 'mqtt';
import fs from 'fs';

import * as latent from '../helpers/latent';
import * as mqttConnection from '../helpers/mqttConnection';

const instances = {};

/**
 * The options to connect with: what the env file of the application named by
 * `connection` says, if it names one, and then whatever the flow wrote itself.
 *
 * The client id is always the listener's own `client`, never the env file's
 * `MQTT_CLIENT_ID`: that one belongs to the application publishing, and a
 * broker drops whichever of two clients with the same id connected first.
 */
const options = (details): Record<string, any> => {
  const { client: id, env } = details;
  const connection = typeof details.connection === 'object' && details.connection ? details.connection : {};
  const fromEnv = env ? mqttConnection.fromEnv(env) : {};

  const connectionOpts: Record<string, any> = {
    ...fromEnv,
    clientId: id,
    protocol: connection.protocol || fromEnv.protocol || 'mqtt'
  };

  if (connection.host) {connectionOpts.host = connection.host;}
  if (connection.port) {connectionOpts.port = connection.port;}
  if (connection.username) {connectionOpts.username = connection.username;}
  if (connection.password) {connectionOpts.password = connection.password;}
  if (connection.rejectUnauthorized === false) {connectionOpts.rejectUnauthorized = false;}

  if (connection.key) {connectionOpts.key = fs.readFileSync(connection.key);}
  if (connection.cert) {connectionOpts.cert = fs.readFileSync(connection.cert);}
  if (connection.ca) {connectionOpts.ca = fs.readFileSync(connection.ca);}

  return connectionOpts;
};

const connect = (flow, details) => {
  return new Promise((resolve, reject) => {
    const connectionOpts = options(details);

    if (!connectionOpts.host) {
      reject(new Error(
        `MQTT client '${details.client}' has no broker to connect to: ` +
        'name its host under "connection", or the application whose MQTT_HOST it uses'
      ));
      return;
    }

    const client = mqtt.connect(connectionOpts);

    client.on('connect', () => {
      resolve(client);
    });

    client.on('error', (err) => {
      console.log(`Error connecting to MQTT broker: ${err}`);
      reject(err);
    });

    return client;
  });
};

const start = (flow, details) => {
  const {
    client: id
  } = details;

  if (instances[id]) {
    return instances[id];
  }

  return connect(flow, details)
    .then(client => {
      instances[id] = {
        client,
        messages: []
      };
    })

    // Handle message reception
    .then(() => {
      instances[id].client.on('message', (topic, message) => {
        instances[id].messages.push({
          topic,
          message: latent.decode(message),
          date: new Date()
        });
      });
    })

    // Handle subscriptions
    .then(() => {
      const { subscribe } = details;
      if (subscribe) {
        const subscriptions = Array.isArray(subscribe) ? subscribe : [subscribe];
        const topics = subscriptions.map(sub => sub.topic);

        return Promise.all(topics.map(topic => {
          return new Promise<void>((resolve, reject) => {
            instances[id].client.subscribe(topic, (err) => {
              if (err) {
                console.log(`Error subscribing to topic: ${err}`);
                reject(err);
                return;
              }
              resolve();
            });
          });
        }));
      }
    });
};

const stop = (id) => {
  if (instances[id] && instances[id].client) {
    instances[id].client.end();
    delete instances[id];
  }
};

/**
 * Whether a received topic is the expected one.
 *
 * The expected topic is an MQTT filter, the same shape a subscription takes:
 * `+` stands for one level and `#` for the rest of them. A flow that does not
 * know the device id until it has run a step writes
 * `msg/cloud/+/command` -- or interpolates it, see `latent.interpolate`.
 */
const topicMatches = (expected: string, actual: string) => {
  if (expected === actual) {return true;}

  const expectedLevels = expected.split('/');
  const actualLevels = actual.split('/');

  for (let i = 0; i < expectedLevels.length; i++) {
    const level = expectedLevels[i];

    if (level === '#') {return true;}
    if (i >= actualLevels.length) {return false;}
    if (level === '+') {continue;}
    if (level !== actualLevels[i]) {return false;}
  }

  return expectedLevels.length === actualLevels.length;
};

const test = (flow, test, _contents) => {
  const { client: id, test: expectations, retry } = test;
  const instance = instances[id];

  if (!instance) {
    return Promise.reject(new Error(`MQTT client '${id}' does not exist or is not connected`));
  }

  return latent.check(flow, expectations, retry, (expected) => {
    // The expected topic, with what the flow already knows filled in -- see
    // `latent.interpolate` -- and then matched as the filter it may be
    const topic = latent.interpolate(expected.topic, flow);

    const found = instance.messages.find(m =>
      topicMatches(topic, m.topic) &&
      latent.matches(expected.message || {}, m.message, flow)
    );

    return found
      ? { found: true, scope: { topic: found.topic, message: found.message } }
      : { found: false, missing: { topic, message: expected.message } };
  }, 'mqtt');
};

export { start };
export { stop };
export { test };
