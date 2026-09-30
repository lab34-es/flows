/**
 * A smart thermostat and the cloud service that runs it, over MQTT.
 *
 * Every message goes through a real MQTT broker -- one on this machine, by
 * default (see `env/local.env`) -- so the flow in
 * `flows/examples/05-mqtt-thermostat.md` exercises exactly what a flow against
 * a real fleet would: a command the cloud sends out of band, listened for and
 * asserted on, and a device answering it.
 *
 * Both sides are played from here, so the example runs on its own. Against a
 * real system, one of them is what you are testing: you publish as the
 * device and assert that the cloud reacted, or you call the cloud's API and
 * assert on what reached the device.
 *
 * Every topic of a device lives under `ronsel/examples/thermostats/<device>/`:
 *
 * | Topic | Published by | Message |
 * |-|-|-|
 * | `commands` | the cloud | `{ command, commandId, target }` |
 * | `telemetry` | the device | `{ temperature, target, ack }` |
 */
import { randomUUID } from 'crypto';

import { applications, mqttClient } from 'ronsel';
import type { Context, Parameters } from 'ronsel';

const topic = (deviceId: string, channel: string) => `ronsel/examples/thermostats/${deviceId}/${channel}`;

/**
 * Asks the cloud to set a thermostat's target temperature.
 *
 * It stands in for the cloud's HTTP API: it answers `202` straight away, and
 * the command itself travels to the device over MQTT, out of band. The id of
 * that command exists nowhere but in the message -- keep it with a `memory`
 * mapping on the latent assertion, as the example flow does.
 *
 * @param {string} body.deviceId - The thermostat. Any id will do: `{{ uuid }}`
 *   makes a fresh one on every run.
 * @param {number} body.target - The temperature to reach, in °C, from 5 to 30.
 * @returns {202 | 400} `202` once the command is on its way to the device;
 *   `400` without a device, or with a target no thermostat accepts.
 * ```json
 * { "deviceId": "3f1c9a2e-…", "target": 21, "status": "queued" }
 * ```
 * @example
 * application: thermostat
 * method: setTarget
 * parameters:
 *   body:
 *     deviceId: "{{ uuid }}"
 *     target: 21
 * test:
 *   status: 202
 */
export const setTarget = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { deviceId, target } = (parameters || {}).body || {};
    const degrees = Number(target);

    if (!deviceId || !Number.isFinite(degrees) || degrees < 5 || degrees > 30) {
      return [{}, 400, {
        error: {
          code: 'INVALID_TARGET',
          message: 'A deviceId and a target between 5 and 30 °C are required'
        }
      }];
    }

    await mqttClient.publish(ctx, topic(deviceId, 'commands'), {
      command: 'set-target',
      commandId: randomUUID(),
      target: degrees
    });

    return [{}, 202, { deviceId, target: degrees, status: 'queued' }];
  }
], 'setTarget');

/**
 * Reports what the thermostat measures, as the device itself would.
 *
 * This is the flow playing a device that is not there: the reading goes out
 * on the device's telemetry topic, and a device that has just applied a
 * command says so by carrying the command's id in `ack`.
 *
 * @param {string} body.deviceId - The thermostat reporting.
 * @param {number} body.temperature - What it measures, in °C.
 * @param {number} [body.target] - The target it is working towards.
 * @param {string} [body.ack] - The id of the command it has just applied.
 * @returns {null} What was published, and on which topic.
 * ```json
 * {
 *   "topic": "ronsel/examples/thermostats/3f1c9a2e-…/telemetry",
 *   "qos": 1,
 *   "message": { "temperature": 21.5, "target": 21, "ack": "9b2e41d0-…" }
 * }
 * ```
 * @example
 * application: thermostat
 * method: report
 * parameters:
 *   body:
 *     deviceId: "{{ memory.deviceId }}"
 *     temperature: 21.5
 *     ack: "{{ memory.commandId }}"
 */
export const report = applications.handler([
  (ctx: Context, parameters: Parameters) => {
    const { deviceId, temperature, target, ack } = (parameters || {}).body || {};

    return mqttClient.publish(ctx, topic(deviceId, 'telemetry'), {
      temperature: Number(temperature),
      target: target === undefined ? undefined : Number(target),
      ack
    });
  }
], 'report');

/**
 * Publishes any message, on any topic, to the thermostat's broker.
 *
 * The two methods above are what this example is about; this one is for
 * everything they do not model -- and it is the method to copy into an
 * application of your own, since a message published from a flow is one line
 * of `mqttClient.publish`.
 *
 * @param {string} body.topic - Where to publish.
 * @param {any} body.message - What: published as JSON.
 * @param {boolean} [body.retain] - Whether the broker keeps it for whoever subscribes later.
 * @returns {null} What was published, and on which topic.
 * ```json
 * { "topic": "ronsel/examples/thermostats/3f1c9a2e-…/firmware", "qos": 1, "message": { "version": "2.4.1" } }
 * ```
 * @example
 * application: thermostat
 * method: publish
 * parameters:
 *   body:
 *     topic: "ronsel/examples/thermostats/{{ memory.deviceId }}/firmware"
 *     message:
 *       version: 2.4.1
 */
export const publish = applications.handler([
  (ctx: Context, parameters: Parameters) => {
    const { topic: destination, message, retain } = (parameters || {}).body || {};
    return mqttClient.publish(ctx, destination, message, { retain: retain === true });
  }
], 'publish');
