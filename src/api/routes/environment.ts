import express from 'express';
const router = express.Router();

import * as apps from '../../helpers/applications';

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
// what the Environments card on the home page renders
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

// Add an environment to every application at once. { name, baseEnvironment? }
router.post('/add', (req, res) => {
  const { name, baseEnvironment } = req.body || {};

  apps.addEnvironmentToAll(name, baseEnvironment)
    .then(created => {
      res.json({ success: true, created });
    })
    .catch(error => {
      const message = (error && error.message) || 'Failed to add the environment';
      const status = /required|invalid/i.test(message) ? 400 : 500;
      res.status(status).json({ error: message });
    });
});

export default router;
