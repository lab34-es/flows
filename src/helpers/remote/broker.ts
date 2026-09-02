import fs from 'fs';
import { randomUUID } from 'crypto';
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
  /** Paths of PEM files, for a broker that authenticates with a certificate */
  tls?: { cert?: string; key?: string; ca?: string };
  /** ALPN protocols to offer, for a broker that multiplexes MQTT on 443 */
  alpn?: string[];
  /**
   * Split a message larger than this many bytes into several packets and put
   * them back together on the other side. For brokers that cap the packet
   * size -- AWS IoT Core stops at 128 KB, and a run's results can be more.
   */
  maxPacketSize?: number;
}

/**
 * One piece of a message that did not fit in a packet. A chunked message is
 * a run of these on the same topic, same id, in order; the receiving side
 * hands the handler the whole message once the last one is in.
 */
interface Chunk {
  __chunk: 1;
  id: string;
  index: number;
  total: number;
  /** base64 of this slice */
  data: string;
}

/** Chunks never take longer than this to arrive; after it the rest is dropped. */
const CHUNK_TTL_MS = 5 * 60 * 1000;

const isChunk = (value: any): value is Chunk =>
  Boolean(value) && value.__chunk === 1 && typeof value.id === 'string'
  && Number.isInteger(value.index) && Number.isInteger(value.total) && typeof value.data === 'string';

/**
 * Cut a payload into chunks whose JSON stays under the packet limit.
 * @param {Buffer} payload
 * @param {number} maxPacketSize
 * @returns {Chunk[]}
 */
const split = (payload: Buffer, maxPacketSize: number): Chunk[] => {
  // The envelope is ~120 bytes and base64 grows the data by a third
  const sliceSize = Math.max(256, Math.floor((maxPacketSize - 256) * 3 / 4));
  const total = Math.ceil(payload.length / sliceSize);
  const id = randomUUID();

  return Array.from({ length: total }, (_, index) => ({
    __chunk: 1 as const,
    id,
    index,
    total,
    data: payload.subarray(index * sliceSize, (index + 1) * sliceSize).toString('base64')
  }));
};

/** Puts chunked messages back together, per topic and id. */
const reassembler = () => {
  const pending = new Map<string, { parts: Array<string | undefined>; received: number; since: number }>();

  const sweep = () => {
    const now = Date.now();
    for (const [key, entry] of pending.entries()) {
      if (now - entry.since > CHUNK_TTL_MS) { pending.delete(key); }
    }
  };

  /**
   * @returns {Buffer|null} The whole message once complete, null while waiting
   */
  return (topic: string, chunk: Chunk): Buffer | null => {
    sweep();

    const key = `${topic}\u0000${chunk.id}`;
    const entry = pending.get(key) || { parts: new Array(chunk.total).fill(undefined), received: 0, since: Date.now() };

    if (chunk.index < 0 || chunk.index >= chunk.total || chunk.total !== entry.parts.length) {
      pending.delete(key);
      return null;
    }

    if (entry.parts[chunk.index] === undefined) {
      entry.parts[chunk.index] = chunk.data;
      entry.received += 1;
    }
    pending.set(key, entry);

    if (entry.received < chunk.total) {
      return null;
    }

    pending.delete(key);
    return Buffer.concat(entry.parts.map(part => Buffer.from(part as string, 'base64')));
  };
};

/** The tls options mqtt.js passes to tls.connect, read from the files named. */
const tlsOptions = (options: ConnectOptions) => {
  const result: Record<string, any> = {};

  const read = (field: 'cert' | 'key' | 'ca') => {
    const file = options.tls && options.tls[field];
    if (!file) { return; }
    try {
      result[field] = fs.readFileSync(file);
    }
    catch (ex) {
      throw new Error(`Could not read the ${field} file ${file}: ${ex.message}`, { cause: ex });
    }
  };

  read('cert');
  read('key');
  read('ca');

  if (options.alpn && options.alpn.length) {
    result.ALPNProtocols = options.alpn;
  }

  return result;
};

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
    let tls: Record<string, any>;
    try {
      tls = tlsOptions(options);
    }
    catch (ex) {
      return reject(ex);
    }

    const client = factory(options.url, {
      username: options.username,
      password: options.password,
      clientId: options.clientId,
      keepalive: options.keepalive || 30,
      protocolVersion: 5,
      // A short window: the caller wants to know now whether the broker is
      // there, not after mqtt.js' default of thirty seconds
      connectTimeout: 10000,
      ...tls,
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
    const reassemble = reassembler();
    let connected = false;

    const dispatch = (message: Message) => {
      handlers
        .filter(entry => matches(entry.filter, message.topic))
        .forEach(entry => {
          try {
            entry.handler(message);
          }
          catch (ex) {
            console.error(`Error handling ${message.topic}:`, ex);
          }
        });
    };

    client.on('connect', () => {
      if (connected) {
        reconnectListeners.forEach(listener => listener());
      }
    });

    client.on('message', (topic, payload, packet) => {
      const retain = Boolean(packet && packet.retain);

      // A chunk is put aside until its siblings arrive; anything else is
      // delivered as it came. Chunks are only ever looked for when the
      // payload could be one, so ordinary messages cost nothing extra
      if (payload.length > 0 && payload[0] === 0x7b) {
        const parsed = decode(payload);
        if (isChunk(parsed)) {
          const whole = reassemble(topic, parsed);
          if (whole) {
            dispatch({ topic, payload: whole, retain });
          }
          return;
        }
      }

      dispatch({ topic, payload, retain });
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
        publish: async (topic, payload, publishOptions = {}) => {
          const send = (body: Buffer | string) =>
            new Promise<void>((done, fail) => {
              client.publish(topic, body, { qos: 1, retain: Boolean(publishOptions.retain) }, (error) => {
                if (error) { fail(error); }
                else { done(); }
              });
            });

          const encoded = encode(payload);
          const bytes = Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded, 'utf8');

          if (!options.maxPacketSize || bytes.length <= options.maxPacketSize) {
            return send(encoded);
          }

          // Retained chunks would leave the broker holding half a message
          if (publishOptions.retain) {
            throw new Error(`A retained message cannot exceed ${options.maxPacketSize} bytes on this broker`);
          }

          for (const chunk of split(bytes, options.maxPacketSize)) {
            await send(JSON.stringify(chunk));
          }
        },

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

export type { Chunk, Connection, ConnectOptions, Handler, Message, PublishOptions, Will };
export { connect, decode, encode, split, isChunk, reassembler };
