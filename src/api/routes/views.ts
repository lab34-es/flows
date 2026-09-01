import express from 'express';
const router = express.Router();

import * as bases from '../../helpers/bases';

const sendError = (res, error, status = 400) => {
  const message = (error && error.message) || String(error);
  res.status(status).send({ error: message });
};

// The whole views.yaml document: { filters, formulas, properties, views }
router.get('/', (req, res) => {
  bases.load()
    .then(document => res.send(document))
    .catch(error => sendError(res, error, 500));
});

// Replace views.yaml. { filters, formulas, properties, views }
router.put('/', (req, res) => {
  bases.save(req.body)
    .then(document => res.send(document))
    .catch(error => sendError(res, error));
});

// Run a view over a folder of flows. ?folder=&view=
router.get('/query', (req, res) => {
  bases.query({
    folder: String(req.query.folder ?? ''),
    view: req.query.view === undefined ? undefined : String(req.query.view)
  })
    .then(result => res.send(result))
    .catch(error => sendError(res, error));
});

// What the filter editor draws itself from: the conjunctions, the operators
// and which property type offers each one. Served rather than duplicated in
// the UI, so it can never offer an operator the evaluator does not implement.
router.get('/operators', (req, res) => {
  res.send(bases.filters.catalog());
});

// How many flows a candidate view would list, without saving it.
// { folder, view, document } -> { matched, total, errors }
router.post('/preview', (req, res) => {
  const body = (req.body && typeof req.body === 'object') ? req.body : {};

  bases.query({
    folder: String(body.folder ?? ''),
    view: body.view === undefined ? undefined : String(body.view),
    document: body.document
  })
    .then(result => res.send({
      matched: result.rows.length,
      total: result.total,
      errors: result.errors
    }))
    .catch(error => sendError(res, error));
});

export default router;
