jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import YAML from 'yaml';

const CONTEXT = fs.mkdtempSync(path.join(os.tmpdir(), 'env-transfer-api-'));
jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (parts) => require('path').join(CONTEXT, ...(parts || []))
}));

import environment from '../../src/api/routes/environment';

// The helpers are not mocked here: what is being checked is the whole way
// from the request the card makes to the env files on disk.
const app = express();
app.use(express.json());
app.use((req, _res, next) => { if (req.body === undefined) { req.body = {}; } next(); });
app.use('/api/environment', environment);

const appsDir = path.join(CONTEXT, 'applications');

const write = (relative: string, content = '') => {
  const file = path.join(appsDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
};

const read = (relative: string) => fs.readFileSync(path.join(appsDir, relative), 'utf8');

beforeEach(() => {
  fs.rmSync(appsDir, { recursive: true, force: true });
  fs.mkdirSync(appsDir, { recursive: true });
});

afterAll(() => fs.rmSync(CONTEXT, { recursive: true, force: true }));

describe('exchanging environment variables over the API', () => {
  test('the tree, the document it produces, and the files that document writes', async () => {
    write('payments/env/uat.env', '# The payments API\nAPI_URL=https://uat\nAPI_TOKEN=abc123\n');
    write('checkout/env/uat.env', 'TIMEOUT=3000\n');
    // The other side of the exchange: same applications, no uat file yet
    write('shipping/README.md', '# shipping');

    const tree = await request(app).get('/api/environment/variables');

    expect(tree.status).toBe(200);
    expect(tree.body.applications.map(item => item.slug)).toEqual(['checkout', 'payments']);
    expect(tree.body.applications[1].environments[0].variables).toEqual([
      { key: 'API_URL', empty: false, secret: false },
      { key: 'API_TOKEN', empty: false, secret: true }
    ]);

    const exported = await request(app)
      .post('/api/environment/export')
      .send({
        selection: [
          { application: 'payments', environment: 'uat', keys: ['API_TOKEN'] },
          { application: 'checkout', environment: 'uat' }
        ]
      });

    expect(exported.status).toBe(200);
    expect(exported.body.summary).toEqual({ applications: 2, environments: 2, variables: 2 });

    // What the receiving side pastes, aimed at the application that needs it
    const document = exported.body.yaml.replace('  payments:', '  shipping:');

    const preview = await request(app)
      .post('/api/environment/import')
      .send({ yaml: document, dryRun: true });

    expect(preview.status).toBe(200);
    expect(preview.body.summary).toMatchObject({ files: 2, created: 1, added: 1, unchanged: 1 });
    // Both files the document names are listed -- checkout among them, which
    // already holds that value and so is nothing to write
    expect(preview.body.files.map(file => file.file)).toEqual([
      'applications/checkout/env/uat.env',
      'applications/shipping/env/uat.env'
    ]);
    expect(preview.body.files[0]).toMatchObject({ added: [], changed: [], unchanged: ['TIMEOUT'] });
    expect(fs.existsSync(path.join(appsDir, 'shipping/env/uat.env'))).toBe(false);

    const imported = await request(app)
      .post('/api/environment/import')
      .send({ yaml: document });

    expect(imported.status).toBe(200);
    expect(imported.body.success).toBe(true);
    expect(read('shipping/env/uat.env')).toBe('API_TOKEN=abc123\n');

    // The application it was exported from is untouched by its own document
    expect(read('payments/env/uat.env'))
      .toBe('# The payments API\nAPI_URL=https://uat\nAPI_TOKEN=abc123\n');
  });

  test('an import updates an existing file in place, and says what it did', async () => {
    write('payments/env/uat.env', '# The payments API\nAPI_URL=https://old\nKEPT=yes\n');

    const response = await request(app)
      .post('/api/environment/import')
      .send({
        yaml: YAML.stringify({
          applications: { payments: { uat: { API_URL: 'https://uat', API_TOKEN: 'abc' } } }
        })
      });

    expect(response.status).toBe(200);
    expect(response.body.files[0]).toMatchObject({
      file: 'applications/payments/env/uat.env',
      created: false,
      added: ['API_TOKEN'],
      changed: ['API_URL']
    });

    expect(read('payments/env/uat.env')).toBe(
      '# The payments API\nAPI_URL=https://uat\nKEPT=yes\nAPI_TOKEN=abc\n'
    );
  });

  test('a document that cannot be read is a 400, and writes nothing', async () => {
    write('payments/env/uat.env', 'A=1\n');

    const response = await request(app)
      .post('/api/environment/import')
      .send({ yaml: 'applications: [oops' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Invalid YAML/);
    expect(read('payments/env/uat.env')).toBe('A=1\n');
  });

  test('exporting nothing is a 400 rather than an empty document', async () => {
    const response = await request(app).post('/api/environment/export').send({ selection: [] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/at least one variable/i);
  });
});
