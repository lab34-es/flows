// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

// Every route delegates to a helper; the helpers have their own suites, so
// here we only assert the HTTP contract: status codes, shapes and error mapping.
jest.mock('../../src/helpers/flows');
jest.mock('../../src/helpers/inputs');
jest.mock('../../src/helpers/bases');
jest.mock('../../src/helpers/jira');
jest.mock('../../src/helpers/applications');
jest.mock('../../src/helpers/context');
jest.mock('../../src/helpers/testRuns');

import express from 'express';
import request from 'supertest';

import * as flows from '../../src/helpers/flows';
import * as inputs from '../../src/helpers/inputs';
import * as bases from '../../src/helpers/bases';
import * as jira from '../../src/helpers/jira';
import * as apps from '../../src/helpers/applications';
import * as contextHelper from '../../src/helpers/context';
import * as testRuns from '../../src/helpers/testRuns';

import defineRoutes from '../../src/api/routes';

const app = express();
app.use(express.json());
defineRoutes(app);

beforeEach(() => jest.clearAllMocks());

describe('GET /api/flows', () => {
  test('returns the list', async () => {
    (flows.list as jest.Mock).mockResolvedValue([{ name: 'a.md' }]);
    const res = await request(app).get('/api/flows');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ name: 'a.md' }]);
  });

  test('a helper failure becomes a 500', async () => {
    (flows.list as jest.Mock).mockRejectedValue(new Error('disk gone'));
    const res = await request(app).get('/api/flows');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'disk gone' });
  });
});

describe('GET /api/flows/tree', () => {
  test('returns the tree', async () => {
    (flows.tree as jest.Mock).mockResolvedValue([{ type: 'folder', name: 'examples' }]);
    const res = await request(app).get('/api/flows/tree');
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('examples');
  });

  test('a helper failure becomes a 500', async () => {
    (flows.tree as jest.Mock).mockRejectedValue(new Error('nope'));
    expect((await request(app).get('/api/flows/tree')).status).toBe(500);
  });
});

describe('POST /api/flows/parse', () => {
  test('passes the value through to the parser', async () => {
    (flows.parseValue as jest.Mock).mockReturnValue({ steps: [] });
    const res = await request(app).post('/api/flows/parse').send({ value: '# t' });
    expect(res.status).toBe(200);
    expect(flows.parseValue).toHaveBeenCalledWith('# t');
  });

  test('defaults to an empty value', async () => {
    (flows.parseValue as jest.Mock).mockReturnValue({});
    await request(app).post('/api/flows/parse').send({});
    expect(flows.parseValue).toHaveBeenCalledWith('');
  });

  test('a parse error becomes a 400', async () => {
    (flows.parseValue as jest.Mock).mockImplementation(() => { throw new Error('bad flow'); });
    const res = await request(app).post('/api/flows/parse').send({ value: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'bad flow' });
  });
});

describe('AI flow routes', () => {
  test('POST /create/ai returns the generated flow', async () => {
    (flows.createAI as jest.Mock).mockResolvedValue({ content: '# generated' });
    const res = await request(app).post('/api/flows/create/ai').send({ prompt: 'p' });
    expect(res.status).toBe(200);
    expect(flows.createAI).toHaveBeenCalledWith({ prompt: 'p' });
  });

  test('POST /create/ai maps a failure to 400', async () => {
    (flows.createAI as jest.Mock).mockRejectedValue(new Error('no provider'));
    const res = await request(app).post('/api/flows/create/ai').send({ prompt: 'p' });
    expect(res.status).toBe(400);
  });

  test('POST /edit/ai returns the rewritten flow', async () => {
    (flows.editAI as jest.Mock).mockResolvedValue({ content: '# edited' });
    const res = await request(app).post('/api/flows/edit/ai').send({ prompt: 'p', content: 'c' });
    expect(res.status).toBe(200);
  });

  test('POST /edit/ai maps a failure to 400', async () => {
    (flows.editAI as jest.Mock).mockRejectedValue(new Error('boom'));
    expect((await request(app).post('/api/flows/edit/ai').send({})).status).toBe(400);
  });
});

describe('POST /api/flows/start', () => {
  test('answers with just the execution handle', async () => {
    (flows.start as jest.Mock).mockResolvedValue({ execution: { id: 'exec-1' }, steps: ['lots'] });
    const res = await request(app).post('/api/flows/start').send({ path: 'a.md' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ execution: { id: 'exec-1' } });
  });

  test('a failure to start maps to 400', async () => {
    (flows.start as jest.Mock).mockRejectedValue(new Error('already running'));
    const res = await request(app).post('/api/flows/start').send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'already running' });
  });
});

