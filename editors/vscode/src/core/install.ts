import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Which ronsel runs a context's flows.
 *
 * The extension carries no copy of the tool: a flow runs with the ronsel the
 * context itself depends on, the way `npm run ronsel` would run it there. A
 * project made with `ronsel start` has it in its node_modules; a repository
 * whose flows sit next to its code has it in the repository's. Failing those,
 * a global install, and when working on ronsel itself, the repository's own
 * build.
 */

/** A ronsel the extension can run. */
export interface Install {
  /** The script node runs: the package's bin */
  script: string;
  version: string;
  /** The package folder */
  root: string;
}

const PACKAGE = 'ronsel';

const readJson = (file: string): any => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  catch {
    return null;
  }
};

/**
 * The installation in a package folder, when it is ronsel's and its CLI is
 * there -- a checkout of the repository that was never built has no dist.
 * @param {string} directory - The folder holding package.json
 * @returns {Install|null}
 */
export const fromPackage = (directory: string): Install | null => {
  const manifest = readJson(path.join(directory, 'package.json'));

  if (!manifest || manifest.name !== PACKAGE) {
    return null;
  }

  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin && manifest.bin[PACKAGE];
  if (typeof bin !== 'string') {
    return null;
  }

  const script = path.resolve(directory, bin);
  if (!fs.existsSync(script)) {
    return null;
  }

  return { script, version: String(manifest.version || ''), root: directory };
};

/**
 * What a `ronsel.cliPath` setting names: the CLI script itself, or the
 * folder of the package.
 * @param {string} configured - An absolute path
 * @returns {Install|null}
 */
export const fromSetting = (configured: string): Install | null => {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(configured);
  }
  catch {
    return null;
  }

  if (stat.isDirectory()) {
    return fromPackage(configured);
  }

  // A script: its version is the package's it sits in, when it says
  let directory = path.dirname(configured);
  for (;;) {
    const manifest = readJson(path.join(directory, 'package.json'));
    if (manifest && manifest.name === PACKAGE) {
      return { script: configured, version: String(manifest.version || ''), root: directory };
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return { script: configured, version: '', root: path.dirname(configured) };
    }
    directory = parent;
  }
};

/**
 * The ronsel a folder would run, the way Node would find it: in the
 * node_modules of the folder or of any folder above it -- or the folder
 * being ronsel's own repository.
 * @param {string} from
 * @returns {Install|null}
 */
export const fromFolder = (from: string): Install | null => {
  let directory = path.resolve(from);

  for (;;) {
    const found = fromPackage(path.join(directory, 'node_modules', PACKAGE)) || fromPackage(directory);
    if (found) {
      return found;
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
};

/**
 * The global node_modules npm installs into, or null when npm cannot say.
 * Slow enough -- npm has to start -- that the caller asks once and keeps the
 * answer.
 * @param {string} [npm] - The npm command
 * @returns {Promise<string|null>}
 */
export const globalModules = (npm = 'npm'): Promise<string | null> => new Promise(resolve => {
  try {
    execFile(npm, ['root', '-g'], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      // npm is a .cmd on Windows, which only a shell runs
      shell: process.platform === 'win32'
    }, (error, stdout) => {
      const directory = error ? '' : String(stdout).trim();
      resolve(directory || null);
    });
  }
  catch {
    resolve(null);
  }
});

/** Where to look, beyond the context. */
export interface LocateOptions {
  /** `ronsel.cliPath`, absolute, when it is set */
  configured?: string | null;
  /** The workspace folders: a context inside one may use its install */
  folders?: string[];
  /** The global node_modules (globalModules), looked in when nothing closer has it */
  globalRoot?: string | null;
}

/**
 * The ronsel a context runs with.
 * @param {string} context - The context's folder
 * @param {LocateOptions} [options]
 * @returns {Install|null}
 */
export const locate = (context: string, options: LocateOptions = {}): Install | null => {
  if (options.configured) {
    return fromSetting(options.configured);
  }

  for (const folder of [context, ...(options.folders || [])]) {
    const found = fromFolder(folder);
    if (found) {
      return found;
    }
  }

  return options.globalRoot ? fromPackage(path.join(options.globalRoot, PACKAGE)) : null;
};
