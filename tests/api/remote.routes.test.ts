jest.mock('yargs-parser', () => () => ({}));

jest.mock('../../src/helpers/remote/relay', () => ({
  getSettings: jest.fn(),
  saveSettings: jest.fn(),
  test: jest.fn(),
  list: jest.fn(() => []),
  forgetAgent: jest.fn(),
  startFlow: jest.fn(),
  startFolderRun: jest.fn(),
  answerInput: jest.fn(() => false),
  listInputs: jest.fn(() => [])
}));
jest.mock('../../src/helpers/flows', () => ({ start: jest.fn() }));
jest.mock('../../src/helpers/testRuns', () => ({ startFolderRun: jest.fn(), list: jest.fn() }));
jest.mock('../../src/helpers/inputs', () => ({
  list: jest.fn(() => []),
  answer: jest.fn(() => false),
  cancel: jest.fn(() => false)
}));
// The settings router also mounts the AI, Jira and SharePoint routes
jest.mock('../../src/helpers/ai', () => ({}));
jest.mock('../../src/helpers/jira', () => ({}));
jest.mock('../../src/helpers/sharepoint', () => ({}));

import express from 'express';
import request from 'supertest';

import * as relay from '../../src/helpers/remote/relay';
import * as flows from '../../src/helpers/flows';
import * as testRuns from '../../src/helpers/testRuns';
import * as inputs from '../../src/helpers/inputs';
import settings from '../../src/api/routes/settings';
import flowsRoutes from '../../src/api/routes/flows';
import testRunsRoutes from '../../src/api/routes/testRuns';

const io = { emit: jest.fn() };
const app = express();
app.use(express.json());
app.set('io', io);
app.use('/api/settings', settings);
app.use('/api/flows', flowsRoutes);
app.use('/api/test-runs', testRunsRoutes);

describe('/api/settings/remote', () => {
  test('reads and writes the broker settings through the relay', async () => {
    (relay.getSettings as jest.Mock).mockResolvedValue({ configured: false, agents: [] });
    const read = await request(app).get('/api/settings/remote');
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ configured: false, agents: [] });

    (relay.saveSettings as jest.Mock).mockResolvedValue({ configured: true });
    const written = await request(app).put('/api/settings/remote').send({ url: 'mqtts://x:443', password: 'pw' });
    expect(written.status).toBe(200);
    expect(relay.saveSettings).toHaveBeenCalledWith({ url: 'mqtts://x:443', password: 'pw' });

    (relay.saveSettings as jest.Mock).mockRejectedValue(new Error('must start with mqtt://'));
    const refused = await request(app).put('/api/settings/remote').send({ url: 'https://x' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain('must start with mqtt://');

    (relay.getSettings as jest.Mock).mockRejectedValue(new Error('disk'));
    expect((await request(app).get('/api/settings/remote')).status).toBe(500);
  });

  test('tests the connection and lists the agents', async () => {
    (relay.test as jest.Mock).mockResolvedValue({ message: 'Connected' });
    const ok = await request(app).post('/api/settings/remote/test');
    expect(ok.body).toEqual({ success: true, message: 'Connected' });

    (relay.test as jest.Mock).mockRejectedValue(new Error('Not authorized'));
    const failed = await request(app).post('/api/settings/remote/test');
    expect(failed.status).toBe(400);
    expect(failed.body.error).toBe('Not authorized');

    (relay.list as jest.Mock).mockReturnValue([{ agent: 'a1', online: true }]);
    const agents = await request(app).get('/api/settings/remote/agents');
    expect(agents.body).toEqual({ agents: [{ agent: 'a1', online: true }] });
  });

  test('forgets an agent key', async () => {
    (relay.forgetAgent as jest.Mock).mockResolvedValue(undefined);
    const ok = await request(app).delete('/api/settings/remote/agents/a1/key');
    expect(ok.body).toEqual({ success: true });
    expect(relay.forgetAgent).toHaveBeenCalledWith('a1');

    (relay.forgetAgent as jest.Mock).mockRejectedValue(new Error('disk'));
    expect((await request(app).delete('/api/settings/remote/agents/a1/key')).status).toBe(400);
  });
});

