---
category: integrations
order: 3
icon: globe
title: 'Browser automation (Playwright)'
summary: 'Drive a web application from a flow. Experimental.'
keywords:
  - 'playwright'
  - 'browser'
  - 'web'
  - 'ui test'
  - 'headless'
  - 'chromium'
  - 'selenium'
  - 'session'
  - 'reuse browser'
  - 'keep open'
---

Web applications are tested through [Playwright](https://playwright.dev).
Playwright automations have their **own YAML files**, and an application
integrates with them by calling `playwright.run` with the path to one.

The application's `envs/*.env` decide the browser configuration: which browser,
launch options (headless, slowMo…) and context options (viewport, locale,
credentials…).

### Sessions

A browser step opens a browser, runs its YAML and closes it again — so three
browser steps in a row means three browsers, and each one starts from a blank
page.

A **session** keeps one browser, one context and one page alive across steps.
Name it on the step, and the next step naming the same one finds the page
exactly as this one left it: same tab, same cookies, same half-filled form.

```step
application: shop
method: search
session: storefront      # the browser this step runs in
closeSession: true       # ... and this step is the last one that needs it
```

| Key | Where | What it does |
|-|-|-|
| `session` | step, or the YAML file | The session the run belongs to. The step wins over the file. |
| `session: false` | step | A throw-away browser, even when the YAML file names a session. |
| `closeSession` | step, or the YAML file | Close the session once this step is done with it. |

`closeSession` is optional: whatever a flow leaves open is closed when the flow
ends, pass or fail. Leaving it out helps while writing a flow — what went wrong
is still on screen when a step fails. A session opened by a YAML file with
`keepOpen: true` is the exception: it is left running on purpose.

An application supports all of this by passing its context to `playwright.run`,
which is what it already does:

```js
export const search = applications.handler([
  // ctx carries the session the flow step asked for
  (ctx, parameters) => playwright.run(ctx, 'playwright.search.yaml', parameters)
], 'search');
```

`playwright.run` takes a fourth argument for what the step cannot decide, and
the helper exposes the sessions themselves:

```js
playwright.run(ctx, 'search.yaml', parameters, { session: 'storefront' });

playwright.hasSession('storefront');   // is it open?
playwright.openSessions();             // the names of the open ones
playwright.closeSession('storefront'); // close one
playwright.closeSessions();            // close them all — what the runner does
```

Two things a session cannot do. It is **one page**, so a step that opens a new
tab is on its own; and the browser it was opened with is the browser it keeps,
so a later step asking for a different `browserType` or `device` is given the
one already running.

This part is **experimental**: the set of available methods lives with the
Playwright helper, and the seeded `playful_website` example application shows a
complete YAML automation end to end.
