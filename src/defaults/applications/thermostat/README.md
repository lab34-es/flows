# thermostat

A smart thermostat and the cloud service that runs it, talking over
[MQTT](https://mqtt.org). Every message goes through a real broker, so it
needs one — on this machine, the quickest is Docker:

```bash
docker run -d --name mosquitto -p 1883:1883 eclipse-mosquitto:2 mosquitto -c /mosquitto-no-auth.conf
```

## What you can practice with it

- **Publishing from a flow** — every method publishes with `mqttClient`, the
  helper an application of yours would use to play a device that is not there.
- **Listening for what happens out of band** — the example flow declares an
  MQTT *latent application* that subscribes before the first step, and
  asserts that a message arrived: on which topic, saying what.
- **Keeping what only a message carries** — the id of a command exists
  nowhere but in the MQTT message, and the flow remembers it from there.

Both sides are played from here, so the example runs on its own. Against a
real system, one of them is what you are testing: publish as the device and
assert that the cloud reacted, or call the cloud's API and assert on what
reached the device.

## Methods

| Method | Plays | What it publishes |
|-|-|-|
| `setTarget` | the cloud's API, answering `202` | a `set-target` command on `…/<device>/commands` |
| `report` | the device | a reading on `…/<device>/telemetry`, with `ack` for a command it applied |
| `publish` | anyone | any message, on any topic |

Every topic lives under `ronsel/examples/thermostats/<device>/`. See the
**Methods** section in the UI (or the JSDoc blocks of `index.ts`) for the full
input / output reference of each method.

## Environment

| Variable | Description | Example |
|-|-|-|
| `MQTT_HOST` | Broker host | `localhost` |
| `MQTT_PORT` | Broker port | `1883` |

`mqttClient` reads more — `MQTT_PROTOCOL`, `MQTT_USERNAME`, `MQTT_PASSWORD`,
`MQTT_KEY`, `MQTT_CERT`, `MQTT_CA`, `MQTT_REJECT_UNAUTHORIZED`, `MQTT_QOS` —
for a broker that asks for credentials or certificates, such as AWS IoT.

No Docker? A public test broker works too: set `MQTT_HOST` to
`broker.hivemq.com` here, and `host` in the frontmatter of the flow.

## The flow

`flows/examples/05-mqtt-thermostat.md` runs all three, end to end.
