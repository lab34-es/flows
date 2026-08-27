---
category: writing
order: 7
icon: radio
title: 'Latent applications (MQTT)'
summary: 'Assert on messages produced asynchronously, out of band.'
keywords:
  - 'mqtt'
  - 'async'
  - 'latent'
  - 'subscribe'
  - 'topic'
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
          key: "/path/private.key"
          cert: "/path/cert.crt"
          ca: "/path/ca1.pem"
        subscribe:
          - topic: "client/1"

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
