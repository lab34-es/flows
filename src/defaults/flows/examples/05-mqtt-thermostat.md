---
title: 05 · MQTT, publishing and listening
description: Publish as a device, assert on what arrives out of band, and keep ids that only travel in messages.
latentApplications:
  - application: mqtt
    client: thermostats
    connection: thermostat
    subscribe:
      - topic: ronsel/examples/thermostats/#
---

# MQTT: publishing and listening

Some effects never come back in a response: an API call answers `202` and
the real work reaches a device later, as an MQTT message. This flow asserts
on those.

It talks to a real MQTT broker, so it needs one on this machine — the
quickest is Docker:

```bash
docker run -d --name mosquitto -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
```

The `thermostat` application plays a smart thermostat *and* the cloud
service that runs it, so the example runs on its own. Against a real system,
one of the two sides is what you are testing.

## Listening, before anything happens

The frontmatter of this document declares a **latent application**: an MQTT
client that connects and subscribes before the first step runs, and keeps
everything it hears until the flow is over.

```yaml
latentApplications:
  - application: mqtt
    client: thermostats
    connection: thermostat
    subscribe:
      - topic: ronsel/examples/thermostats/#
```

`#` stands for every level below it: every device, every channel.

`connection: thermostat` says where the broker is without saying it here: the
listener connects the way the `thermostat` application does, with the
`MQTT_*` variables of its env file for the environment the flow runs
against. Point `local.env` at your laptop's broker and a `staging.env` at the
real one, credentials included, and this very flow runs against either — no
host and no password ever written in it. A field written here still wins:
`connection: { application: thermostat, port: 1884 }`.

## 1. The cloud sends a command

`setTarget` answers like the cloud's API would — `202`, queued — and the
command itself goes to the device over MQTT. The step asserts both: the
response, and that the command reached the topic of *this* device.

The id of the command exists nowhere but in that message, so the assertion
keeps it — the `memory` mapping of a latent assertion reads the `message`
that matched, and the `topic` it came in on.

```step
application: thermostat
method: setTarget
description: Ask the cloud for 21 °C, and see the command reach the device
parameters:
  body:
    deviceId: "{{ uuid }}"
    target: 21
memory:
  deviceId: "{{ body.deviceId }}"
test:
  status: 202
  latentApplications:
    - application: mqtt
      client: thermostats
      test:
        - topic: "ronsel/examples/thermostats/{{ memory.deviceId }}/commands"
          message:
            command: set-target
            target: 21
          memory:
            commandId: "{{ message.commandId }}"
      retry:
        attempts: 10
        delay: 1
```

Two things worth noticing:

- The topic is **interpolated**: `{{ memory.deviceId }}` is the id this very
  step generated. Unlike the rest of a `test`, a topic is resolved against
  the memory, so a flow listens for its own device and nobody else's.
- `message` names only what the step cares about. The command carries more
  — its id, above all — and none of it has to be spelled out.

## 2. The device answers

Now the flow plays the device: it reports the temperature it reached, and
acknowledges the command by carrying its id in `ack`. The assertion uses a
**wildcard** — `+` stands for one level, any device — and pins the right
message with an expression over what the step above remembered.

```step
application: thermostat
method: report
description: Report 21.5 °C, acknowledging the command
parameters:
  body:
    deviceId: "{{ memory.deviceId }}"
    temperature: 21.5
    target: 21
    ack: "{{ memory.commandId }}"
test:
  latentApplications:
    - application: mqtt
      client: thermostats
      test:
        - topic: ronsel/examples/thermostats/+/telemetry
          message:
            ack: "$expr: value === memory.commandId"
            temperature: "$expr: value >= 21"
      retry:
        attempts: 10
        delay: 1
```

`retry` is what makes asserting on something asynchronous workable:
`attempts` says how many times to look, `delay` how many **seconds** to wait
between two looks. The step passes as soon as every message it lists has
arrived.

## 3. Anything, anywhere

`publish` sends any message to any topic — the method to copy into an
application of your own, since a message published from a flow is one line
of `mqttClient.publish`:

```step
application: thermostat
method: publish
description: Publish a firmware notice for the device
parameters:
  body:
    topic: "ronsel/examples/thermostats/{{ memory.deviceId }}/firmware"
    message:
      version: 2.4.1
      mandatory: true
test:
  body:
    qos: 1
  latentApplications:
    - application: mqtt
      client: thermostats
      test:
        - topic: "ronsel/examples/thermostats/{{ memory.deviceId }}/firmware"
          message:
            version: 2.4.1
      retry:
        attempts: 10
        delay: 1
```

## Where to go next

- Change `target` in step 1 to `35`. The API answers `400` and publishes
  nothing, and the step fails on both counts: the status, and — after ten
  looks — the command that never reached the device.
- Open `applications/thermostat/index.ts`: every method is a few lines of
  `mqttClient.publish`, which reads the broker from `env/local.env`.
- **06 · Kafka** does the same with events on a Kafka cluster.
