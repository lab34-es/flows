jest.mock('yargs-parser', () => () => ({}));

import request from 'supertest';
import * as httpServer from '../../src/helpers/httpServer';

const reporter = () => ({
  mimicRequest: jest.fn(),
  mimicResponse: jest.fn(),
  mimicResponseBody: jest.fn()
});

const mimicConfig = (application: string, rep = reporter()) => ({
  application,
  flow: { reporter: rep }
});

// Every test asks for port 0 and lets the OS hand out a free one. Fixed ports
// made this suite flaky on CI: 45000+ falls inside Linux's ephemeral range
// (32768-60999), so a busy runner could claim the same port between listen()
// and connect() and the request came back ECONNREFUSED at random.
//
// The registry in httpServer keys on (application, port), so what keeps the
// tests from reusing each other's server is now the application name alone --
// give every test its own.
const PORT = 0;
const urlOf = (server: any) => `http://127.0.0.1:${server.address().port}`;

const started: Array<{ server: any }> = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map(s => new Promise<void>(resolve => s.server.close(() => resolve()))));
});

describe('httpServer.start', () => {
  test('serves the callback\'s response and reports the exchange', async () => {
    const rep = reporter();

    const server: any = await httpServer.start(mimicConfig('calculator', rep), PORT, (req, res) => {
      res.json({ sum: 3 });
    });
    started.push({ server });

    const res = await request(urlOf(server)).post('/add').send({ a: 1, b: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 3 });
    expect(rep.mimicRequest).toHaveBeenCalledWith('calculator', '/add', expect.objectContaining({
      method: 'POST',
      body: { a: 1, b: 2 }
    }));
    expect(rep.mimicResponse).toHaveBeenCalledWith('calculator', '/add');
    expect(rep.mimicResponseBody).toHaveBeenCalledWith({ sum: 3 });
  });

  test('resolves with an http server that is listening', async () => {
    const server: any = await httpServer.start(mimicConfig('httpbin'), PORT, (req, res) => res.json({}));
    started.push({ server });

    expect(server).toBeDefined();
    expect(typeof server.close).toBe('function');
    expect(server.listening).toBe(true);
  });

  test('starting the same application and port again reuses the running server', async () => {
    const first: any = await httpServer.start(mimicConfig('reused'), PORT, (req, res) => res.json({ n: 1 }));
    started.push({ server: first });

    const second: any = await httpServer.start(mimicConfig('reused'), PORT, (req, res) => res.json({ n: 2 }));

    expect(second).toBe(first);
    const res = await request(urlOf(first)).get('/');
    expect(res.body).toEqual({ n: 1 });
  });

  test('templated responses are rendered against the request body', async () => {
    const server: any = await httpServer.start(mimicConfig('templated'), PORT, (req, res) => {
      res.json({ echoed: '{{name}}' });
    });
    started.push({ server });

    const res = await request(urlOf(server)).post('/').send({ name: 'ana' });
    expect(res.body).toEqual({ echoed: 'ana' });
  });

  test('urlencoded bodies are parsed too', async () => {
    const rep = reporter();
    const server: any = await httpServer.start(mimicConfig('form', rep), PORT, (req, res) => res.json({ ok: true }));
    started.push({ server });

    await request(urlOf(server)).post('/form').type('form').send({ a: '1' });
    expect(rep.mimicRequest).toHaveBeenCalledWith('form', '/form', expect.objectContaining({ body: { a: '1' } }));
  });
});

describe('httpServer.stop', () => {
  test('stopping an id that was never started resolves quietly', async () => {
    await expect(httpServer.stop('not-a-server')).resolves.toBeUndefined();
  });
});
