import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Create axios instance with base configuration
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Generating a flow means waiting for a model to write a whole document —
// and, when the first answer is not valid, for a second attempt.
const AI_TIMEOUT = 240000;

// A pull or a push waits on the network, and on whatever the remote asks of
// the credential helper before that.
const GIT_TIMEOUT = 120000;

// Testing the SharePoint credentials signs in with Microsoft and then walks
// the site and its libraries: three round trips to another continent.
const SHAREPOINT_TIMEOUT = 90000;

// API methods
export const flowsApi = {
  list: () => api.get('/api/flows'),
  tree: () => api.get('/api/flows/tree'),
  parse: (value) => api.post('/api/flows/parse', { value }),
  createAI: (prompt) =>
    api.post('/api/flows/create/ai', { prompt }, { timeout: AI_TIMEOUT }),
  editAI: (prompt, content) =>
    api.post('/api/flows/edit/ai', { prompt, content }, { timeout: AI_TIMEOUT }),
  // { value, environment, path } runs here; with `agent` the committed copy
  // of `path` runs on that agent, followed over the same socket
  start: (data) => api.post('/api/flows/start', data),
  // What a running step is asking the person for, and the answer to it
  pendingInputs: () => api.get('/api/flows/input'),
  answerInput: (id, value) => api.post('/api/flows/input', { id, value }),
  cancelInput: (id) => api.post('/api/flows/input', { id, cancel: true }),
  getUserFlow: (path) => api.get(`/api/flows/user?path=${encodeURIComponent(path)}`),
  createFolder: (path) => api.post('/api/flows/folder', { path }),
  saveFile: (path, content, overwrite = false) =>
    api.post('/api/flows/file', { path, content, overwrite }),
  remove: (path) => api.delete('/api/flows/file', { data: { path } }),
  rename: (from, to) => api.post('/api/flows/rename', { from, to }),
  // Rewrite a markdown flow's frontmatter, leaving its body untouched
  saveProperties: (path, properties) =>
    api.put('/api/flows/properties', { path, properties }),
};

// The saved views a folder of flows is rendered with: one views.yaml for the
// whole context, in the shape Obsidian Bases uses.
export const viewsApi = {
  get: () => api.get('/api/views'),
  save: (document) => api.put('/api/views', document),
  query: (folder, view) =>
    api.get('/api/views/query', { params: { folder: folder || '', view: view || undefined } }),
  // The conjunctions and operators the filter editor draws itself from, so it
  // can never offer one the backend does not implement
  operators: () => api.get('/api/views/operators'),
  // How many flows a candidate view would list, without saving it
  preview: (folder, view, document) =>
    api.post('/api/views/preview', { folder: folder || '', view, document }),
};

// Recorded executions: every run (flow page, folder "Run all", CLI) lands in
// the context's test-runs folder, and these read it back.
export const testRunsApi = {
  list: () => api.get('/api/test-runs'),
  get: (id) => api.get(`/api/test-runs/${encodeURIComponent(id)}`),
  getFlow: (id, path) =>
    api.get(`/api/test-runs/${encodeURIComponent(id)}/flow?path=${encodeURIComponent(path)}`),
  // Run every flow a folder view matches, as one test run
  start: ({ environment, folder, view, files, agent }: {
    environment: string;
    folder?: string;
    view?: string;
    files?: string[];
    /** Run on this agent instead of here */
    agent?: string;
  }) => api.post('/api/test-runs', { environment, folder, view, files, agent }),
};

export const applicationsApi = {
  list: () => api.get('/api/applications'),
  create: (name) => api.post('/api/applications', { name }),
  get: (slug) => api.get(`/api/applications/${encodeURIComponent(slug)}`),
  listFiles: (slug) => api.get(`/api/applications/${encodeURIComponent(slug)}/files`),
  getFile: (slug, path) =>
    api.get(`/api/applications/${encodeURIComponent(slug)}/files/content?path=${encodeURIComponent(path)}`),
  saveFile: (slug, path, content) =>
    api.put(`/api/applications/${encodeURIComponent(slug)}/files/content`, { path, content }),
  createFile: (slug, path, content = '') =>
    api.post(`/api/applications/${encodeURIComponent(slug)}/files`, { path, content }),
  renameFile: (slug, from, to) =>
    api.post(`/api/applications/${encodeURIComponent(slug)}/files/rename`, { from, to }),
  deleteFile: (slug, path) =>
    api.delete(`/api/applications/${encodeURIComponent(slug)}/files/content?path=${encodeURIComponent(path)}`),
  rename: (slug, name) =>
    api.put(`/api/applications/${encodeURIComponent(slug)}/rename`, { name }),
  getEnvs: (slug) => api.get(`/api/applications/${encodeURIComponent(slug)}/envs`),
  updateEnvVariable: (slug, env, key, value) =>
    api.put(`/api/applications/${encodeURIComponent(slug)}/envs/${env}/${key}`, { value }),
  getRawEnv: (slug, env) => api.get(`/api/applications/${encodeURIComponent(slug)}/envs/${env}/raw`),
  updateRawEnv: (slug, env, content) =>
    api.put(`/api/applications/${encodeURIComponent(slug)}/envs/${env}/raw`, { content }),
};

