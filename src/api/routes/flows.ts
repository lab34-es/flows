import express from 'express';
const router = express.Router();

import * as flows from '../../helpers/flows';
import * as inputs from '../../helpers/inputs';
import * as relay from '../../helpers/remote/relay';

const sendError = (res, error, status = 400) => {
  const message = (error && error.message) || String(error);
  const code = error && error.code === 'EEXISTS' ? 409 : status;
  res.status(code).send({ error: message });
};

router.get('/', (req, res) => {
  flows.list()
    .then(list => res.send(list))
    .catch(error => sendError(res, error, 500));
});

// Nested folders + flow files, for the sidebar tree
router.get('/tree', (req, res) => {
  flows.tree()
    .then(tree => res.send(tree))
    .catch(error => sendError(res, error, 500));
});

// Parse raw flow content into segments/steps
router.post('/parse', (req, res) => {
  try {
    res.send(flows.parseValue(req.body.value || ''));
  }
  catch (error) {
    sendError(res, error);
  }
});

// Generate a new Markdown flow from a prompt. { prompt }
router.post('/create/ai', (req, res) => {
  flows.createAI(req.body)
    .then(flow => res.send(flow))
    .catch(error => sendError(res, error));
});

// Rewrite an existing flow following an instruction. { prompt, content }
router.post('/edit/ai', (req, res) => {
  flows.editAI(req.body)
    .then(flow => res.send(flow))
    .catch(error => sendError(res, error));
});

// { value, environment, path } runs here; add { agent } to run the committed
// copy of `path` on that agent instead, followed over the same socket
router.post('/start', (req, res) => {
  const { agent } = req.body || {};

  const started = agent
    ? relay.startFlow({ agent, environment: req.body.environment, path: req.body.path })
    : flows.start(req.body, { io: req.app.get('io') });

  started
    .then(flow => {
      res.send({ execution: flow.execution });
    })
    .catch(error => sendError(res, error));
});

// The requests a running flow is waiting an answer for. Only ever one in
// practice, but a client that connected late has no other way of finding it.
router.get('/input', (req, res) => {
  res.send({ inputs: [...inputs.list(), ...relay.listInputs()] });
});

// Answer -- or give up on -- what a step asked the person running the flow
// for. { id, value } to answer, { id, cancel: true } to abandon it, which
// fails the step and lets the run end instead of waiting for ever.
router.post('/input', (req, res) => {
  const { id, value, cancel } = req.body || {};

  if (!id) {
    return sendError(res, new Error('Invalid request: "id" is required'));
  }

  // A question asked by a step running here, or by one running on an agent
  const settled = (cancel
    ? inputs.cancel(id, 'Input was cancelled')
    : inputs.answer(id, value)) || relay.answerInput(id, value, Boolean(cancel));

  if (!settled) {
    return res.status(404).send({ error: 'That input is no longer being waited for' });
  }

  res.send({ success: true });
});

router.get('/user', (req, res) => {
  const path = req.query.path;
  flows.getUserFlow(path)
    .then(flow => res.send(flow))
    .catch(error => res.status(404).send({ error: error.message || error }));
});

// Create a folder inside the flows directory
router.post('/folder', (req, res) => {
  flows.createFolder(req.body.path)
    .then(result => res.send({ success: true, ...result }))
    .catch(error => sendError(res, error));
});

// Create or save a flow file. { path, content, overwrite }
router.post('/file', (req, res) => {
  flows.saveFile({
    relativePath: req.body.path,
    content: req.body.content,
    overwrite: Boolean(req.body.overwrite)
  })
    .then(result => res.send({ success: true, ...result }))
    .catch(error => sendError(res, error));
});

// Rewrite the frontmatter of a markdown flow. { path, properties }
router.put('/properties', (req, res) => {
  flows.saveProperties({
    relativePath: req.body.path,
    properties: req.body.properties
  })
    .then(result => res.send({ success: true, ...result }))
    .catch(error => sendError(res, error));
});

// Rename or move a flow file or folder. { from, to }
router.post('/rename', (req, res) => {
  flows.rename(req.body.from, req.body.to)
    .then(result => res.send({ success: true, ...result }))
    .catch(error => sendError(res, error));
});

// Delete a flow file or folder. { path }
router.delete('/file', (req, res) => {
  flows.remove(req.body.path || req.query.path)
    .then(result => res.send({ success: true, ...result }))
    .catch(error => sendError(res, error));
});

export default router;
