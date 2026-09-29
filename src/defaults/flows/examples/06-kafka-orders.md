---
title: 06 · Kafka, publishing and listening
description: An API call whose effect is an event, asserted by key and headers, and events the flow publishes itself.
latentApplications:
  - application: kafka
    client: shop
    connection: orders
    subscribe:
      - topic: ronsel.examples.orders
      - topic: ronsel.examples.payments
---

# Kafka: publishing and listening

In an event-driven system, what an API call really did is often only visible
as an event: the order service answers `201`, and the rest of the company
learns about the order from `OrderPlaced`. This flow asserts on those.

It talks to a real Kafka cluster, so it needs one on this machine — the
quickest is Docker:

```bash
docker run -d --name kafka -p 9092:9092 apache/kafka:4.2.2
```

The `orders` application plays an order service *and* the payment provider
it works with, so the example runs on its own. Against a real system, the
order service is what you would be testing.

## Listening, before anything happens

The frontmatter of this document declares a **latent application**: a Kafka
consumer that joins the cluster before the first step runs, and keeps every
event published to its topics until the flow is over.

```yaml
latentApplications:
  - application: kafka
    client: shop
    connection: orders
    subscribe:
      - topic: ronsel.examples.orders
      - topic: ronsel.examples.payments
```

`connection: orders` says where the cluster is without saying it here: the
listener connects the way the `orders` application does, with the `KAFKA_*`
variables of its env file for the environment the flow runs against —
brokers, SASL credentials, TLS, and the schema registry that decodes Avro
messages. Add a `staging.env` to `orders` and this very flow runs against
staging, with no broker and no password ever written in it. A field written
here still wins: `connection: { application: orders, groupId: qa-ronsel }`.

Messages in Avro — the Confluent wire format — are decoded with the schema
the registry holds for them, when `KAFKA_SCHEMA_REGISTRY_URL` is set; JSON
and text are read as they are. Both can share a topic, and a step asserts on
either the same way.

It only ever sees what is published *after* the flow started — it is there
to observe what the steps cause, not to replay the topic's history. It
belongs to a consumer group of its own and commits nothing, so it takes no
event away from the services consuming the same topics for real.

## 1. Place an order

`place` answers like the order service's API would — `201` and the id of the
order — and announces the order with an `OrderPlaced` event. The step
asserts both: the response, and the event.

The event is found by its **key**, the id of *this* order, and by its
**headers**. The total is worked out by the service and travels only in the
event, so the assertion keeps it: a latent `memory` mapping reads the
`message` that matched, and also its `key`, `headers`, `partition`, `offset`
and `timestamp`.

```step
application: orders
method: place
description: Place an order, and see OrderPlaced announce it
parameters:
  body:
    customer: "{{ randomName }}"
    lines:
      - sku: COFFEE-250G
        qty: 2
      - sku: MUG
        qty: 1
memory:
  orderId: "{{ body.orderId }}"
test:
  status: 201
  latentApplications:
    - application: kafka
      client: shop
      test:
        - topic: ronsel.examples.orders
          key: "{{ memory.orderId }}"
          headers:
            event-type: OrderPlaced
          message:
            total: 29
            lines: "$expr: value.length === 2 && value.every(line => line.price > 0)"
          memory:
            orderTotal: "{{ message.total }}"
            orderPartition: "{{ partition }}"
      retry:
        attempts: 10
        delay: 1
```

Two things worth noticing:

- The key is **interpolated**: `{{ memory.orderId }}` is the id this very
  step was given back. Unlike the rest of a `test`, `topic` and `key` are
  resolved against the memory, so the flow waits for its own order and
  nobody else's.
- `message` names only what the step cares about. The event carries the
  customer, the currency and a price per line, and none of it has to be
  spelled out.

## 2. The payment provider answers

Now the flow plays the payment provider: it publishes `PaymentCaptured` for
the order, for the total the order service worked out. The step asserts on
what it published — `body` is the event and where it landed — and on the
event arriving, compared with an expression over the memory.

```step
application: orders
method: capturePayment
description: Capture the order's total, and see the payment land on its key
parameters:
  body:
    orderId: "{{ memory.orderId }}"
    amount: "{{ memory.orderTotal }}"
memory:
  paymentId: "{{ body.message.paymentId }}"
test:
  body:
    key: "$expr: value === memory.orderId"
    partition: "$expr: Number.isInteger(value)"
  latentApplications:
    - application: kafka
      client: shop
      test:
        - topic: ronsel.examples.payments
          key: "{{ memory.orderId }}"
          message:
            amount: "$expr: value === memory.orderTotal"
            paymentId: "$expr: value === memory.paymentId"
      retry:
        attempts: 10
        delay: 1
```

`retry` is what makes asserting on something asynchronous workable:
`attempts` says how many times to look, `delay` how many **seconds** to wait
between two looks. The step passes as soon as every event it lists has
arrived.

## 3. Anything, anywhere

`publish` sends any event to any topic, with a key and headers — the method
to copy into an application of your own, since an event published from a
flow is one line of `kafkaClient.publish`:

```step
application: orders
method: publish
description: Ship the order
parameters:
  body:
    topic: ronsel.examples.orders
    key: "{{ memory.orderId }}"
    headers:
      event-type: OrderShipped
    message:
      orderId: "{{ memory.orderId }}"
      carrier: DHL
test:
  body:
    partition: "$expr: value === memory.orderPartition"
  latentApplications:
    - application: kafka
      client: shop
      test:
        - topic: ronsel.examples.orders
          key: "{{ memory.orderId }}"
          headers:
            event-type: OrderShipped
          message:
            carrier: DHL
      retry:
        attempts: 10
        delay: 1
```

The shipment was published under the order's key, so it landed on the same
partition as `OrderPlaced` — step 1 kept that partition, and this step
checks it. That is what lets a consumer of the topic trust that a shipment
never overtakes the order it ships: within a partition, events arrive in the
order they were published. `kafkaClient` hashes keys exactly as the Java
client does, so an event a flow publishes keeps its place in line with the
ones the real services publish.

## Where to go next

- Add a line with `sku: TEA` in step 1: the service answers `400`, publishes
  nothing, and the step fails on both counts.
- Open `applications/orders/index.ts`: every event is one call to
  `kafkaClient.publish`, which reads the cluster from `env/local.env`.
- **05 · MQTT** does the same with a device and its cloud.