describe('/api/flows/input', () => {
  test('lists what a running flow is waiting for', async () => {
    (inputs.list as jest.Mock).mockReturnValue([{ id: 'req-1', label: 'Barcode' }]);
    const res = await request(app).get('/api/flows/input');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ inputs: [{ id: 'req-1', label: 'Barcode' }] });
  });

  test('answering resumes the step that asked', async () => {
    (inputs.answer as jest.Mock).mockReturnValue(true);
    const res = await request(app).post('/api/flows/input').send({ id: 'req-1', value: 'AC001' });
    expect(res.status).toBe(200);
    expect(inputs.answer).toHaveBeenCalledWith('req-1', 'AC001');
  });

  test('cancelling gives up on the request instead of answering it', async () => {
    (inputs.cancel as jest.Mock).mockReturnValue(true);
    const res = await request(app).post('/api/flows/input').send({ id: 'req-1', cancel: true });
    expect(res.status).toBe(200);
    expect(inputs.cancel).toHaveBeenCalledWith('req-1', 'Input was cancelled');
    expect(inputs.answer).not.toHaveBeenCalled();
  });

  test('a request nobody is waiting for is a 404', async () => {
    (inputs.answer as jest.Mock).mockReturnValue(false);
    const res = await request(app).post('/api/flows/input').send({ id: 'gone', value: 'x' });
    expect(res.status).toBe(404);
  });

  test('an answer without an id is a 400', async () => {
    const res = await request(app).post('/api/flows/input').send({ value: 'x' });
    expect(res.status).toBe(400);
    expect(inputs.answer).not.toHaveBeenCalled();
  });
});

