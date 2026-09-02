import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';

const app = express();
const server = http.createServer(app);
import defineRoutes from './routes';
import * as ioHelper from '../helpers/io';
import * as bootstrap from '../helpers/bootstrap';
import * as relay from '../helpers/remote/relay';

// Initialize Socket.IO with the server
const socketIO = ioHelper.io(server);
app.set('io', socketIO);

export const start = async (options: { context?: string } = {}) => {
  // Store context in app locals for access in routes
  if (options.context) {
    app.locals.context = options.context;
    console.log(`Using context directory: ${options.context}`);
  }

  // Seed bundled example applications and flows on first run
  await bootstrap.ensureDefaults();

  // Listen for remote agents, when a broker is configured. A broker that is
  // down must not keep the UI from starting: the Settings screen says why
  relay.start(socketIO).catch(ex => console.error('Could not start listening for agents:', ex.message));

  // Same-origin and curl-style requests carry no Origin header and pass;
  // cross-origin browser requests are only allowed from the tool's own UIs
  app.use(cors({ origin: ioHelper.ALLOWED_ORIGINS }));
  app.use(express.json());

  app.use((req, res, next) => {
    next();
  });
  
  // Define API routes first
  defineRoutes(app);

  // In development (`npm run dev`) the UI is served by the Vite dev server on
  // :3000, which proxies /api and /socket.io back here. Serving the stale
  // frontend/dist bundle from this port too would silently hand out a build
  // that never picks up frontend edits, so send browsers to Vite instead.
  const devServerUrl = 'http://localhost:3000';
  const isDev = process.env.FLOWS_DEV === '1';

  if (isDev) {
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
      }
      if (req.path.startsWith('/api')) {
        return res.status(404).send('API endpoint not found');
      }
      return res.redirect(302, `${devServerUrl}${req.originalUrl}`);
    });
  }

  // Serve static files from the built frontend. Published installs carry the
  // bundle at dist/frontend (see scripts/copy-assets.js); a source checkout
  // keeps it where Vite writes it.
  const frontendDistPath = isDev ? undefined : [
    path.join(__dirname, '../frontend'),
    path.join(__dirname, '../../frontend/dist')
  ].find((candidate) => fs.existsSync(path.join(candidate, 'index.html')));

  if (frontendDistPath) {
    app.use(express.static(frontendDistPath));
    
    // Handle client-side routing - serve index.html for all non-API routes
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return next();
      }
      // Skip API routes
      if (req.path.startsWith('/api')) {
        return res.status(404).send('API endpoint not found');
      }
      res.sendFile(path.join(frontendDistPath, 'index.html'));
    });
  } else if (!isDev) {
    console.warn('Frontend bundle not found. Run "npm run build:frontend" first.');
  }

  // API error reporter
  app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).send('Something broke!');
  });

  server.listen(3001, () => {
    console.log('Server is running on port 3001');
    if (isDev) {
      console.log(`Dev mode: UI is served by Vite on ${devServerUrl}`);
    } else {
      console.log('http://localhost:3001');
    }
  });
};

export const stop = () => {
  server.close(() => {
    console.log('Server stopped');
  });
};
