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
  - 'install'
  - 'npx playwright install'
  - 'cookies'
  - 'cookie'
  - 'localstorage'
  - 'local storage'
  - 'sessionstorage'
  - 'session storage'
  - 'access token'
  - 'bearer token'
  - 'scrape'
  - 'executable does not exist'
---

Web applications are tested through [Playwright](https://playwright.dev).
Playwright automations have their **own YAML files**, and an application
integrates with them by calling `playwright.run` with the path to one.

### Install the browsers first

Installing this package brings in Playwright, but **not the browsers it
drives** — those are a separate download, and until they are there every
browser step fails with *Executable doesn't exist*. Run this once on the
machine that runs the flows:

```bash
npx playwright install
```

That fetches all three browsers. `npx playwright install chromium` fetches
only the one you need. On a bare Linux box (CI, a container) the browsers also
need system libraries: `npx playwright install --with-deps chromium` installs
those too, and needs root.

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

### Taking values out of the browser

Three methods bring something back: `scrape` reads it off the page, and
`cookies` and `storage` read it out of the browser itself. All three take the
same shape — the key on the left is the name the value comes back under, and
what is under it says where to find it.

```yaml
- method: cookies
  parameters:
    sessionId:
      name: connect.sid       # the cookie's name
    csrf:
      name: /^csrf_/          # ... or a pattern, when the app generates it
    expiresAt:
      name: connect.sid
      field: expires          # value (default), domain, path, expires, httpOnly…
    every: {}                 # no name at all: every cookie, as an object

- method: storage
  parameters:
    token:
      key: access_token       # a localStorage key
    userId:
      key: auth.user
      json: id                # the value is JSON — take this path out of it
    cartCount:
      key: cart.count
      type: session           # sessionStorage instead of localStorage
      output: number
    everything: {}            # no key at all: the whole store
```

`output` and `regex` work exactly as they do for `scrape`. A cookie or a key
that is not there comes back as `null` rather than failing the run — so a flow
can assert that it *is* there. Cookies are read from the context, so one set on
the identity provider is still readable after the redirect back; storage is
read from the page, so it is the storage of the origin the browser is on.

All of it is merged, in step order, into the **body** of the step. Which means
a later step of the same YAML file reads it as
`{{ steps.<id>.result.<key> }}`, and the flow asserts on it the usual way:

```step
application: shop
method: login
test:
  body:
    sessionId: "$expr: value && value.length > 10"
    token: "$expr: value !== null"
```

None of it reaches the flow memory on its own — a flow says what is worth
keeping, and under which name, with the step's `memory` mapping:

```step
application: shop
method: login
memory:
  shop_bearer_token: "{{ body.token }}"
```

See *Passing data between steps* for what that mapping can read.

A harvested value is reported to the terminal and persisted with the test run,
like any other response body. Name the keys accordingly: the reporter masks a
value whose key contains `token`, `password`, `secret` or `authorization`.

This part is **experimental**: the set of available methods lives with the
Playwright helper, and the seeded `playful_website` example application shows a
complete YAML automation end to end.