describe('GET /api/flows/user', () => {
  test('reads the flow at the given path', async () => {
    (flows.getUserFlow as jest.Mock).mockResolvedValue({ title: 'T' });
    const res = await request(app).get('/api/flows/user').query({ path: 'examples/a.md' });
    expect(res.status).toBe(200);
    expect(flows.getUserFlow).toHaveBeenCalledWith('examples/a.md');
  });

  test('a missing flow is a 404', async () => {
    (flows.getUserFlow as jest.Mock).mockRejectedValue(new Error('not found'));
    const res = await request(app).get('/api/flows/user').query({ path: 'nope.md' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found' });
  });
});

describe('flow file and folder routes', () => {
  test('POST /folder creates a folder', async () => {
    (flows.createFolder as jest.Mock).mockResolvedValue({ relativePath: 'new' });
    const res = await request(app).post('/api/flows/folder').send({ path: 'new' });
    expect(res.body).toEqual({ success: true, relativePath: 'new' });
    expect(flows.createFolder).toHaveBeenCalledWith('new');
  });

  test('POST /file forwards path, content and overwrite', async () => {
    (flows.saveFile as jest.Mock).mockResolvedValue({ relativePath: 'a.md' });
    await request(app).post('/api/flows/file').send({ path: 'a.md', content: '# t', overwrite: true });
    expect(flows.saveFile).toHaveBeenCalledWith({
      relativePath: 'a.md', content: '# t', overwrite: true
    });
  });

  test('POST /file defaults overwrite to false', async () => {
    (flows.saveFile as jest.Mock).mockResolvedValue({});
    await request(app).post('/api/flows/file').send({ path: 'a.md', content: 'x' });
    expect((flows.saveFile as jest.Mock).mock.calls[0][0].overwrite).toBe(false);
  });

  test('an existing file maps EEXISTS to 409', async () => {
    const error: NodeJS.ErrnoException = new Error('File already exists');
    error.code = 'EEXISTS';
    (flows.saveFile as jest.Mock).mockRejectedValue(error);
    const res = await request(app).post('/api/flows/file').send({ path: 'a.md' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'File already exists' });
  });

  test('PUT /properties rewrites the frontmatter', async () => {
    (flows.saveProperties as jest.Mock).mockResolvedValue({ relativePath: 'a.md' });
    await request(app).put('/api/flows/properties').send({ path: 'a.md', properties: { title: 'T' } });
    expect(flows.saveProperties).toHaveBeenCalledWith({
      relativePath: 'a.md', properties: { title: 'T' }
    });
  });

  test('POST /rename moves a file', async () => {
    (flows.rename as jest.Mock).mockResolvedValue({ relativePath: 'b.md' });
    await request(app).post('/api/flows/rename').send({ from: 'a.md', to: 'b.md' });
    expect(flows.rename).toHaveBeenCalledWith('a.md', 'b.md');
  });

  test('DELETE /file accepts the path in the body', async () => {
    (flows.remove as jest.Mock).mockResolvedValue({ removed: true });
    const res = await request(app).delete('/api/flows/file').send({ path: 'a.md' });
    expect(res.body).toEqual({ success: true, removed: true });
    expect(flows.remove).toHaveBeenCalledWith('a.md');
  });

  test('DELETE /file falls back to the query string', async () => {
    (flows.remove as jest.Mock).mockResolvedValue({ removed: true });
    await request(app).delete('/api/flows/file').query({ path: 'q.md' });
    expect(flows.remove).toHaveBeenCalledWith('q.md');
  });

  test('a non-Error rejection still produces a message', async () => {
    (flows.remove as jest.Mock).mockRejectedValue('plain string');
    const res = await request(app).delete('/api/flows/file').send({ path: 'a.md' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'plain string' });
  });
});

describe('/api/views', () => {
  test('GET returns the views document', async () => {
    (bases.load as jest.Mock).mockResolvedValue({ views: [{ name: 'All' }] });
    const res = await request(app).get('/api/views');
    expect(res.status).toBe(200);
    expect(res.body.views[0].name).toBe('All');
  });

  test('GET maps a read failure to 500', async () => {
    (bases.load as jest.Mock).mockRejectedValue(new Error('bad yaml'));
    expect((await request(app).get('/api/views')).status).toBe(500);
  });

  test('PUT saves and returns the normalized document', async () => {
    (bases.save as jest.Mock).mockResolvedValue({ views: [] });
    const res = await request(app).put('/api/views').send({ views: [] });
    expect(res.status).toBe(200);
    expect(bases.save).toHaveBeenCalledWith({ views: [] });
  });

  test('PUT maps a save failure to 400', async () => {
    (bases.save as jest.Mock).mockRejectedValue(new Error('invalid'));
    expect((await request(app).put('/api/views').send({})).status).toBe(400);
  });

  test('GET /query passes folder and view through', async () => {
    (bases.query as jest.Mock).mockResolvedValue({ rows: [] });
    await request(app).get('/api/views/query').query({ folder: 'payments', view: 'All' });
    expect(bases.query).toHaveBeenCalledWith({ folder: 'payments', view: 'All' });
  });

  test('GET /query defaults folder to the whole tree and leaves view unset', async () => {
    (bases.query as jest.Mock).mockResolvedValue({ rows: [] });
    await request(app).get('/api/views/query');
    expect(bases.query).toHaveBeenCalledWith({ folder: '', view: undefined });
  });

  test('GET /query maps an evaluation failure to 400', async () => {
    (bases.query as jest.Mock).mockRejectedValue(new Error('bad formula'));
    expect((await request(app).get('/api/views/query')).status).toBe(400);
  });
});

describe('/api/test-runs', () => {
  test('GET returns the run list', async () => {
    (testRuns.list as jest.Mock).mockResolvedValue([{ id: '2026-08-20_10-00-00', status: 'passed' }]);
    const res = await request(app).get('/api/test-runs');
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe('2026-08-20_10-00-00');
  });

  test('GET maps a read failure to 500', async () => {
    (testRuns.list as jest.Mock).mockRejectedValue(new Error('disk gone'));
    expect((await request(app).get('/api/test-runs')).status).toBe(500);
  });

  test('POST starts a folder run and answers with it', async () => {
    (testRuns.startFolderRun as jest.Mock).mockResolvedValue({ id: 'r1', status: 'running' });

    const res = await request(app)
      .post('/api/test-runs')
      .send({ environment: 'local', folder: 'payments', view: 'All', files: ['payments/a.md'] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ run: { id: 'r1', status: 'running' } });
    expect(testRuns.startFolderRun).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'local',
      folder: 'payments',
      view: 'All',
      files: ['payments/a.md']
    }));
  });

  test('POST maps a refusal to 400', async () => {
    (testRuns.startFolderRun as jest.Mock).mockRejectedValue(new Error('No flows to run'));
    const res = await request(app).post('/api/test-runs').send({ environment: 'local' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'No flows to run' });
  });

  test('GET /:id answers the run summary', async () => {
    (testRuns.get as jest.Mock).mockResolvedValue({ id: 'r1', flows: [] });
    const res = await request(app).get('/api/test-runs/r1');
    expect(res.status).toBe(200);
    expect(testRuns.get).toHaveBeenCalledWith('r1');
  });

  test('GET /:id maps a missing run to 404', async () => {
    (testRuns.get as jest.Mock).mockRejectedValue(new Error('Test run not found'));
    const res = await request(app).get('/api/test-runs/nope');
    expect(res.status).toBe(404);
  });

  test('GET /:id/report answers the report as HTML', async () => {
    (testRuns.report as jest.Mock).mockResolvedValue('<!DOCTYPE html><html></html>');
    const res = await request(app).get('/api/test-runs/r1/report');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<!DOCTYPE html>');
    expect(testRuns.report).toHaveBeenCalledWith('r1');
  });

  test('GET /:id/report maps a missing run to 404', async () => {
    (testRuns.report as jest.Mock).mockRejectedValue(new Error('Test run not found'));
    expect((await request(app).get('/api/test-runs/nope/report')).status).toBe(404);
  });

  test('GET /:id/flow passes the id and the file through', async () => {
    (testRuns.getFlow as jest.Mock).mockResolvedValue({ title: 'A', results: {} });
    const res = await request(app).get('/api/test-runs/r1/flow').query({ path: 'payments/a.md' });
    expect(res.status).toBe(200);
    expect(testRuns.getFlow).toHaveBeenCalledWith('r1', 'payments/a.md');
  });

  test('GET /:id/flow maps a missing copy to 404', async () => {
    (testRuns.getFlow as jest.Mock).mockRejectedValue(new Error('Flow not found'));
    expect((await request(app).get('/api/test-runs/r1/flow')).status).toBe(404);
  });
});

