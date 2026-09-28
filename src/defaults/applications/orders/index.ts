/**
 * An order service and the payment provider it works with, over Kafka.
 *
 * Every event goes through a real Kafka cluster -- a broker on this machine,
 * by default (see `env/local.env`) -- so the flow in
 * `flows/examples/06-kafka-orders.md` exercises exactly what a flow against
 * real services would: an API call whose effect is an event, listened for and
 * asserted on by key and headers, and an event the flow publishes itself.
 *
 * Both services are played from here, so the example runs on its own. Against
 * a real system, the order service is the one you are testing: call its API,
 * and assert on the event it should have published.
 *
 * | Topic | Event | Key | Published by |
 * |-|-|-|-|
 * | `ronsel.examples.orders` | `OrderPlaced` | the order id | `place`, as the order service |
 * | `ronsel.examples.payments` | `PaymentCaptured` | the order id | `capturePayment`, as the payment provider |
 */
import { randomUUID } from 'crypto';

import { applications, kafkaClient } from 'ronsel';
import type { Context, Parameters } from 'ronsel';

const ORDERS = 'ronsel.examples.orders';
const PAYMENTS = 'ronsel.examples.payments';

/** What the demo shop sells, and for how much, in euros. */
const CATALOGUE: Record<string, number> = {
  'COFFEE-250G': 8.5,
  MUG: 12,
  GRINDER: 49
};

const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

/**
 * Places an order, as the order service's API would.
 *
 * It answers `201` with the id of the new order and announces it to the rest
 * of the system with an `OrderPlaced` event on `ronsel.examples.orders`, keyed
 * by that id. The total is worked out by the service and travels only in the
 * event -- keep it with a `memory` mapping on the latent assertion, as the
 * example flow does.
 *
 * @param {string} body.customer - Who is ordering.
 * @param {object[]} body.lines - What: `{ sku, qty }`, where `sku` is
 *   `COFFEE-250G` (8.50 €), `MUG` (12 €) or `GRINDER` (49 €).
 * @returns {201 | 400} `201` once the order is placed and `OrderPlaced` is on
 *   its way; `400` without lines, or with a line the shop does not sell.
 * ```json
 * { "orderId": "ord-1a2b3c4d", "status": "placed" }
 * ```
 * @example
 * application: orders
 * method: place
 * parameters:
 *   body:
 *     customer: "{{ randomName }}"
 *     lines:
 *       - sku: COFFEE-250G
 *         qty: 2
 * memory:
 *   orderId: "{{ body.orderId }}"
 * test:
 *   status: 201
 */
export const place = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { customer, lines } = (parameters || {}).body || {};

    const items: any[] = Array.isArray(lines) ? lines : [];
    const unknown = items.filter(line => !Object.hasOwn(CATALOGUE, String(line?.sku)));

    if (!items.length || unknown.length) {
      return [{}, 400, {
        error: {
          code: 'INVALID_LINES',
          message: unknown.length
            ? `The shop does not sell ${unknown.map(line => JSON.stringify(line?.sku)).join(', ')}`
            : 'An order needs at least one line'
        }
      }];
    }

    const orderId = id('ord');
    const priced = items.map(line => ({
      sku: line.sku,
      qty: Number(line.qty) || 1,
      price: CATALOGUE[line.sku]
    }));
    const total = Math.round(priced.reduce((sum, line) => sum + line.qty * line.price, 0) * 100) / 100;

    await kafkaClient.publish(ctx, ORDERS, {
      orderId,
      customer,
      lines: priced,
      total,
      currency: 'EUR'
    }, {
      key: orderId,
      headers: { 'event-type': 'OrderPlaced', source: 'order-service' }
    });

    return [{}, 201, { orderId, status: 'placed' }];
  }
], 'place');

/**
 * Announces that the payment for an order was captured, as the payment
 * provider would.
 *
 * This is the flow playing a service that is not there: `PaymentCaptured`
 * goes out on `ronsel.examples.payments`, keyed by the order it pays for, just
 * as the order service would receive it from the real provider.
 *
 * @param {string} body.orderId - The order being paid.
 * @param {number} body.amount - How much was captured, in euros.
 * @returns {null} What was published, and where it landed: the partition and
 *   offset come from the cluster.
 * ```json
 * {
 *   "topic": "ronsel.examples.payments",
 *   "partition": 0,
 *   "offset": 12,
 *   "key": "ord-1a2b3c4d",
 *   "headers": { "event-type": "PaymentCaptured", "source": "payment-provider" },
 *   "message": { "orderId": "ord-1a2b3c4d", "paymentId": "pay-5e6f7a8b", "amount": 29, "currency": "EUR" }
 * }
 * ```
 * @example
 * application: orders
 * method: capturePayment
 * parameters:
 *   body:
 *     orderId: "{{ memory.orderId }}"
 *     amount: "{{ memory.orderTotal }}"
 */
export const capturePayment = applications.handler([
  (ctx: Context, parameters: Parameters) => {
    const { orderId, amount } = (parameters || {}).body || {};

    return kafkaClient.publish(ctx, PAYMENTS, {
      orderId,
      paymentId: id('pay'),
      amount: Number(amount),
      currency: 'EUR'
    }, {
      key: orderId,
      headers: { 'event-type': 'PaymentCaptured', source: 'payment-provider' }
    });
  }
], 'capturePayment');

/**
 * Publishes any event, on any topic, to the application's cluster.
 *
 * The two methods above are what this example is about; this one is for
 * everything they do not model -- and it is the method to copy into an
 * application of your own, since an event published from a flow is one line
 * of `kafkaClient.publish`.
 *
 * @param {string} body.topic - Where to publish.
 * @param {string} [body.key] - The key, which decides the partition.
 * @param {object} [body.headers] - Headers, as `name: value` text.
 * @param {any} body.message - The value: published as JSON.
 * @returns {null} What was published, and where it landed.
 * ```json
 * { "topic": "ronsel.examples.orders", "partition": 1, "offset": 7, "key": "ord-1a2b3c4d", "headers": { "event-type": "OrderShipped" }, "message": { "carrier": "DHL" } }
 * ```
 * @example
 * application: orders
 * method: publish
 * parameters:
 *   body:
 *     topic: ronsel.examples.orders
 *     key: "{{ memory.orderId }}"
 *     headers:
 *       event-type: OrderShipped
 *     message:
 *       carrier: DHL
 */
export const publish = applications.handler([
  (ctx: Context, parameters: Parameters) => {
    const { topic, key, headers, message } = (parameters || {}).body || {};
    return kafkaClient.publish(ctx, topic, message, { key, headers });
  }
], 'publish');
