import express from 'express';
const router = express.Router();

import * as testRuns from '../../helpers/testRuns';

const sendError = (res, error, status = 400) => {
  const message = (error && error.message) || String(error);
  res.status(status).send({ error: message });
};

// Every recorded run, newest first
router.get('/', (req, res) => {
  testRuns.list()
    .then(runs => res.send(runs))
    .catch(error => sendError(res, error, 500));
});

// Start a test run over a folder view: the flows the view's filters matched,
// executed one by one. { environment, folder, view, files }
router.post('/', (req, res) => {
  testRuns.startFolderRun({
    files: req.body.files,
    folder: req.body.folder,
    view: req.body.view,
    environment: req.body.environment,
    io: req.app.get('io')
  })
    .then(run => res.send({ run }))
    .catch(error => sendError(res, error));
});

// One run's summary (run.json)
router.get('/:id', (req, res) => {
  testRuns.get(req.params.id)
    .then(run => res.send(run))
    .catch(error => sendError(res, error, 404));
});

// One run's standalone HTML report, rebuilt on the fly for runs recorded
// before reports existed
router.get('/:id/report', (req, res) => {
  testRuns.report(req.params.id)
    .then(html => res.type('html').send(html))
    .catch(error => sendError(res, error, 404));
});

// One stored flow copy of a run, with its step results. ?path=
router.get('/:id/flow', (req, res) => {
  testRuns.getFlow(req.params.id, String(req.query.path ?? ''))
    .then(flow => res.send(flow))
    .catch(error => sendError(res, error, 404));
});

export default router;