describe('/api/jira/tests', () => {
  test('splits, trims and drops empty keys', async () => {
    (jira.getTests as jest.Mock).mockResolvedValue({});
    await request(app).get('/api/jira/tests').query({ keys: 'ABC-1, ABC-2 ,,' });
    expect(jira.getTests).toHaveBeenCalledWith(['ABC-1', 'ABC-2']);
  });

  test('no keys at all asks for an empty list', async () => {
    (jira.getTests as jest.Mock).mockResolvedValue({});
    await request(app).get('/api/jira/tests');
    expect(jira.getTests).toHaveBeenCalledWith([]);
  });

  test('a Jira failure maps to 500', async () => {
    (jira.getTests as jest.Mock).mockRejectedValue(new Error('unauthorized'));
    const res = await request(app).get('/api/jira/tests').query({ keys: 'ABC-1' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });
});

describe('/api/environment/all-possible', () => {
  test('returns the environment names', async () => {
    (apps.allPossibleEnvironments as jest.Mock).mockResolvedValue(['local', 'prod']);
    const res = await request(app).get('/api/environment/all-possible');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(['local', 'prod']);
  });

  test('a failure maps to 500 with a generic message', async () => {
    (apps.allPossibleEnvironments as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/environment/all-possible');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch environments' });
  });
});

describe('GET /api/environment/status', () => {
  test('returns the env-files matrix', async () => {
    const status = { environments: ['local'], applications: [], summary: { total: 0, missing: 0, creatable: 0, incomplete: 0 } };
    (apps.environmentsStatus as jest.Mock).mockResolvedValue(status);
    const res = await request(app).get('/api/environment/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(status);
  });

  test('a failure maps to 500 with a generic message', async () => {
    (apps.environmentsStatus as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/environment/status');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to fetch environments status' });
  });
});

describe('POST /api/environment/create-missing', () => {
  test('creates the missing files, passing the narrowing through', async () => {
    const created = [{ application: 'a', environment: 'prod', path: '/x/prod.env' }];
    (apps.createMissingEnvFiles as jest.Mock).mockResolvedValue(created);

    const res = await request(app)
      .post('/api/environment/create-missing')
      .send({ environment: 'prod', application: 'a' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, created });
    expect(apps.createMissingEnvFiles).toHaveBeenCalledWith({ environment: 'prod', application: 'a' });
  });

  test('a failure maps to 500 with a generic message', async () => {
    (apps.createMissingEnvFiles as jest.Mock).mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/environment/create-missing').send({});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to create missing env files' });
  });
});

