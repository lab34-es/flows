---
category: flows
order: 6
icon: radio
title: 'Latent applications (MQTT)'
summary: 'Assert on messages produced asynchronously, out of band.'
keywords:
  - 'mqtt'
  - 'async'
  - 'latent'
  - 'subscribe'
  - 'publish'
  - 'topic'
  - 'wildcard'
  - 'message'
  - 'events'
---

Some effects do not come back in the response: an HTTP call triggers a job that
eventually publishes an MQTT message. **Latent applications** let you assert on
those. *(Only MQTT is supported at the moment.)*

Declare the client in the flow's frontmatter, so it is connected and subscribed
before the flow starts:

    latentApplications:
      - application: "mqtt"
        client: "client1"
        connection:
          host: "1234567890-ats.iot.eu-west-1.amazonaws.com"
          port: 8883
          protocol: "mqtts"
          key: "/path/private.key"
          cert: "/path/cert.crt"
          ca: "/path/ca1.pem"
        subscribe:
          - topic: "client/1"

`username` and `password` are there for a broker that asks for them, and
`rejectUnauthorized: false` for one with a self-signed certificate.

Then assert on it from any step:

    test:
      latentApplications:
        - application: "mqtt"
          client: "client1"
          test:
            - topic: "client/1"
              message:
                status: "switched_to_on"
          retry:
            attempts: 1
            delay: 1

The step passes when every message listed under `test` has been seen since the
flow started. `retry` is what makes that workable: `attempts` says how many
times to look, `delay` how many **seconds** to wait between two looks.

### Which message counts as the one you meant

| | |
|-|-|
| **Only the keys you name** | The comparison is a subset, at any depth: name `hdf.cat` and everything else in the envelope is ignored. |
| **Expressions** | A value written as `"$expr: value.length > 0"` is a JavaScript expression over the actual value — the same as in a `body` assertion. Use it for a list whose order you do not control. |
| **Wildcards in the topic** | The expected topic is an MQTT filter: `+` stands for one level, `#` for the rest. `msg/cloud/+/command` matches whichever device answered. |
| **Memory in the topic** | Unlike the rest of a `test`, the topic *is* interpolated: `msg/cloud/{{ memory.device }}/command` reads the id a step above looked up. |
| **Anything, JSON or not** | A JSON payload arrives parsed; anything else arrives as text, so a device publishing a bare string can still be asserted on. |

### Keeping what arrived

A message often carries the only copy of something the rest of the flow needs —
an order a device created, the compartment it picked. A `memory` mapping on the
assertion keeps it:

    test:
      latentApplications:
        - application: "mqtt"
          client: "client1"
          test:
            - topic: "msg/cloud/{{ memory.device }}/command"
              message:
                hdf:
                  cat: "order-status"
              memory:
                orderId: "{{ message.bdy.0.id }}"
                compartmentId: "{{ message.bdy.0.cmp }}"
          retry:
            attempts: 30
            delay: 2

It follows the rules of a step's own `memory` block ([Passing data between
steps](/help/memory)) — a lone expression keeps its type, a key that resolves
to nothing is not written — and reads `message`
(the payload that matched) and `topic` (the one it came in on). Nothing is
written when the message never arrived.

### Publishing, from an application

Listening has a mirror: an application method can *publish*, which is how a
flow plays a device that is not there.

    import { applications, mqttClient } from '@lab34/flows';

    export const scan = applications.handler([
      (ctx, parameters) => mqttClient.publish(
        ctx,
        `msg/device/${parameters.body.device}/command`,
        { hdf: { cat: 'barcode' }, bdy: [{ bcd: parameters.body.barcode }] }
      )
    ], 'scan');

The broker comes from the application's environment — `MQTT_HOST`, and
optionally `MQTT_PORT`, `MQTT_PROTOCOL`, `MQTT_CLIENT_ID`, `MQTT_USERNAME`,
`MQTT_PASSWORD`, `MQTT_KEY`, `MQTT_CERT`, `MQTT_CA`,
`MQTT_REJECT_UNAUTHORIZED` and `MQTT_QOS` — so the same flow runs against a
local broker or a mutually authenticated one by swapping env files. The
message is published as JSON unless the method passes its own `encode`, and
the connection is closed again straight after.
