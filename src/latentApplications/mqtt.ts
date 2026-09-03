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

import * as memory from '../helpers/memory';

const instances = {};

const connect = (flow, details) => {
  return new Promise((resolve, reject) => {
    const { client: id, connection } = details;

    const connectionOpts: Record<string, any> = {
      host: connection.host,
      clientId: id,
      protocol: connection.protocol || 'mqtt'
    };

    if (connection.port) {connectionOpts.port = connection.port;}
    if (connection.username) {connectionOpts.username = connection.username;}
    if (connection.password) {connectionOpts.password = connection.password;}
    if (connection.rejectUnauthorized === false) {connectionOpts.rejectUnauthorized = false;}

    if (connection.key) {connectionOpts.key = fs.readFileSync(connection.key);}
    if (connection.cert) {connectionOpts.cert = fs.readFileSync(connection.cert);}
    if (connection.ca) {connectionOpts.ca = fs.readFileSync(connection.ca);}

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

/**
 * What arrived, as something a test can look into.
 *
 * A payload that is not JSON is kept as text rather than thrown away: a
 * broker carrying MessagePack, or a device publishing a bare string, would
 * otherwise take the whole run down from inside an event handler, where
 * nothing can catch it.
 */
const decode = (payload) => {
  const text = payload.toString();

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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
          message: decode(message),
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
 * `msg/cloud/+/command` -- or interpolates it, see `resolveTopic`.
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

/**
 * The expected topic, with what the flow already knows filled in.
 *
 * A device id is looked up by a step; the topic it publishes on is only known
 * once that step has run. `msg/cloud/{{ memory.device }}/command` is
 * therefore resolved against the memory as it stands when the assertion is
 * made -- unlike a `test` body, which is compared literally.
 */
const resolveTopic = (topic: string, flow) => {
  if (typeof topic !== 'string' || !topic.includes('{{')) {return topic;}

  return topic.replace(
    /\{\{\{?\s*([A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*)\s*\}?\}\}/g,
    (whole, path) => {
      const value = memory.at({ memory: flow?.memory || {} }, path);
      return value === undefined || value === null ? whole : String(value);
    }
  );
};

/**
 * Whether a received message says what the test expected of it.
 *
 * Only the keys the test names are looked at, at any depth, so a test states
 * the two fields it cares about rather than the whole envelope a device
 * sends. A `$expr:` value is a JavaScript expression over the actual value,
 * exactly as in a step's `body` assertion -- which is how a list is asserted
 * on without pinning the order its items arrived in. `memory` is in scope
 * there too, so a message can be matched against what an earlier step
 * remembered -- `$expr: value.some(b => b.bcd === memory.barcode)`.
 */
const messageMatches = (expected, actual, flow?) => {
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
    return expected.every((item, index) => messageMatches(item, actual[index], flow));
  }

  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') {return false;}
    return Object.keys(expected).every(key => messageMatches(expected[key], actual[key], flow));
  }

  return expected === actual;
};

const test = (flow, test, _contents) => {
  return new Promise((resolve, reject) => {
    const { client: id, test: testMessages, retry } = test;

    // Verify client exists
    if (!instances[id]) {
      return reject(new Error(`MQTT client '${id}' does not exist or is not connected`));
    }

    const clientInstance = instances[id];
    const messages = clientInstance.messages;

    // Function to validate if all test messages have been received
    const validateMessages = () => {
      const results: Record<string, any> = {
        success: true,
        matched: [],
        notMatched: []
      };

      // Check each test message
      testMessages.forEach((testMsg) => {
        const { topic, message } = testMsg;
        const expectedTopic = resolveTopic(topic, flow);

        // Find matching message in received messages
        const foundMessage = messages.find(m =>
          topicMatches(expectedTopic, m.topic) &&
          messageMatches(message || {}, m.message, flow)
        );

        if (foundMessage) {
          results.matched.push({
            topic: foundMessage.topic,
            message,
            receivedAt: foundMessage.date
          });

          // What the flow wants to keep out of the message that arrived. The
          // scope is the message itself, so a value that exists nowhere else
          // -- an order created by a device -- reaches the steps below.
          if (testMsg.memory && flow) {
            flow.memory = Object.assign(
              flow.memory || {},
              memory.resolve(testMsg.memory, {
                topic: foundMessage.topic,
                message: foundMessage.message,
                memory: flow.memory || {}
              }, 'Latent memory')
            );
          }
        } else {
          results.notMatched.push({ topic: expectedTopic, message });
          results.success = false;
        }
      });

      return results;
    };

    // Handle retries if specified
    let attempts = 0;
    const maxAttempts = retry?.attempts || 1;
    const delay = retry?.delay || 0;

    const attemptValidation = () => {
      attempts++;
      const results = validateMessages();

      if (results.success || attempts >= maxAttempts) {
        results.attempts = attempts;
        // resolve(results);
        resolve(results.notMatched);
      } else {
        setTimeout(attemptValidation, delay * 1000);
      }
    };

    // Start validation process
    attemptValidation();
  });
};

export { start };
export { stop };
export { test };
