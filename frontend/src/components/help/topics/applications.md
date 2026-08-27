---
category: writing
order: 4
icon: app
title: 'Applications and methods'
summary: 'Where the callable methods come from, and how they document themselves.'
keywords:
  - 'application'
  - 'method'
  - 'jsdoc'
  - 'docs'
  - 'index.ts'
  - 'typescript'
  - 'readme'
  - 'http'
  - 'mqtt'
  - 'postgres'
---

Applications live in the `applications` folder of your context directory. Each
one is a **TypeScript** module that exports methods, and each method is what a
step can call. They can talk to HTTP APIs, MQTT, PostgreSQL databases, or drive
a browser with Playwright.

    import { applications, httpClient } from '@lab34/flows';
    import type { Context, Parameters } from '@lab34/flows';

    export const search = applications.handler([
      (ctx: Context, parameters: Parameters) =>
        httpClient.get(ctx, `/search/${parameters.query?.barcode}`)
    ], 'search');

Types are there to help you write the code: applications are transpiled when
they run, never type checked, so a type error never stops a flow. A
`tsconfig.json` is kept up to date in your context directory — that is what
points your editor at the types of the installed package.

Documentation is read straight from the **JSDoc blocks** of the application's
`index.ts` — there is no `docs.json`. That documentation is what the UI renders
*and* what the model is given when it writes a flow for you, so the better the
JSDoc, the better the generated flows.

| Tag | Meaning |
|-|-|
| `@param {type} name - description` | An input parameter. `[name]` marks it optional, `[name=value]` adds a default. |
| `@returns {status} description` | The response, with an optional JSON example body. |
| `@memory {write\|read} key - description` | Flow memory the method writes or reads. |
| `@example` | An example step, in YAML, ready to paste into a step block. |

A `README.md` in the application folder is rendered in the UI as well.

The tool seeds three example applications on first run: `calculator` (fully
offline), `httpbin` and `jsonplaceholder`.