describe('POST /api/flows/start with an agent', () => {
  test('goes to the relay instead of the local runner', async () => {
    (relay.startFlow as jest.Mock).mockResolvedValue({ execution: { id: 'exec-1' } });

    const response = await request(app).post('/api/flows/start')
      .send({ value: '# x', environment: 'uat', path: 'refund.md', agent: 'agent-ourense' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ execution: { id: 'exec-1' } });
    expect(relay.startFlow).toHaveBeenCalledWith({ agent: 'agent-ourense', environment: 'uat', path: 'refund.md' });
    expect(flows.start).not.toHaveBeenCalled();
  });

  test('without an agent, nothing changes', async () => {
    (flows.start as jest.Mock).mockResolvedValue({ execution: { id: 'local' } });

    const response = await request(app).post('/api/flows/start').send({ value: '# x', environment: 'uat' });

    expect(response.body).toEqual({ execution: { id: 'local' } });
    expect(flows.start).toHaveBeenCalledWith({ value: '# x', environment: 'uat' }, { io });
    expect(relay.startFlow).not.toHaveBeenCalled();
  });

  test('an agent that cannot take the flow is a 400', async () => {
    (relay.startFlow as jest.Mock).mockRejectedValue(new Error('Agent "agent-ourense" is offline'));
    const response = await request(app).post('/api/flows/start')
      .send({ environment: 'uat', path: 'refund.md', agent: 'agent-ourense' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('is offline');
  });
});

describe('/api/flows/input with remote steps', () => {
  test('lists the questions of local and remote steps together', async () => {
    (inputs.list as jest.Mock).mockReturnValue([{ id: 'local-1' }]);
    (relay.listInputs as jest.Mock).mockReturnValue([{ id: 'remote-1' }]);

    const response = await request(app).get('/api/flows/input');
    expect(response.body).toEqual({ inputs: [{ id: 'local-1' }, { id: 'remote-1' }] });
  });

  test('an answer nobody local is waiting for goes to the relay', async () => {
    (relay.answerInput as jest.Mock).mockReturnValue(true);

    const answered = await request(app).post('/api/flows/input').send({ id: 'remote-1', value: '4711' });
    expect(answered.body).toEqual({ success: true });
    expect(relay.answerInput).toHaveBeenCalledWith('remote-1', '4711', false);

    const cancelled = await request(app).post('/api/flows/input').send({ id: 'remote-1', cancel: true });
    expect(cancelled.body).toEqual({ success: true });
    expect(relay.answerInput).toHaveBeenCalledWith('remote-1', undefined, true);

    (relay.answerInput as jest.Mock).mockReturnValue(false);
    expect((await request(app).post('/api/flows/input').send({ id: 'gone', value: 'x' })).status).toBe(404);
  });
});

describe('POST /api/test-runs with an agent', () => {
  test('goes to the relay instead of the local runner', async () => {
    (relay.startFolderRun as jest.Mock).mockResolvedValue({ id: 'run-1', status: 'running' });

    const response = await request(app).post('/api/test-runs')
      .send({ environment: 'uat', folder: 'payments', view: 'smoke', files: ['a.md'], agent: 'agent-ourense' });

    expect(response.body).toEqual({ run: { id: 'run-1', status: 'running' } });
    expect(relay.startFolderRun).toHaveBeenCalledWith({
      agent: 'agent-ourense', environment: 'uat', folder: 'payments', view: 'smoke', files: ['a.md']
    });
    expect(testRuns.startFolderRun).not.toHaveBeenCalled();
  });

  test('without an agent, nothing changes', async () => {
    (testRuns.startFolderRun as jest.Mock).mockResolvedValue({ id: 'run-2' });

    const response = await request(app).post('/api/test-runs').send({ environment: 'uat' });

    expect(response.body).toEqual({ run: { id: 'run-2' } });
    expect(testRuns.startFolderRun).toHaveBeenCalledWith(expect.objectContaining({ environment: 'uat', io }));
  });

  test('an agent that cannot take the run is a 400', async () => {
    (relay.startFolderRun as jest.Mock).mockRejectedValue(new Error('is busy'));
    const response = await request(app).post('/api/test-runs').send({ environment: 'uat', agent: 'a1' });
    expect(response.status).toBe(400);
  });
});
