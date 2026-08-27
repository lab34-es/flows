// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

// The settings live in the user's context folder: keep them in memory instead
jest.mock('../../src/helpers/config', () => {
  let stored = {};
  return {
    load: jest.fn(async () => stored),
    save: jest.fn(async (name, data) => { stored = data; return data; }),
    __set: (value) => { stored = value; },
    __get: () => stored
  };
});

// The SharePoint client secret goes to the context's .env: keep it in memory
jest.mock('../../src/helpers/env', () => {
  let stored: Record<string, string> = {};
  return {
    FILE: '.env',
    readAll: jest.fn(async () => stored),
    read: jest.fn(async (key) => stored[key]),
    write: jest.fn(async (key, value) => {
      if (value) { stored[key] = String(value); }
      else { delete stored[key]; }
    }),
    __set: (value) => { stored = value; },
    __get: () => stored
  };
});

// No settings route is allowed to reach Jira/Xray or SharePoint on its own
jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn()
}));

import express from 'express';
import request from 'supertest';

import axios from 'axios';
import * as configHelper from '../../src/helpers/config';
import * as env from '../../src/helpers/env';
import settings from '../../src/api/routes/settings';

const app = express();
app.use(express.json());
app.use('/api/settings', settings);

beforeEach(() => {
  (configHelper as any).__set({});
  (env as any).__set({});
  (axios.get as jest.Mock).mockReset();
  (axios.post as jest.Mock).mockReset();
  (axios.put as jest.Mock).mockReset();
});

describe('GET /api/settings/jira', () => {
  test('never sends the secrets to the client', async () => {
    (configHelper as any).__set({
      jira: true,
      kind: 'cloud',
      jiraBaseUrl: 'https://acme.atlassian.net',
      cloud: { clientId: 'client-id', clientSecret: 'super-secret' },
      server: { personalAccessToken: 'super-token' }
    });

    const response = await request(app).get('/api/settings/jira').expect(200);

    expect(JSON.stringify(response.body)).not.toContain('super-secret');
    expect(JSON.stringify(response.body)).not.toContain('super-token');
    expect(response.body.cloud.hasClientSecret).toBe(true);
    expect(response.body.server.hasToken).toBe(true);
    expect(response.body.configured).toBe(true);
  });

  test('describes an empty configuration', async () => {
    const response = await request(app).get('/api/settings/jira').expect(200);

    expect(response.body.kind).toBe('cloud');
    expect(response.body.configured).toBe(false);
    expect(response.body.available.map(item => item.id)).toEqual(['cloud', 'basic', 'server']);
  });
});

describe('PUT /api/settings/jira', () => {
  test('stores the settings and answers without the new secret', async () => {
    const response = await request(app)
      .put('/api/settings/jira')
      .send({
        kind: 'cloud',
        jiraBaseUrl: 'https://acme.atlassian.net/',
        cloud: { clientId: 'client-id', clientSecret: 'super-secret' }
      })
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain('super-secret');
    expect(response.body.jiraBaseUrl).toBe('https://acme.atlassian.net');
    expect((configHelper as any).__get().cloud.clientSecret).toBe('super-secret');
  });

  test('takes the project keys as the comma separated list the UI sends', async () => {
    const response = await request(app)
      .put('/api/settings/jira')
      .send({ projectKeys: 'ABC, ACME' })
      .expect(200);

    expect(response.body.projectKeys).toEqual(['ABC', 'ACME']);
    expect((configHelper as any).__get().projectKeys).toEqual(['ABC', 'ACME']);
  });

  test('answers 400 with the reason when the input is wrong', async () => {
    const response = await request(app)
      .put('/api/settings/jira')
      .send({ kind: 'onprem' })
      .expect(400);

    expect(response.body.error).toMatch(/Unknown Jira integration type/);
  });
});

describe('POST /api/settings/jira/test', () => {
  test('answers 400 without calling Jira when nothing is configured', async () => {
    const response = await request(app).post('/api/settings/jira/test').expect(400);

    expect(response.body.error).toMatch(/client id and client secret/);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

describe('/api/settings/jira/pull', () => {
  test('answers 400 without touching the disk when nothing is configured', async () => {
    const response = await request(app).post('/api/settings/jira/pull').expect(400);

    expect(response.body.error).toMatch(/Configure the Jira \/ Xray integration/);
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('reports an idle pull before any has run', async () => {
    const response = await request(app).get('/api/settings/jira/pull').expect(200);

    expect(response.body.running).toBe(false);
    expect(response.body.folder).toBe('xray');
  });
});

describe('GET /api/settings/ai', () => {
  test('never sends the API keys to the client', async () => {
    (configHelper as any).__set({
      provider: 'gemini',
      providers: { gemini: { model: 'gemini-2.5-flash', apiKey: 'super-secret' } }
    });

    const response = await request(app).get('/api/settings/ai').expect(200);

    expect(JSON.stringify(response.body)).not.toContain('super-secret');
    expect(response.body.providers.gemini.hasApiKey).toBe(true);
  });
});

describe('/api/settings/sharepoint', () => {
  test('never sends the client secret to the client', async () => {
    (configHelper as any).__set({
      enabled: true,
      tenantId: 'tenant-id',
      clientId: 'client-id',
      siteUrl: 'https://acme.sharepoint.com/sites/QA'
    });
    (env as any).__set({ SHAREPOINT_CLIENT_SECRET: 'super-secret' });

    const response = await request(app).get('/api/settings/sharepoint').expect(200);

    expect(JSON.stringify(response.body)).not.toContain('super-secret');
    expect(response.body.hasClientSecret).toBe(true);
    expect(response.body.configured).toBe(true);
  });

  test('stores the settings, keeping the secret out of the config file', async () => {
    const response = await request(app)
      .put('/api/settings/sharepoint')
      .send({
        enabled: true,
        tenantId: 'tenant-id',
        clientId: 'client-id',
        clientSecret: 'super-secret',
        siteUrl: 'https://acme.sharepoint.com/sites/QA/',
        folderPath: '/Test reports/{environment}/'
      })
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain('super-secret');
    expect(response.body.siteUrl).toBe('https://acme.sharepoint.com/sites/QA');
    expect(response.body.folderPath).toBe('Test reports/{environment}');
    expect(JSON.stringify((configHelper as any).__get())).not.toContain('super-secret');
    expect((env as any).__get().SHAREPOINT_CLIENT_SECRET).toBe('super-secret');
  });

  test('answers 400 on settings that make no sense', async () => {
    const response = await request(app)
      .put('/api/settings/sharepoint')
      .send({ siteUrl: 'acme.sharepoint.com' })
      .expect(400);

    expect(response.body.error).toMatch(/must start with http/);
  });

  test('answers 400 without calling SharePoint when nothing is configured', async () => {
    const response = await request(app).post('/api/settings/sharepoint/test').expect(400);

    expect(response.body.error).toMatch(/tenant id/);
    expect(axios.post).not.toHaveBeenCalled();
  });
});
