---
title: 04 · Browser, scraping and memory
description: Drive a browser, take the cookie and the token it holds, and prove they reached the next step.
---

# Browser, scraping and memory

Everything here runs on your own machine. The `browser` application serves a
small sign-in page on localhost and drives it with Playwright, so this flow
needs no internet and no account anywhere — only the browsers themselves,
which are a separate download:

```bash
npx playwright install chromium
```

## Sign in, and take what the browser holds

The page shows a heading, the server sets a session cookie, and the app
writes the bearer token it was given into local storage. Only the first of
those is on the screen, so only the first can be scraped — the other two are
read out of the browser itself:

| Method | Reads | Example |
|-|-|-|
| `scrape` | What is on the page | The heading |
| `cookies` | The cookie jar of the context | `demo_session` |
| `storage` | Local or session storage of the origin | `access_token` |

All three land in the **body** of the step, which is what the assertions
below look at. None of it reaches the flow memory on its own: the `memory`
mapping is where this flow says what is worth keeping, and under which name.

```step
application: browser
method: signIn
description: Sign in and collect the page, the cookie and the token
memory:
  demo_access_token: "{{ body.access_token }}"
test:
  body:
    title: "Welcome back, Ada"
    userName: "Ada Lovelace"
    userId: 7
    cartCount: 3
    sessionId: "$expr: typeof value === 'string' && value.length > 0"
    access_token: "$expr: /^demo\\..+\\.token$/.test(value)"
```

Three things worth noticing in that block:

- `userId` is `7`, not `"7"`. `json: id` reached into a value the app stored
  as JSON, and a value that already has a type keeps it.
- `cartCount` is `3` because the script asked for `output: number`, exactly
  as a `scrape` would.
- `access_token` is asserted, not printed. The reporter masks a value whose
  key contains `token`, so the run log shows it starred out — which is what
  you want of a bearer token that is also written to the test run on disk.

## Prove it arrived

The step above kept the token as `demo_access_token`. This one passes it
back to the application, which compares it with the token the browser was
actually given.

That comparison is the point of the whole flow: it only passes if the value
really did travel out of local storage, into the memory under the name this
flow chose, and back out again into these parameters.

```step
application: browser
method: whoami
description: The token the flow remembered is the token the browser held
parameters:
  body:
    token: "{{ memory.demo_access_token }}"
test:
  status: 200
  body:
    matches: true
    user: "Ada Lovelace"
```

## Where to go next

- Change `memory.demo_access_token` to something the browser never held and
  watch the second step answer `401` instead.
- Open `applications/browser/playwright.signIn.yaml` and set
  `launchOptions.headless` to `false` to watch the browser do it.
- The same three methods work against any site — see *Browser automation
  (Playwright)* in the help for sessions, which keep one browser alive across
  several steps.
