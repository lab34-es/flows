import mqtt from 'mqtt';

import { matches } from './topics';

/**
 * The little of MQTT this feature needs, behind one interface.
 *
 * The agent and the person's side both want the same four things: publish a
 * JSON document, subscribe a handler to a filter, know when the link drops,
 * and hang up. Wrapping mqtt.js here keeps those two modules free of packet
 * details, and lets the tests hand them an in-memory connection instead of a
 * broker.
 */

interface Message {
  topic: string;
  payload: Buffer;
  retain: boolean;
}

type Handler = (message: Message) => void;

interface PublishOptions {
  retain?: boolean;
}

interface Connection {
  /** Publish a document (objects are sent as JSON) at QoS 1 */
  publish(topic: string, payload: unknown, options?: PublishOptions): Promise<void>;
  /** Subscribe at QoS 1; the returned function unsubscribes the handler */
  subscribe(filter: string, handler: Handler): Promise<() => Promise<void>>;
  /** Called when the link drops, and again on every drop */
  onClose(listener: () => void): void;
  /** Called each time the link is back after a drop, subscriptions restored */
  onReconnect(listener: () => void): void;
  /** Hang up. The last will is not sent for a clean end */
  end(): Promise<void>;
}

interface Will {
  topic: string;
  payload: unknown;
  retain?: boolean;
}

interface ConnectOptions {
  url: string;
  username?: string;
  password?: string;
  clientId?: string;
  keepalive?: number;
  will?: Will;
}

const encode = (payload: unknown): Buffer | string => {
  if (Buffer.isBuffer(payload) || typeof payload === 'string') {
    return payload;
  }
  return JSON.stringify(payload);
};

/** Read a JSON payload, or null when it is not one. */
const decode = (payload: Buffer): any => {
  try {
    return JSON.parse(payload.toString('utf8'));
  }
  catch {
    return null;
  }
};

/**
 * Connect to a broker. Resolves once the broker accepted the connection and
 * rejects on the first error before that -- wrong password, unreachable
 * host. After that mqtt.js reconnects on its own and re-subscribes.
 *
 * @param {ConnectOptions} options
 * @param {Function} [factory] - mqtt.connect, replaceable by the tests
 * @returns {Promise<Connection>}
 */
const connect = (options: ConnectOptions, factory: typeof mqtt.connect = mqtt.connect): Promise<Connection> =>
  new Promise((resolve, reject) => {
    const client = factory(options.url, {
      username: options.username,
      password: options.password,
      clientId: options.clientId,
      keepalive: options.keepalive || 30,
      protocolVersion: 5,
      // A short window: the caller wants to know now whether the broker is
      // there, not after mqtt.js' default of thirty seconds
      connectTimeout: 10000,
      ...(options.will ? {
        will: {
          topic: options.will.topic,
          payload: Buffer.from(encode(options.will.payload)),
          qos: 1,
          retain: Boolean(options.will.retain)
        }
      } : {})
    });

    const handlers: Array<{ filter: string; handler: Handler }> = [];
    const closeListeners: Array<() => void> = [];
    const reconnectListeners: Array<() => void> = [];
    let connected = false;

    client.on('connect', () => {
      if (connected) {
        reconnectListeners.forEach(listener => listener());
      }
    });

    client.on('message', (topic, payload, packet) => {
      const message: Message = { topic, payload, retain: Boolean(packet && packet.retain) };
      handlers
        .filter(entry => matches(entry.filter, topic))
        .forEach(entry => {
          try {
            entry.handler(message);
          }
          catch (ex) {
            console.error(`Error handling ${topic}:`, ex);
          }
        });
    });

    client.on('close', () => {
      if (connected) {
        closeListeners.forEach(listener => listener());
      }
    });

    client.on('error', (error) => {
      if (!connected) {
        client.end(true);
        reject(new Error(`Could not connect to ${options.url}: ${error.message}`));
      }
      else {
        console.error(`Broker error: ${error.message}`);
      }
    });

    client.once('connect', () => {
      connected = true;

      resolve({
        publish: (topic, payload, publishOptions = {}) =>
          new Promise<void>((done, fail) => {
            client.publish(topic, encode(payload), { qos: 1, retain: Boolean(publishOptions.retain) }, (error) => {
              if (error) { fail(error); }
              else { done(); }
            });
          }),

        subscribe: (filter, handler) =>
          new Promise((done, fail) => {
            client.subscribe(filter, { qos: 1 }, (error, granted) => {
              if (error) {
                return fail(error);
              }

              // A broker that denies a filter says so with qos 128 rather
              // than an error; without this the caller would wait for ever
              const refused = (granted || []).find(grant => grant.qos > 2);
              if (refused) {
                return fail(new Error(`The broker refused the subscription to ${refused.topic}: check the ACL`));
              }

              const entry = { filter, handler };
              handlers.push(entry);

              done(async () => {
                const index = handlers.indexOf(entry);
                if (index !== -1) { handlers.splice(index, 1); }

                if (!handlers.some(other => other.filter === filter)) {
                  await new Promise<void>(resolved => client.unsubscribe(filter, () => resolved()));
                }
              });
            });
          }),

        onClose: (listener) => { closeListeners.push(listener); },

        onReconnect: (listener) => { reconnectListeners.push(listener); },

        end: () => new Promise<void>(done => { client.end(false, {}, () => done()); })
      });
    });
  });

export type { Connection, ConnectOptions, Handler, Message, PublishOptions, Will };
export { connect, decode, encode };
