import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';

const app = express();
const server = http.createServer(app);
import defineRoutes from './routes';
import * as ioHelper from '../helpers/io';
import * as netHelper from '../helpers/net';
import * as bootstrap from '../helpers/bootstrap';

// Built by `start`, once the address is known: the origins it allows are the
// ones the chosen port makes true. Kept here so `stop` can close it
let socketIO: ReturnType<typeof ioHelper.io> | undefined;

/**
 * Start the API, and the UI it serves.
 *
 * Nothing about the address is written down: the port is chosen here, and the
 * CORS origins and the URL follow from it. The URL is returned so that
 * whoever started this -- the CLI -- prints and opens the one that is true,
 * rather than assuming the port nobody promised.
 *
 * @param {Object} [options] - { context, port, host }
 * @param {string} [options.context] - The directory this run reads and writes
 * @param {unknown} [options.port] - What --port was given; PORT otherwise
 * @param {unknown} [options.host] - What --host was given; HOST otherwise
 * @returns {Promise<string>} The URL the UI is served on
 */
export const start = async (
  options: { context?: string; port?: unknown; host?: unknown } = {}
): Promise<string> => {
  // Store context in app locals for access in routes
  if (options.context) {
    app.locals.context = options.context;
    console.log(`Using context directory: ${options.context}`);
  }

  // Where this ends up listening, settled before anything that depends on it:
  // the socket's allowed origins and the URL are both built from these two
  const host = netHelper.resolveHost(options.host);
  const port = await netHelper.freePort(netHelper.preferredPort(options.port), host);
  const origins = netHelper.allowedOrigins({
    host,
    port,
    // A server exposed on purpose is reached by one of this machine's
    // addresses, and the UI it serves calls back from that same origin
    addresses: netHelper.isLoopback(host) ? [] : netHelper.localAddresses()
  });

  // Initialize Socket.IO with the server
  socketIO = ioHelper.io(server, origins);
  app.set('io', socketIO);

  // Seed bundled example applications and flows on first run
  await bootstrap.ensureDefaults();

  // Same-origin and curl-style requests carry no Origin header and pass;
  // cross-origin browser requests are only allowed from the tool's own UIs
  app.use(cors({ origin: origins }));
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

  const url = netHelper.url({ host, port });

  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);

    server.once('error', failed);
    server.listen(port, host, () => {
      server.removeListener('error', failed);
      resolve();
    });
  });

  // Whatever port this settled on, it is never a surprise: one copyable line,
  // always, and a plain warning when the port is not only ours to reach
  const warning = netHelper.exposureWarning(host);
  if (warning) { console.warn(warning); }

  if (isDev) {
    console.log(`Dev mode: UI is served by Vite on ${devServerUrl}, which proxies to the API on ${url}`);
  }

  console.log(url);

  return url;
};

/**
 * Stop listening.
 *
 * The socket server owns the HTTP one once it is attached, so closing it
 * closes both -- and leaves nothing holding the port a restart is about to
 * ask for.
 *
 * @returns {Promise<void>} Resolved once nothing is listening
 */
export const stop = (): Promise<void> => new Promise(resolve => {
  const done = () => {
    console.log('Server stopped');
    resolve();
  };

  if (socketIO) {
    const sockets = socketIO;
    socketIO = undefined;
    sockets.close(done);
    return;
  }

  server.close(done);
});
