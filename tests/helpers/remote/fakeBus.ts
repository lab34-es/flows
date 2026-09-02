import type { Connection, ConnectOptions, Handler, Message } from '../../../src/helpers/remote/broker';
import { encode } from '../../../src/helpers/remote/broker';
import { matches } from '../../../src/helpers/remote/topics';

/**
 * An in-memory broker for the tests: retained messages, wildcard filters and
 * last wills, delivered synchronously to every connection on the bus.
 */
interface FakeConnection extends Connection {
  name: string;
  will?: ConnectOptions['will'];
  /** Everything this connection published, in order */
  published: Array<{ topic: string; payload: any; retain: boolean }>;
  /** Vanish without a clean end: the bus publishes the will */
  drop: () => void;
  /** The link is back */
  reconnect: () => void;
  closed: boolean;
}

const createBus = () => {
  const retained = new Map<string, Buffer>();
  const connections: FakeConnection[] = [];
  const log: Array<{ from: string; topic: string; payload: any; retain: boolean }> = [];

  const deliver = (topic: string, payload: Buffer, retain: boolean) => {
    if (retain) {
      retained.set(topic, payload);
    }
    connections
      .filter(connection => !connection.closed)
      .forEach(connection => {
        (connection as any).handlers
          .filter(entry => matches(entry.filter, topic))
          .forEach(entry => entry.handler({ topic, payload, retain: false } as Message));
      });
  };

  const connect = async (options: ConnectOptions | string): Promise<FakeConnection> => {
    const name = typeof options === 'string' ? options : (options.clientId || options.username || 'anonymous');
    const will = typeof options === 'string' ? undefined : options.will;

    const handlers: Array<{ filter: string; handler: Handler }> = [];
    const closeListeners: Array<() => void> = [];
    const reconnectListeners: Array<() => void> = [];

    const connection: FakeConnection = {
      name,
      will,
      published: [],
      closed: false,

      publish: async (topic, payload, publishOptions = {}) => {
        const buffer = Buffer.from(encode(payload));
        connection.published.push({ topic, payload, retain: Boolean(publishOptions.retain) });
        log.push({ from: name, topic, payload, retain: Boolean(publishOptions.retain) });
        deliver(topic, buffer, Boolean(publishOptions.retain));
      },

      subscribe: async (filter, handler) => {
        const entry = { filter, handler };
        handlers.push(entry);

        // What the broker kept for late subscribers
        for (const [topic, payload] of retained.entries()) {
          if (matches(filter, topic)) {
            handler({ topic, payload, retain: true });
          }
        }

        return async () => {
          const index = handlers.indexOf(entry);
          if (index !== -1) { handlers.splice(index, 1); }
        };
      },

      onClose: (listener) => { closeListeners.push(listener); },
      onReconnect: (listener) => { reconnectListeners.push(listener); },

      end: async () => { connection.closed = true; },

      drop: () => {
        connection.closed = true;
        closeListeners.forEach(listener => listener());
        if (will) {
          deliver(will.topic, Buffer.from(encode(will.payload)), Boolean(will.retain));
        }
      },

      reconnect: () => {
        connection.closed = false;
        reconnectListeners.forEach(listener => listener());
      }
    };

    (connection as any).handlers = handlers;
    connections.push(connection);
    return connection;
  };

  return { connect, retained, log, connections };
};

/** Let every promise chain in flight settle. */
const flush = async (rounds = 5) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
};

export type { FakeConnection };
export { createBus, flush };
