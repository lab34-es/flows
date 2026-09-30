// What `api.start` settles on, end to end: a free port, loopback only, and
// the URL handed back to whoever has to print and open it.

// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

// Starting the API must not furnish a context directory
jest.mock('../../src/helpers/bootstrap', () => ({
  ensureDefaults: jest.fn(async () => {}),
  ensureTypeScriptConfig: jest.fn(async () => {})
}));

import http from 'node:http';
import net from 'node:net';

/** Servers held open by a test: the ports taken, and the APIs started. */
const held: net.Server[] = [];
const started: Array<{ stop: () => Promise<void> }> = [];

/**
 * A fresh copy of the API module.
 *
 * It keeps one express app and one HTTP server per copy, so a case that has
 * to listen again asks for its own rather than restarting somebody else's.
 *
 * @returns {any} The module, ready to start
 */
const freshApi = (): any => {
  let api: any;
  jest.isolateModules(() => { api = require('../../src/api/index'); });
  started.push(api);
  return api;
};

/**
 * Take a port, so the selector has to walk past it.
 *
 * @returns {Promise<number>} The port that ended up taken
 */
const hold = (): Promise<number> => new Promise(resolve => {
  const server = net.createServer();
  held.push(server);
  server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port));
});

/**
 * Ask the running API for something, without following redirects.
 *
 * @param {string} url - The URL to ask for
 * @returns {Promise<Object>} { status, location }
 */
const get = (url: string): Promise<{ status?: number; location?: string }> => {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      response.resume();
      resolve({ status: response.statusCode, location: response.headers.location });
    }).on('error', reject);
  });
};

afterEach(async () => {
  await Promise.all(started.splice(0).map(api => api.stop()));
  await Promise.all(held.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

describe('api.start', () => {
  test('walks past a busy port, listens on loopback and returns the URL', async () => {
    const busy = await hold();
    const api = freshApi();

    const url = await api.start({ port: busy });

    // The port is never chosen in silence: this is the line that was printed
    expect(console.log).toHaveBeenCalledWith(url);

    const [, host, port] = /^http:\/\/([^:]+):(\d+)$/.exec(url) || [];
    expect(host).toBe('127.0.0.1');
    expect(Number(port)).toBeGreaterThan(busy);

    // And it is answering there: an unknown route is still an answer
    await expect(get(`${url}/api/not-a-route`)).resolves.toEqual({ status: 404, location: undefined });

    // Nothing outside this machine could have reached it
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('Warning: listening on'));
  });

  test('exposed on purpose, it says so and prints a URL a browser can use', async () => {
    const api = freshApi();

    // What a bare --host resolves to
    const url = await api.start({ host: '0.0.0.0', port: 0 });

    expect(url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('every network interface'));
    expect(console.log).toHaveBeenCalledWith(url);
  });

  test('in development the browser is sent to Vite, which proxies back here', async () => {
    process.env.FLOWS_DEV = '1';

    try {
      const api = freshApi();
      const url = await api.start({ port: 0 });

      await expect(get(`${url}/flows`)).resolves.toEqual({
        status: 302,
        location: 'http://localhost:3000/flows'
      });
      // An API route is not something Vite could answer
      await expect(get(`${url}/api/not-a-route`)).resolves.toEqual({ status: 404, location: undefined });
    }
    finally {
      delete process.env.FLOWS_DEV;
    }
  });

  test('stopping an API that never started is harmless', async () => {
    const api = freshApi();

    await expect(api.stop()).resolves.toBeUndefined();
  });
});
