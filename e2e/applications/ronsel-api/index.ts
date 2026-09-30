/**
 * The ronsel HTTP API, as a flow sees it.
 *
 * `BASE_URL` (env/ci.env) is a running `ronsel` -- the API the web UI talks
 * to -- serving a scratch context that was empty when it started, so it
 * holds exactly the bundled examples. scripts/e2e.js starts it that way.
 *
 * The methods are the verbs: a flow names the path, the query and the body,
 * and asserts the answer. That keeps every step readable as the request it
 * makes, and means a new endpoint can be tested without touching this file.
 * `waitForRun` is the one thing a plain request cannot do: starting a flow
 * through the API answers at once, and the result lands in a test run later.
 */
import { applications, httpClient } from 'ronsel';
import type { Context, Parameters } from 'ronsel';

/** Path, query and body out of a step's parameters. */
const request = (parameters: Parameters) => {
  const { params, query, body } = parameters || {};
  const urlPath = params && params.path;

  if (!urlPath || typeof urlPath !== 'string' || !urlPath.startsWith('/')) {
    throw new Error('params.path is required and must start with "/", e.g. /api/flows');
  }

  return { urlPath, query: query || {}, body };
};

/**
 * GET a path of the API.
 *
 * @param {string} params.path - The path, e.g. `/api/flows`.
 * @param {object} [query.*] - Query string parameters.
 * @returns {*} Whatever the API answers. JSON bodies are parsed; anything
 *   else (the HTML report of a run, say) comes back as text.
 * @example
 * application: ronsel-api
 * method: get
 * parameters:
 *   params:
 *     path: /api/flows
 * test:
 *   status: 200
 */
export const get = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { urlPath, query } = request(parameters);
    return httpClient.get(ctx, urlPath, { params: query });
  }
], 'get');

/**
 * POST a JSON body to a path of the API.
 *
 * @param {string} params.path - The path, e.g. `/api/flows/parse`.
 * @param {object} [body.*] - The JSON body.
 * @returns {*} Whatever the API answers.
 * @example
 * application: ronsel-api
 * method: post
 * parameters:
 *   params:
 *     path: /api/flows/parse
 *   body:
 *     value: "# Hello"
 * test:
 *   status: 200
 */
export const post = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { urlPath, query, body } = request(parameters);
    return httpClient.post(ctx, urlPath, { params: query, body: body || {} });
  }
], 'post');

/**
 * PUT a JSON body to a path of the API.
 *
 * @param {string} params.path - The path.
 * @param {object} [body.*] - The JSON body.
 * @returns {*} Whatever the API answers.
 * @example
 * application: ronsel-api
 * method: put
 * parameters:
 *   params:
 *     path: /api/flows/properties
 *   body:
 *     path: examples/01-welcome.md
 *     properties:
 *       title: Welcome
 * test:
 *   status: 200
 */
export const put = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { urlPath, query, body } = request(parameters);
    return httpClient.put(ctx, urlPath, { params: query, body: body || {} });
  }
], 'put');

/**
 * DELETE a path of the API, with an optional JSON body.
 *
 * @param {string} params.path - The path.
 * @param {object} [body.*] - The JSON body, for the endpoints that take one.
 * @returns {*} Whatever the API answers.
 * @example
 * application: ronsel-api
 * method: del
 * parameters:
 *   params:
 *     path: /api/flows/file
 *   body:
 *     path: scratch/hello.md
 * test:
 *   status: 200
 */
export const del = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const { urlPath, query, body } = request(parameters);
    return httpClient.del(ctx, urlPath, { params: query, body: body || {} });
  }
], 'del');

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wait for the run a flow started through the API to finish.
 *
 * `POST /api/flows/start` answers as soon as the run begins; its result is
 * recorded as a test run, which this polls (`GET /api/test-runs`) until the
 * newest run of the given trigger is no longer running.
 *
 * @param {string} [body.trigger=flow] - Which runs to look at: `flow` for one
 *   started from a document, `folder` for a view.
 * @returns {200 | 504} The finished run, as `/api/test-runs` lists it -- its
 *   `status` is what to assert. 504 when nothing finished within
 *   `RUN_TIMEOUT_MS` of the environment.
 * ```json
 * { "id": "2026-01-01T10-00-00-local", "trigger": "flow", "status": "passed", "flows": [] }
 * ```
 * @memory {write} runId - The id of the finished run.
 * @example
 * application: ronsel-api
 * method: waitForRun
 * test:
 *   status: 200
 *   body:
 *     status: passed
 */
export const waitForRun = applications.handler([
  async (ctx: Context, parameters: Parameters) => {
    const body = (parameters || {}).body || {};
    const trigger = body.trigger || 'flow';
    const timeout = parseInt(ctx.env.RUN_TIMEOUT_MS || '60000', 10);
    const started = Date.now();

    while (Date.now() - started < timeout) {
      const [headers, status, runs] = await httpClient.get(ctx, '/api/test-runs');

      if (status === 200 && Array.isArray(runs)) {
        const newest = runs.find((run: any) => run.trigger === trigger);

        if (newest && newest.status !== 'running') {
          return [headers, 200, newest, { runId: newest.id }];
        }
      }

      await sleep(500);
    }

    return [{}, 504, { error: `No finished "${trigger}" run within ${timeout}ms` }, {}];
  }
], 'waitForRun');
