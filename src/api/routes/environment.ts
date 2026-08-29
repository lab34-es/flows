import express from 'express';
const router = express.Router();

import * as apps from '../../helpers/applications';
import * as envTransfer from '../../helpers/envTransfer';
import * as markdownFlows from '../../helpers/markdownFlows';

// Get all possible environments across all applications
router.get('/all-possible', (req, res) => {
  apps.allPossibleEnvironments()
    .then(environments => {
      res.json(environments);
    })
    .catch(error => {
      console.error('Error fetching all possible environments:', error);
      res.status(500).json({ error: 'Failed to fetch environments' });
    });
});

// Env-files status of every application against every known environment:
// which files exist, which have a template to be created from, and which are
// missing variables their template declares
router.get('/status', (req, res) => {
  apps.environmentsStatus()
    .then(status => {
      res.json(status);
    })
    .catch(error => {
      console.error('Error fetching environments status:', error);
      res.status(500).json({ error: 'Failed to fetch environments status' });
    });
});

// Whether a flow can run on an environment: the applications its steps use,
// and which of them have no env/<environment>.env file. This is the same
// check the run itself makes, so the UI can say it before anybody presses
// Run. { environment, value } — the flow's markdown — or { environment,
// applications } when the caller already knows which ones it uses.
router.post('/readiness', (req, res) => {
  const { environment, value, applications } = req.body || {};

  if (!environment) {
    return res.status(400).json({ error: 'Invalid request: "environment" is required' });
  }

  let steps: Array<Record<string, any>> = [];

  if (Array.isArray(applications)) {
    steps = applications.map(application => ({ application }));
  }
  else {
    try {
      // parse() reports its errors rather than throwing: a flow that is still
      // being written is asked about too, and a broken step block is simply a
      // step this check knows nothing about
      steps = markdownFlows.parse(value || '').steps;
    }
    catch {
      steps = [];
    }
  }

  apps.environmentReadiness(steps, environment)
    .then(readiness => {
      res.json({ ...readiness, error: apps.readinessError(readiness) });
    })
    .catch(error => {
      console.error('Error checking the environment readiness:', error);
      res.status(500).json({ error: 'Failed to check the environment' });
    });
});

// Create every missing .env file that has a .env.example template.
// Optional body: { environment, application } to narrow the sweep.
router.post('/create-missing', (req, res) => {
  const { environment, application } = req.body || {};

  apps.createMissingEnvFiles({ environment, application })
    .then(created => {
      res.json({ success: true, created });
    })
    .catch(error => {
      console.error('Error creating missing env files:', error);
      res.status(500).json({ error: 'Failed to create missing env files' });
    });
});

// Everything that could be exported, as the three levels the export tree
// renders: application, then environment, then variable. Names only -- the
// values travel in the export, not in the picker.
router.get('/variables', (req, res) => {
  envTransfer.inventory()
    .then(inventory => {
      res.json(inventory);
    })
    .catch(error => {
      console.error('Error listing the environment variables:', error);
      res.status(500).json({ error: 'Failed to list the environment variables' });
    });
});

// The YAML document for a selection, to hand to another developer.
// { selection: [{ application, environment, keys? }] } -- no keys means the
// whole file.
router.post('/export', (req, res) => {
  const { selection } = req.body || {};

  envTransfer.exportSelection(selection)
    .then(result => {
      res.json(result);
    })
    .catch(error => {
      const message = (error && error.message) || 'Failed to export the variables';
      const status = /invalid|nothing to export/i.test(message) ? 400 : 500;

      if (status === 500) {
        console.error('Error exporting the environment variables:', error);
      }

      res.status(status).json({ error: message });
    });
});

// Write a document back into the context's env files. { yaml, dryRun } --
// dryRun answers with the same report, having written nothing, which is how
// the UI shows what an import would do before it does it.
router.post('/import', (req, res) => {
  const { yaml, dryRun } = req.body || {};

  envTransfer.importDocument(yaml, { dryRun: Boolean(dryRun) })
    .then(result => {
      res.json({ success: true, ...result });
    })
    .catch(error => {
      const message = (error && error.message) || 'Failed to import the variables';
      const status = /invalid/i.test(message) ? 400 : 500;

      if (status === 500) {
        console.error('Error importing the environment variables:', error);
      }

      res.status(status).json({ error: message });
    });
});

export default router;