describe('POST /api/environment/add', () => {
  test('adds the environment to every application', async () => {
    const created = [{ application: 'a', environment: 'staging', path: '/x/staging.env' }];
    (apps.addEnvironmentToAll as jest.Mock).mockResolvedValue(created);

    const res = await request(app)
      .post('/api/environment/add')
      .send({ name: 'staging', baseEnvironment: 'local' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, created });
    expect(apps.addEnvironmentToAll).toHaveBeenCalledWith('staging', 'local');
  });

  test('an invalid name maps to 400 with the message', async () => {
    (apps.addEnvironmentToAll as jest.Mock).mockRejectedValue(new Error('Invalid environment name'));
    const res = await request(app).post('/api/environment/add').send({ name: '../evil' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid environment name' });
  });

  test('any other failure maps to 500', async () => {
    (apps.addEnvironmentToAll as jest.Mock).mockRejectedValue(new Error('disk gone'));
    const res = await request(app).post('/api/environment/add').send({ name: 'staging' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'disk gone' });
  });
});

describe('/api/context', () => {
  test('returns the directory and its git state', async () => {
    (contextHelper.info as jest.Mock).mockResolvedValue({
      path: '/home/someone/lab34-flows',
      name: 'lab34-flows',
      custom: false,
      git: { branch: 'main', changes: [] }
    });

    const res = await request(app).get('/api/context');

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('lab34-flows');
    expect(res.body.git.branch).toBe('main');
  });

  test('a failure maps to 500', async () => {
    (contextHelper.info as jest.Mock).mockRejectedValue(new Error('no such directory'));
    const res = await request(app).get('/api/context');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'no such directory' });
  });
});

describe('/api/context/git', () => {
  test('pull answers with what git printed', async () => {
    (contextHelper.pull as jest.Mock).mockResolvedValue({ output: 'Already up to date.' });
    const res = await request(app).post('/api/context/git/pull');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, output: 'Already up to date.' });
  });

  test('commit passes the message and the selected paths through', async () => {
    (contextHelper.commit as jest.Mock).mockResolvedValue({ output: '1 file changed' });

    const res = await request(app)
      .post('/api/context/git/commit')
      .send({ message: 'update the login flow', paths: ['flows/login.md'] });

    expect(res.status).toBe(200);
    expect(contextHelper.commit).toHaveBeenCalledWith({
      message: 'update the login flow',
      paths: ['flows/login.md']
    });
  });

  test('a git failure is a 400 carrying its message', async () => {
    (contextHelper.commit as jest.Mock).mockRejectedValue(new Error('Nothing staged to commit'));
    const res = await request(app).post('/api/context/git/commit').send({ message: 'x' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Nothing staged to commit' });
  });

  test('push answers the same way', async () => {
    (contextHelper.push as jest.Mock).mockResolvedValue({ output: 'To github.com' });
    const res = await request(app).post('/api/context/git/push');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('a push with no remote is a 400', async () => {
    (contextHelper.push as jest.Mock).mockRejectedValue(new Error('This repository has no remote to push to'));
    const res = await request(app).post('/api/context/git/push');
    expect(res.status).toBe(400);
  });

  test('branches answers with the list the menu draws', async () => {
    (contextHelper.branches as jest.Mock).mockResolvedValue({
      current: 'main',
      local: [{ name: 'main', current: true, upstream: 'origin/main', remote: null, local: null }],
      remote: []
    });

    const res = await request(app).get('/api/context/git/branches');

    expect(res.status).toBe(200);
    expect(res.body.current).toBe('main');
    expect(res.body.local).toHaveLength(1);
  });

  test('checkout passes the branch and how to reach it through', async () => {
    (contextHelper.checkout as jest.Mock).mockResolvedValue({
      output: "Switched to a new branch 'feature'",
      branch: 'feature'
    });

    const res = await request(app)
      .post('/api/context/git/checkout')
      .send({ branch: 'feature', create: true, from: 'main' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      output: "Switched to a new branch 'feature'",
      branch: 'feature'
    });
    expect(contextHelper.checkout).toHaveBeenCalledWith({
      branch: 'feature',
      create: true,
      from: 'main'
    });
  });

  test('a checkout git refuses is a 400 carrying its reason', async () => {
    (contextHelper.checkout as jest.Mock).mockRejectedValue(
      new Error('Your local changes would be overwritten')
    );

    const res = await request(app).post('/api/context/git/checkout').send({ branch: 'other' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Your local changes would be overwritten' });
  });

  test('fetch answers with what git printed', async () => {
    (contextHelper.fetch as jest.Mock).mockResolvedValue({ output: '* [new branch] theirs' });
    const res = await request(app).post('/api/context/git/fetch');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, output: '* [new branch] theirs' });
  });
});
