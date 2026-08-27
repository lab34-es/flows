import express from 'express';
const router = express.Router();

import * as ai from '../../helpers/ai';
import * as jira from '../../helpers/jira';
import * as sharepoint from '../../helpers/sharepoint';

const sendError = (res, error, status = 400) => {
  const message = (error && error.message) || String(error);
  res.status(status).send({ error: message });
};

// AI provider settings. API keys are never sent back to the client.
router.get('/ai', (req, res) => {
  ai.getSettings()
    .then(settings => res.send(settings))
    .catch(error => sendError(res, error, 500));
});

// { provider, providers: { <id>: { model, apiKey, host } } }
router.put('/ai', (req, res) => {
  ai.saveSettings(req.body)
    .then(settings => res.send(settings))
    .catch(error => sendError(res, error));
});

// Send a tiny prompt to the provider, to validate model and credentials
router.post('/ai/test', (req, res) => {
  ai.test(req.body && req.body.provider)
    .then(result => res.send({ success: true, ...result }))
    .catch(error => sendError(res, error));
});

// Models available on the provider (Ollama only, for now)
router.get('/ai/models/:provider', (req, res) => {
  ai.listModels(req.params.provider)
    .then(models => res.send({ models }))
    .catch(error => sendError(res, error));
});

// Jira / Xray settings. Secrets are never sent back to the client.
router.get('/jira', (req, res) => {
  jira.getSettings()
    .then(settings => res.send(settings))
    .catch(error => sendError(res, error, 500));
});

// { kind, jiraBaseUrl, projectKeys, cloud: { xrayBaseUrl, clientId, clientSecret },
//   server: { personalAccessToken } }
router.put('/jira', (req, res) => {
  jira.saveSettings(req.body)
    .then(settings => res.send(settings))
    .catch(error => sendError(res, error));
});

// Use the stored credentials for real, to validate them
router.post('/jira/test', (req, res) => {
  jira.test()
    .then(result => res.send({ success: true, ...result }))
    .catch(error => sendError(res, error));
});

// Download every test of the projects into the flows "xray" folder, one folder
// per project key. Answers as
// soon as the pull has started: the progress is pushed over the socket as
// "xraypull:update", and can be read back from GET /jira/pull.
router.post('/jira/pull', (req, res) => {
  jira.startPull({ io: req.app.get('io') })
    .then(progress => res.send(progress))
    .catch(error => sendError(res, error));
});

// How the running (or last) pull is doing
router.get('/jira/pull', (req, res) => {
  res.send(jira.pullStatus());
});

// Stop the running pull. Whatever it already wrote stays on disk.
router.delete('/jira/pull', (req, res) => {
  res.send(jira.cancelPull());
});

// SharePoint settings. The client secret lives in the context's .env and is
// never sent back to the client.
router.get('/sharepoint', (req, res) => {
  sharepoint.getSettings()
    .then(settings => res.send(settings))
    .catch(error => sendError(res, error, 500));
});

// { enabled, tenantId, clientId, clientSecret, siteUrl, libraryName,
//   folderPath, fileName, uploadOn }
router.put('/sharepoint', (req, res) => {
  sharepoint.saveSettings(req.body)
    .then(settings => res.send(settings))
    .catch(error => sendError(res, error));
});

// Use the stored credentials for real: sign in, find the site and the library
router.post('/sharepoint/test', (req, res) => {
  sharepoint.test()
    .then(result => res.send({ success: true, ...result }))
    .catch(error => sendError(res, error));
});

export default router;
