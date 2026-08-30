/**
 * A browser example that runs entirely on your own machine.
 *
 * It serves a tiny sign-in page on localhost and drives it with Playwright,
 * so it needs no internet and no account anywhere -- only the browsers
 * themselves, which are a separate download:
 *
 *     npx playwright install chromium
 *
 * What it is here to show is how a flow gets values *out* of a browser and
 * keeps them. The page does what a real single-page app does when you sign
 * in: the server sets a session cookie, and the app writes the bearer token
 * it was given into local storage. Neither of those is on the screen, so
 * neither can be scraped -- they are read out of the browser itself with the
 * `cookies` and `storage` methods.
 *
 * Nothing a browser step collects reaches the flow memory on its own. The
 * flow says what is worth keeping, and under which name, with the step's
 * `memory` mapping -- see `flows/examples/04-browser-and-scraping.md`.
 */
import http from 'http';
import { AddressInfo } from 'net';

import { playwright, applications } from '@lab34/flows';
import type { Context, Parameters, Flow } from '@lab34/flows';

/**
 * What the site handed out the last time it served the page.
 *
 * It is kept so `whoami` can compare the token a later step passes it with
 * the one the browser actually held: that comparison is the proof that the
 * value really did travel from local storage into the flow memory and on
 * into the next step, rather than being something the flow made up.
 */
let issued: { token: string; sessionId: string } | null = null;

/** The demo site, started once and reused by every step of the run. */
let site: http.Server | null = null;

const id = () => Math.random().toString(36).slice(2, 10);

/**
 * The sign-in page.
 *
 * A title to scrape, a session cookie only the browser can see, and the two
 * things a single-page app keeps for itself: the bearer token in local
 * storage, and the state of the basket in session storage.
 */
const page = (token: string) => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Flows demo shop</title></head>
  <body>
    <h1 data-testid="page-title">Welcome back, Ada</h1>
    <p data-testid="basket">3 items in your basket</p>
    <script>
      // What the app does with what it was given when it signed in
      localStorage.setItem('access_token', ${JSON.stringify(token)});
      localStorage.setItem('profile', JSON.stringify({ id: 7, name: 'Ada Lovelace' }));
      sessionStorage.setItem('cart.count', '3');
    </script>
  </body>
</html>`;

/**
 * Start the demo site, or hand back the one already running.
 *
 * Port 0: the operating system picks a free port, so the example cannot
 * collide with whatever else is listening on this machine.
 */
const startSite = (): Promise<string> => new Promise((resolve, reject) => {
  if (site) {
    const { port } = site.address() as AddressInfo;
    return resolve(`http://127.0.0.1:${port}`);
  }

  const server = http.createServer((request, response) => {
    // Anything that is not the page -- the favicon, mostly -- is answered
    // rather than left to time out
    if (request.url !== '/') {
      response.writeHead(204).end();
      return;
    }

    issued = { token: `demo.${id()}.token`, sessionId: id() };

    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': `demo_session=${issued.sessionId}; Path=/; SameSite=Lax`
    });
    response.end(page(issued.token));
  });

  server.on('error', reject);

  server.listen(0, '127.0.0.1', () => {
    site = server;

    // A listening server is a reason for node to stay alive, and this one
    // outlives the step that started it -- so the run would finish and the
    // command would never come back. Unreferencing it keeps it serving for
    // as long as the flow is running and stops it holding the door open
    // once the flow is done.
    server.unref();

    const { port } = server.address() as AddressInfo;
    resolve(`http://127.0.0.1:${port}`);
  });
});

const signInSteps = [
  applications.description('Signs into the demo site and brings back what the browser holds'),
  async (ctx: Context, parameters: Parameters) => {
    const url = await startSite();

    return playwright.run(ctx, 'playwright.signIn.yaml', {
      ...parameters,
      query: { ...parameters.query, url }
    });
  }
];

const whoamiSteps = [
  applications.description('Checks a token against the one the browser was actually given'),
  (ctx: Context, parameters: Parameters, _flow: Flow) => {
    const token = (parameters.body || {}).token;

    if (!issued) {
      return [{}, 409, { ok: false, error: 'Nobody has signed in yet: run signIn first' }];
    }

    if (token !== issued.token) {
      return [{}, 401, {
        ok: false,
        error: 'That is not the token the browser was holding',
        // Never the tokens themselves: this is an example of reading secrets
        // out of a browser, and an example should not print them
        expectedLength: issued.token.length,
        receivedLength: String(token || '').length
      }];
    }

    return [{}, 200, { ok: true, user: 'Ada Lovelace', matches: true }];
  }
];

/**
 * Signs into the demo site and brings back everything the browser holds.
 *
 * The site is served from this machine, so the step needs no network -- only
 * the Playwright browsers (`npx playwright install chromium`). It is the one
 * step in the examples that shows the three ways of getting a value out of a
 * browser at once: `scrape` reads the heading off the page, `cookies` reads
 * the session cookie the server set, and `storage` reads what the app wrote
 * into local and session storage.
 *
 * None of it is remembered on its own. Keep what you need with the step's
 * `memory` mapping:
 *
 * ```yaml
 * memory:
 *   demo_access_token: "{{ body.access_token }}"
 * ```
 *
 * @returns {null} What the browser held.
 * ```json
 * {
 *   "title": "Welcome back, Ada",
 *   "sessionId": "k3f9a1c8",
 *   "access_token": "demo.a1b2c3d4.token",
 *   "userId": 7,
 *   "userName": "Ada Lovelace",
 *   "cartCount": 3
 * }
 * ```
 * @example
 * application: browser
 * method: signIn
 * memory:
 *   demo_access_token: "{{ body.access_token }}"
 * test:
 *   body:
 *     title: "Welcome back, Ada"
 *     userId: 7
 */
export const signIn = applications.handler(signInSteps, 'signIn');

/**
 * Answers whether a token is the one the browser was given when it signed in.
 *
 * This is what makes the example a proof rather than a demonstration: the
 * token is compared with the one the site issued, so the step only passes if
 * the value really did travel out of local storage, into the flow memory and
 * back out of it into these parameters.
 *
 * @param {string} body.token - The token to check, normally
 *   `{{ memory.demo_access_token }}`.
 * @returns {200} The token matches the one the browser held.
 * ```json
 * { "ok": true, "user": "Ada Lovelace", "matches": true }
 * ```
 * @returns {401} It does not.
 * @returns {409} Nothing has signed in yet.
 * @memory {read} demo_access_token - Written by the `signIn` step of the
 *   flow, from the browser's local storage.
 * @example
 * application: browser
 * method: whoami
 * parameters:
 *   body:
 *     token: "{{ memory.demo_access_token }}"
 * test:
 *   status: 200
 *   body:
 *     matches: true
 */
export const whoami = applications.handler(whoamiSteps, 'whoami');