// The context directory the app is working in, and the git repository it may
// live in. Pull/commit/push all act on that same folder.
export const contextApi = {
  get: () => api.get('/api/context'),
  pull: () => api.post('/api/context/git/pull', {}, { timeout: GIT_TIMEOUT }),
  commit: (message, paths) =>
    api.post('/api/context/git/commit', { message, paths }, { timeout: GIT_TIMEOUT }),
  push: () => api.post('/api/context/git/push', {}, { timeout: GIT_TIMEOUT }),
  branches: () => api.get('/api/context/git/branches'),
  checkout: (branch, options = {}) =>
    api.post('/api/context/git/checkout', { branch, ...options }, { timeout: GIT_TIMEOUT }),
  fetch: () => api.post('/api/context/git/fetch', {}, { timeout: GIT_TIMEOUT }),
};

export const environmentApi = {
  getAllPossible: () => api.get('/api/environment/all-possible'),
  // The env-files status: which .env files each application has, which are
  // missing, and which have a template to start from
  getStatus: () => api.get('/api/environment/status'),
  // What a flow needs before it can run on an environment: every application
  // it uses — and only those — has to have its env file for it. Ask with the
  // flow's markdown (value) or with the applications it uses.
  readiness: ({ environment, applications, value }: {
    environment: string;
    applications?: string[];
    value?: string;
  }) => api.post('/api/environment/readiness', { environment, applications, value }),
  createMissing: (options = {}) => api.post('/api/environment/create-missing', options),
  // Exchanging the values of the env files between developers. The tree is
  // names only; the values travel in the document the export answers with.
  variables: () => api.get('/api/environment/variables'),
  exportVariables: (selection: Array<{ application: string; environment: string; keys?: string[] }>) =>
    api.post('/api/environment/export', { selection }),
  // dryRun answers with the same report, having written nothing
  importVariables: (yaml: string, options: { dryRun?: boolean } = {}) =>
    api.post('/api/environment/import', { yaml, dryRun: Boolean(options.dryRun) }),
};

export const settingsApi = {
  getAI: () => api.get('/api/settings/ai'),
  saveAI: (settings) => api.put('/api/settings/ai', settings),
  testAI: (provider) =>
    api.post('/api/settings/ai/test', { provider }, { timeout: AI_TIMEOUT }),
  listAIModels: (provider) =>
    api.get(`/api/settings/ai/models/${encodeURIComponent(provider)}`),
  getJira: () => api.get('/api/settings/jira'),
  saveJira: (settings) => api.put('/api/settings/jira', settings),
  testJira: () => api.post('/api/settings/jira/test'),
  // The pull answers as soon as it starts; its progress arrives over the
  // socket as "xraypull:update", and getJiraPull() is the fallback for a UI
  // that opened halfway through
  pullJira: () => api.post('/api/settings/jira/pull'),
  getJiraPull: () => api.get('/api/settings/jira/pull'),
  cancelJiraPull: () => api.delete('/api/settings/jira/pull'),
  getSharepoint: () => api.get('/api/settings/sharepoint'),
  saveSharepoint: (settings) => api.put('/api/settings/sharepoint', settings),
  // Signs in and resolves the site and library for real: give it the room a
  // round trip to Microsoft needs
  testSharepoint: () => api.post('/api/settings/sharepoint/test', {}, { timeout: SHAREPOINT_TIMEOUT }),
  // Remote agents: the MQTT broker this UI listens to. The password is
  // write-only; the agents seen so far come with the settings and, live, over
  // the socket as "agents:update"
  getRemote: () => api.get('/api/settings/remote'),
  saveRemote: (settings) => api.put('/api/settings/remote', settings),
  testRemote: () => api.post('/api/settings/remote/test'),
  remoteAgents: () => api.get('/api/settings/remote/agents'),
  forgetRemoteAgentKey: (id) =>
    api.delete(`/api/settings/remote/agents/${encodeURIComponent(id)}/key`),
};

export const jiraApi = {
  // Xray data for the tests a flow points at. The backend caches every key
  // for the life of the process, so this is cheap after the first call.
  getTests: (keys) =>
    api.get(`/api/jira/tests?keys=${encodeURIComponent(keys.join(','))}`),
};

export default api;
