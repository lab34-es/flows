---
category: applications
order: 1
icon: app
title: 'Applications'
summary: 'What a step calls: a folder of TypeScript methods that know how to reach a system, documented in place.'
keywords:
  - 'application'
  - 'method'
  - 'capabilities'
  - 'index.ts'
  - 'typescript'
  - 'handler'
  - 'httpClient'
  - 'pgClient'
  - 'mqttClient'
  - 'playwright'
  - 'validate'
  - 'inputs'
  - 'mimic'
  - 'env'
  - 'readme'
  - 'create'
  - 'rename'
  - 'tsconfig'
  - 'http'
  - 'postgres'
  - 'mqtt'
  - 'browser'
---

An application is a folder under `applications/` in the context folder, named
after the system it talks to. Its `index.ts` exports **methods**, and a method
is what a step calls: `application: payments` with `method: refund` runs the
`refund` export of `applications/payments/index.ts`.

| File | What it is |
|-|-|
| `index.ts` | The methods, each one documented by the JSDoc block above it. |
| `README.md` | Anything worth knowing before writing flows against it. Rendered in the application's page. |
| `env/<environment>.env` | The variables of one environment: URL, credentials, options. See [Environments](/help/environments). |
| `env/<environment>.env.example` | The committed template of that file, names only. |
| `mimic.ts` | Optional: how to fake this application while another one is under test. See below. |
| anything else | Playwright YAML files, fixtures, SQL, whatever the methods need. |

## Creating one

The `+` next to **Applications** in the sidebar asks for a name and copies a
template: three documented methods (one offline, one reading the flow memory,
one HTTP call), a README and an `env/local.env`. Replace them with your own.
The name is the folder, and flows refer to it by that name, so the UI warns
when you rename an application.

Everything the sidebar shows about an application is read from the folder:
the README, the methods with their parameters, outputs and memory, and the
environment files. A **Document / Source** toggle on the application page
opens any of those files in an editor, `index.ts` included.

## A method

    import { applications, httpClient } from '@lab34/flows';
    import type { Context, Parameters } from '@lab34/flows';

    /**
     * Refunds an order.
     * @param {string} body.orderId - The order to refund.
     * @returns {202} The refund was accepted.
     */
    export const refund = applications.handler([
      (ctx: Context, parameters: Parameters) =>
        httpClient.post(ctx, '/refunds', { body: parameters.body })
    ], 'refund');

`applications.handler` takes an array and the method's name. The last item of
the array does the work; anything before it is a **validator** that runs
first. The function receives three arguments:

| Argument | What it is |
|-|-|
| `ctx` | The context. `ctx.env` holds the variables of the env file of the selected environment; `ctx.name` and `ctx.path` name the application; `ctx.stepId` is the step being run; `ctx.reporter` is where the helpers report what they did. |
| `parameters` | The step's `parameters`, templates already resolved. By convention `body`, `params`, `query` and `headers`. |
| `flow` | The whole flow: `flow.memory` is what earlier steps left behind. |

It returns a tuple, `[headers, status, body, memory]`. The first three are
what the step asserts on with `test`; the fourth is optional, and whatever it
holds is merged into the flow memory for later steps. The built-in clients
return the first three, so a method that wants to remember something builds
the array itself. See [Passing data between steps](/help/memory).

Applications are TypeScript, transpiled when they run and never type checked:
a type error never stops a flow. The `tsconfig.json` the tool writes at the
root of the context points your editor at the types of the installed
package, so completion works while you write.

## Validators

`validate.body`, `validate.query`, `validate.params` and `validate.headers`
take a JSON schema and fail the step, with the schema's errors, before the
method runs. Their `fallbacks` fill a missing field before the check, trying
each source in order: the flow memory, a replacer, or a constant.

    validate.body({
      type: 'object',
      properties: { token: { type: 'string' } },
      fallbacks: {
        token: [
          { type: 'memory', key: 'authToken' },
          { type: 'static', value: 'anonymous' }
        ]
      }
    })

## The helpers

Everything a method needs to reach a system comes from `@lab34/flows`.

| Helper | What it does |
|-|-|
| `httpClient.get / post / put / patch / del(ctx, path, options)` | An HTTP request to `BASE_URL` from `ctx.env` plus `path`. `options` carries `body`, `headers` and `params` (the query string). Returns `[headers, status, body]`. |
| `pgClient.query(ctx, sql, values)` | A PostgreSQL query, connected with `DATABASE_CONNECTION_STRING` or the `PG*` variables of `ctx.env`. |
| `mqttClient.publish(ctx, topic, message, options)` | Publishes on the broker `MQTT_HOST` and friends describe. See [Latent applications](/help/latent-applications). |
| `playwright.run(ctx, 'file.yaml', parameters, options)` | Runs a browser automation described in a YAML file next to `index.ts`. See [Browser automation](/help/playwright). |
| `inputs.text(ctx, { label, secret, defaultValue })` | Stops the run and asks the person for a value: a field under the step in the UI, a prompt on the CLI. |
| `validate.*` | The validators above. |
| `httpServer`, `mimicFiles`, `express` | For mimics. See below. |

The variables each helper reads are listed in
[Environments](/help/environments).

## Mimics

A step can ask for a dependency of the system under test to be faked while it
runs, with its `mimic` key (see [Step blocks](/help/step-blocks)). The fake is
code of the mimicked application: a `mimic.ts` next to its `index.ts`,
exporting `start(config)` and `stop(config)`, where `config` carries what the
step wrote (`application`, `url`, anything else) plus the `flow`. `start`
typically opens an HTTP server with the `httpServer` helper and answers the
routes the real dependency would; a response sent with `res.json()` goes
through the replacers, with the request body in scope, so a fake can echo
what it was sent. The system under test has to be pointed at that server,
which is a variable of its own env file.

## Listing what exists

    lab34-flows --capabilities

prints every application of the context with its methods: the same list the
sidebar shows, and the same catalogue the AI is given when it writes a flow.
How to document a method so that all three read well is in
[Documenting an application](/help/application-docs).
