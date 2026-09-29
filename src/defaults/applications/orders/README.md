# orders

An order service and the payment provider it works with, talking over
[Kafka](https://kafka.apache.org). Every event goes through a real cluster, so
it needs one — on this machine, the quickest is Docker:

```bash
docker run -d --name kafka -p 9092:9092 apache/kafka:4.2.2
```

Topics are created the first time they are used, which is what a broker does
out of the box.

## What you can practice with it

- **An API call whose effect is an event** — `place` answers `201` like an
  HTTP API, and the order reaches the rest of the system as an `OrderPlaced`
  event. The example flow asserts on both.
- **Asserting by key and headers** — a Kafka *latent application* listens
  before the first step, and a step asserts that an event arrived on a topic,
  under the key of *its* order, with the headers it should carry.
- **Keeping what only an event carries** — the total is worked out by the
  service and travels only in the event; the flow remembers it from there.
- **Publishing from a flow** — `capturePayment` plays the payment provider,
  and `publish` sends anything at all, with `kafkaClient`.

Both services are played from here, so the example runs on its own. Against
a real system, the order service is what you are testing: call its API, and
assert on the event it should have published.

## Methods

| Method | Plays | What it publishes |
|-|-|-|
| `place` | the order service's API, answering `201` | `OrderPlaced` on `ronsel.examples.orders` |
| `capturePayment` | the payment provider | `PaymentCaptured` on `ronsel.examples.payments` |
| `publish` | anyone | any event, on any topic, with a key and headers |

Every event is keyed by its order id, so all the events of one order land on
the same partition, in order. See the **Methods** section in the UI (or the
JSDoc blocks of `index.ts`) for the full input / output reference.

## Environment

| Variable | Description | Example |
|-|-|-|
| `KAFKA_BROKERS` | Bootstrap brokers, comma separated | `localhost:9092` |

`kafkaClient` reads more — `KAFKA_CLIENT_ID`, `KAFKA_SSL`, `KAFKA_CA`,
`KAFKA_CERT`, `KAFKA_KEY`, `KAFKA_REJECT_UNAUTHORIZED`,
`KAFKA_SASL_MECHANISM`, `KAFKA_USERNAME`, `KAFKA_PASSWORD` — for a cluster
that asks for TLS or credentials, such as Confluent Cloud, Amazon MSK or
Aiven.

The example flow's listener reads these same variables (`connection:
orders`), plus `KAFKA_SCHEMA_REGISTRY_URL` (and `_USERNAME`, `_PASSWORD`) to
decode Avro messages — so a cluster is written in one place only, per
environment.

## The flow

`flows/examples/06-kafka-orders.md` runs all three, end to end.
