import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
// temp.track(); // Automatically track and clean up temp files at exit

import * as paths from './paths';
import * as appDocs from './appDocs';
import * as appLoader from './appLoader';

const applications: Record<string, any> = {};

export { applications };

const description = (description) => {
  return description;
};

export { description };

// Helper function to convert array-style handlers to functions that can describe themselves
//
// The array holds the validation middlewares and, as its last item, the
// function to execute. Documentation is not part of it: methods are
// documented with a JSDoc block above them (see helpers/appDocs.js). A
// leading string is still accepted as a description, for applications
// written before documentation moved to JSDoc.
const handler = (handlerArray, functionName) => {
  const hasInlineDescription = typeof handlerArray[0] === 'string';

  // The actual function that will be called
  const handler = function (ctx, parameters, flow) {
    if (ctx === 'describe') {
      const description = hasInlineDescription ? handlerArray[0] : null;
      const validation: Record<string, any> = { };

      // Find validation schemas
      handlerArray.forEach(item => {
        if (typeof item === 'function') {
          if (item.schemaType === 'body' && item.schema) {
            validation.body = item.schema;
          } else if (item.schemaType === 'query' && item.schema) {
            validation.query = item.schema;
          }
        }
      });

      return {
        name: functionName,
        description,
        parameters: validation
      };
    }

    // Normal execution: run every item except the last one (the execution
    // function) and the optional leading description
    for (let i = hasInlineDescription ? 1 : 0; i < handlerArray.length - 1; i++) {
      if (typeof handlerArray[i] === 'function') {
        handlerArray[i](ctx, parameters, flow);
      }
    }

    // Execute the main handler (last item in array)
    return handlerArray[handlerArray.length - 1](ctx, parameters, flow);
  };

  return handler;
};

export { handler };

const loadAll = () => {
  // Always reload: application code can be edited from the UI (Source view)
  // and the next run must pick up the changes without restarting the server
  return parseApplications()
    .then(apps => {
      return apps.reduce((acc, app) => {
        const indexPath = appLoader.resolveEntry(app.path);
        if (!indexPath) {
          return acc;
        }
        applications[app.name] = appLoader.load(indexPath);
        return acc;
      }, {});
    });
};

export { loadAll };

/**
 * Return list of paths of *.env files present in the given path.
 * @param {string} pathToSearch
 * @returns {
*  string[]
* }
*/
const listEnvFiles = pathToSearch => {
  const envDir = path.join(pathToSearch, 'env');

  if (!fs.existsSync(envDir)) {
    return [];
  }

  return fs.readdirSync(envDir)
    .filter(file => fs.statSync(path.join(envDir, file)).isFile() && file.endsWith('.env'))
    .map(file => path.join(envDir, file));
};

/**
 * Return list of paths of *.env.example files present in the given path.
 * Templates carry the variables an environment needs, without their secret
 * values, so they can be committed and shared where the .env files cannot.
 * @param {string} pathToSearch
 * @returns {string[]}
 */
const listEnvTemplates = pathToSearch => {
  const envDir = path.join(pathToSearch, 'env');

  if (!fs.existsSync(envDir)) {
    return [];
  }

  return fs.readdirSync(envDir)
    .filter(file => fs.statSync(path.join(envDir, file)).isFile() && file.endsWith('.env.example'))
    .map(file => path.join(envDir, file));
};

/**
 * Gets a unique list of all possible environments based on the .env files —
 * and the .env.example templates — present of all applications. Counting the
 * templates lets an environment appear in the selector before every tester
 * has created their own .env files for it.
 *
 * The union is deliberate: an environment exists as soon as *one* application
 * declares it. Demanding a file in every application would mean writing one
 * per application before an environment could be used at all — a thousand
 * files for a thousand applications, most of which no flow ever touches. What
 * a run actually needs is checked per flow instead, by environmentReadiness.
 *
 * @returns {Promise<string[]>} - Promise that resolves to a sorted array of unique environment names
 */
const allPossibleEnvironments = () => {
  return parseApplications()
    .then(apps => {
      const envs = apps.map(app => [
        ...app.envFiles.map(env => env.name),
        ...app.envTemplates.map(template => template.name)
      ]);
      return [...new Set(envs.flat())];
    })
    .then(envs => envs.filter(env => env && env.trim() !== '').sort());
};

export { allPossibleEnvironments };

/**
 * Application and environment names both become one path segment, and both
 * come from files a person wrote: a name that is not a plain segment never
 * reaches the filesystem.
 */
const PLAIN_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The applications a flow needs environment files for: the ones its steps
 * call. `tester` is the runner's own pseudo-application — it has no folder,
 * and no env file to find.
 * @param {Array<Object>} steps - The flow's steps
 * @returns {string[]} Unique application names, in the order the flow uses them
 */
const applicationsOf = (steps): string[] => {
  return [...new Set<string>(
    (steps || [])
      .map(step => step && step.application)
      .filter(application => application && application !== 'tester')
  )];
};

export { applicationsOf };

/**
 * Where an application keeps the env file of an environment. Null when either
 * name is not a plain path segment, or would land outside the application's
 * own env folder — a flow names both, so neither is trusted.
 * @param {string} application
 * @param {string} environment
 * @returns {Promise<string|null>} Absolute path, or null when the names are not usable
 */
const envFileOf = async (application, environment): Promise<string | null> => {
  if (!PLAIN_SEGMENT.test(application || '') || !PLAIN_SEGMENT.test(environment || '')) {
    return null;
  }

  const envDir = path.resolve(await paths.contextDir(['applications', application, 'env']));
  const envFile = path.resolve(envDir, `${environment}.env`);

  return envFile.startsWith(envDir + path.sep) ? envFile : null;
};

export { envFileOf };

/**
 * Which of these applications cannot run on an environment, because their
 * env/<environment>.env file is not there.
 *
 * Only the applications asked about are looked at. An environment does not
 * have to exist everywhere — only where it is used.
 *
 * @param {string[]} applications - Application names
 * @param {string} environment
 * @returns {Promise<Array<{application: string, file: string, path: string|null, hasTemplate: boolean}>>}
 */
const missingEnvFilesFor = async (applications, environment) => {
  const missing: { application: string, file: string, path: string | null, hasTemplate: boolean }[] = [];

  for (const application of applications || []) {
    const envFile = await envFileOf(application, environment);

    if (envFile && fs.existsSync(envFile)) { continue; }

    missing.push({
      application,
      file: `applications/${application}/env/${environment}.env`,
      path: envFile,
      // A committed template means the file only needs creating, not writing
      // from scratch: worth saying, so the tester knows where to start
      hasTemplate: Boolean(envFile) && fs.existsSync(`${envFile}.example`)
    });
  }

  return missing;
};

export { missingEnvFilesFor };

/**
 * Everything a flow needs before it can run on an environment.
 *
 * The environment has to be one of the known ones — the union of what the
 * applications declare — and every application the flow's steps use has to
 * have its env file for it. Nothing else: the applications the flow does not
 * touch are none of this run's business, however many of them there are.
 *
 * @param {Array<Object>} steps - The flow's steps
 * @param {string} environment
 * @returns {Promise<{environment: string, environments: string[], known: boolean, applications: string[], missing: Array<Object>, ready: boolean}>}
 */
const environmentReadiness = async (steps, environment) => {
  const environments = await allPossibleEnvironments();
  const known = environments.includes(environment);
  const applications = applicationsOf(steps);

  // An unknown environment is answered on its own: every file would be
  // "missing" for it, which says nothing useful
  const missing = known ? await missingEnvFilesFor(applications, environment) : [];

  return {
    environment,
    environments,
    known,
    applications,
    missing,
    ready: known && missing.length === 0
  };
};

export { environmentReadiness };

/**
 * Why a flow cannot run, said the same way wherever it is triggered — the
 * CLI, the API and the runner all report this one sentence. Null when the
 * flow can run.
 * @param {Object} readiness - What environmentReadiness returned
 * @returns {string|null}
 */
const readinessError = (readiness): string | null => {
  const { environment, environments, known, missing } = readiness;

  if (!known) {
    return `Invalid environment: ${environment}. Must be one of ${environments.join(', ')}`;
  }

  if (!missing.length) { return null; }

  const list = missing.map(item => `${item.application} (${item.file})`).join(', ');
  const templates = missing.some(item => item.hasTemplate)
    ? ' Some of them have a committed .env.example template to create it from.'
    : '';

  return `Missing environment file${missing.length > 1 ? 's' : ''} for "${environment}": ${list}.` +
    `${templates} Only the applications a flow uses need one — create it from the ` +
    "Environment variables card on the home page, or import a teammate's export there.";
};

export { readinessError };

/**
 * The env-files status of every application against every known environment:
 * which .env files exist, which are missing but have a committed
 * .env.example to create them from, and which variables of the template an
 * existing file is still missing. This is what the home page card renders.
 * @returns {Promise<{environments: string[], applications: Array<Object>, summary: Object}>}
 */
const environmentsStatus = async () => {
  const parsed = await parseApplications();
  const environments = await allPossibleEnvironments();

  const summary = { total: 0, missing: 0, creatable: 0, incomplete: 0 };

  const applications = parsed.map(app => {
    const status: Record<string, any> = {};

    environments.forEach(envName => {
      const envFile = app.envFiles.find(env => env.name === envName);
      const template = app.envTemplates.find(tpl => tpl.name === envName);

      // Variables the template declares that the real file does not carry yet
      const missingKeys = envFile && template
        ? template.contents
          .map(entry => entry.key)
          .filter(key => !envFile.contents.some(entry => entry.key === key))
        : [];

      summary.total += 1;
      if (!envFile) {
        summary.missing += 1;
        if (template) { summary.creatable += 1; }
      }
      else if (missingKeys.length) {
        summary.incomplete += 1;
      }

      status[envName] = {
        exists: Boolean(envFile),
        hasTemplate: Boolean(template),
        file: `env/${envName}.env`,
        template: template ? `env/${envName}.env.example` : null,
        missingKeys
      };
    });

    return {
      name: app.name,
      slug: app.slug,
      environments: status
    };
  });

  return { environments, applications, summary };
};

export { environmentsStatus };

/**
 * Create every missing .env file that has a committed .env.example next to
 * it, copying the template as it is. The tester then only fills in the
 * secrets. Narrow with `environment` and/or `application` to act on one.
 * @param {Object} [options]
 * @param {string} [options.environment] - Only this environment
 * @param {string} [options.application] - Only this application
 * @returns {Promise<Array<{application: string, environment: string, path: string}>>} The files created
 */
type EnvFilesScope = { environment?: string, application?: string };

const createMissingEnvFiles = async ({ environment, application }: EnvFilesScope = {}) => {
  const parsed = await parseApplications();
  const created: { application: string, environment: string, path: string }[] = [];

  parsed.forEach(app => {
    if (application && app.slug !== application) { return; }

    app.envTemplates.forEach(template => {
      if (environment && template.name !== environment) { return; }
      if (app.envFiles.some(env => env.name === template.name)) { return; }

      const envFile = path.join(app.path, 'env', `${template.name}.env`);
      fs.mkdirSync(path.dirname(envFile), { recursive: true });
      fs.writeFileSync(envFile, fs.readFileSync(template.path, 'utf8'), 'utf8');

      created.push({ application: app.slug, environment: template.name, path: envFile });
    });
  });

  return created;
};

export { createMissingEnvFiles };

/**
 * Given a value, return a masked value.
 * @param {*} value 
 * @returns 
 */
const maskValue = value => {
  const valueLength = value.length;
  if (!valueLength) {
    return value;
  }

  // Replace all characters with * expect last 4
  if (valueLength > 4) {
    return value.slice(0, -4).replace(/./g, '*') + value.slice(-4);
  }

  // Replace all characters with *
  return (value||'').toString().replace(/./g, '*');
};

const loadEnvFile = envPath => {
  const secretLike = [
    'secret',
    'token',
    'credential',
    'x-api-key',
    'x_api_key',
    'password',
    'authorization'
  ];

  const envConfig = dotenv.parse(fs.readFileSync(envPath));
  return Object.keys(envConfig).map(key => {
    const feelsSecret = secretLike.includes(key.toLowerCase());

    // Yesssss, we are sending the secret to the UI. But this is a local-only
    // tool!
    return {
      key,
      isSecret: feelsSecret,
      value: feelsSecret ? maskValue(envConfig[key]) : envConfig[key]
    };
  });
};

export const updateEnvFile = (envPath, key, value) => {
  return new Promise<void>((resolve, reject) => {
    fs.readFile(envPath, 'utf8', (err, data) => {
      if (err) {
        return reject(err);
      }
      const envConfig = dotenv.parse(data);
      envConfig[key] = value;
      const newEnv = Object.keys(envConfig).map(key => `${key}=${envConfig[key]}`).join('\n');
      fs.writeFile(envPath, newEnv, 'utf8', err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  });
};

const summary = () => {
  return parseApplications()
    .then(apps => {
      // Create a formatted output for console
      console.log('\n=== Applications Summary ===\n');
      
      if (apps.length === 0) {
        console.log('No applications found.');
      }
      
      apps.forEach(app => {
        console.log(`Application: ${app.name}`);
        
        if (app.methods && app.methods.length > 0) {
          console.log('  Methods:');
          app.methods.forEach(method => {
            console.log(`    - ${method.name}: ${method.description || 'No description'}`);
          });
        } else {
          console.log('  No methods found.');
        }
        
        console.log(''); // Empty line between applications
      });
    });
};

export { summary };

/**
 * Returns the list of applications and .env files for each
 * @param {string} source - Optional source directory to load applications from
 * @returns {Array[Object]} 
 * {
 *  application: string,
 *  path: string,
 *  envFiles: Array[Object] {
 *    name: string,  
 *    path: string
 *  }
 * }
 */
const parseApplications = async () => {
  const appsPath = await paths.contextDir(['applications']);

  if (!fs.existsSync(appsPath)) {
    return [];
  }

  const apps = fs.readdirSync(appsPath).filter(file => {
    return fs.statSync(path.join(appsPath, file)).isDirectory();
  });
  
  const result = await Promise.all(apps.map(async applicationName => {
    const appPath = path.join(appsPath, applicationName);

    const appIndex = appLoader.resolveEntry(appPath);

    // List env files
    const envFiles = listEnvFiles(appPath);

    const envFilesWithPaths = envFiles.map(envFile => {
      const fileName = path.basename(envFile);
      const envName = fileName.replace(/\.env$/i, '');
      return {
        name: envName,
        source: envFile,
        path: envFile,
        contents: loadEnvFile(envFile)
      };
    });

    // List env templates (.env.example): the committed contract of what each
    // environment needs, used to offer creating the missing .env files
    const envTemplatesWithPaths = listEnvTemplates(appPath).map(templateFile => {
      const fileName = path.basename(templateFile);
      const envName = fileName.replace(/\.env\.example$/i, '');
      return {
        name: envName,
        path: templateFile,
        contents: loadEnvFile(templateFile)
      };
    });

    // if index file exists load methods
    let methods: any[] = [];
    const errors: Record<string, any>[] = [];
    let indexSource: string | null = null;

    if (appIndex) {
      indexSource = fs.readFileSync(appIndex, 'utf8');

      try {
        // appLoader transpiles TypeScript, resolves the application's import
        // of this package, and reloads from disk so edits made in the UI
        // (Source view) are picked up without restarting the server
        const lib = appLoader.load(appIndex);

        // Ask every exported method to describe itself. An application is
        // free to export something that is not a method -- a constant, a
        // helper -- so anything that does not answer is left out rather than
        // failing the whole application.
        methods = Object.keys(lib)
          .filter(name => typeof lib[name] === 'function')
          .map(name => {
            try {
              return lib[name]('describe');
            }
            catch {
              return null;
            }
          })
          .filter(method => method && method.name);
      }
      catch (ex) {
        console.error('Error loading application', applicationName, ex);
        errors.push({
          message: ex.message,
          stack: ex.stack
        });
      }
    }

    // Load the application README, if any
    let readme: string | null = null;
    const readmeFile = fs.readdirSync(appPath)
      .find(file => file.toLowerCase() === 'readme.md');
    if (readmeFile) {
      try {
        readme = fs.readFileSync(path.join(appPath, readmeFile), 'utf8');
      }
      catch (ex) {
        errors.push({ message: `Error reading README: ${ex.message}` });
      }
    }

    // Documentation lives in the JSDoc blocks of index.ts: the block at the
    // top of the file describes the application, and the block above each
    // exported method documents its input, output, memory usage and an
    // example step.
    const parsedDocs = appDocs.parse(indexSource);
    const docsMethods = parsedDocs.methods;

    // docs.json is no longer read: warn instead of silently ignoring it
    if (fs.existsSync(path.join(appPath, 'docs.json'))) {
      errors.push({
        message: 'docs.json is no longer used. Document the application and its ' +
          'methods with JSDoc blocks in index.ts, then delete docs.json.'
      });
    }

    // Merge the self-described methods (from index.ts) with their JSDoc.
    // The JSDoc description wins over the one a handler may still declare
    // inline. Documented methods that could not be loaded are included too,
    // flagged as not implemented.
    const methodsByName = new Map<string, Record<string, any>>();

    methods.filter(Boolean).forEach(method => {
      methodsByName.set(method.name, { ...method, implemented: true });
    });

    Object.keys(docsMethods).forEach(name => {
      const existing = methodsByName.get(name) || { name, implemented: false };
      const methodDocs = docsMethods[name];
      methodsByName.set(name, {
        ...existing,
        description: methodDocs.description || existing.description || null,
        docs: methodDocs
      });
    });

    return {
      name: applicationName,
      slug: applicationName,
      path: appPath,
      description: parsedDocs.description,
      readme,
      envFiles: envFilesWithPaths,
      envTemplates: envTemplatesWithPaths,
      methods: Array.from(methodsByName.values()),
      errors
    };
  }));

  return result;
};

export { parseApplications };

/**
 * Files an application is expected to have. They are always listed by the
 * Source view — with an `exists` flag — so the UI can offer creating the
 * missing ones: the README, and the code that also carries the documentation
 * (as JSDoc).
 */
const CANONICAL_APP_FILES = ['README.md', 'index.ts'];

/**
 * A canonical file is already there when a variant of it is: an application
 * still written in JavaScript has an `index.js`, and the Source view must not
 * offer to create an `index.ts` next to it.
 */
const CANONICAL_ALTERNATIVES = { 'index.ts': ['index.js'] };

/**
 * Folders never shown nor written to from the Source view: they are either
 * managed by other tools or big enough to make the explorer useless.
 */
const IGNORED_APP_SEGMENTS = ['node_modules', '.git'];

const toPosix = (value) => (value || '').split('\\').join('/');

/**
 * Resolve a file inside an application folder, rejecting anything that would
 * escape the application directory or touch an ignored folder.
 * @param {string} applicationName
 * @param {string} relativePath - e.g. "README.md", "lib/http.js", "env/local.env"
 * @returns {Promise<{appPath: string, absolute: string, relative: string}>}
 */
const resolveAppFile = async (applicationName, relativePath) => {
  const appPath = await paths.contextDir(['applications', applicationName]);

  if (!fs.existsSync(appPath) || !fs.statSync(appPath).isDirectory()) {
    throw new Error('Application not found');
  }

  const normalized = toPosix(relativePath).replace(/^\/+/, '').trim();

  if (!normalized) {
    throw new Error('File path is required');
  }

  const segments = normalized.split('/').filter(segment => segment && segment !== '.');
  if (segments.some(segment => IGNORED_APP_SEGMENTS.includes(segment.toLowerCase()))) {
    throw new Error(`Not an editable application file: ${normalized}`);
  }

  const absolute = path.resolve(appPath, normalized);
  if (!absolute.startsWith(appPath + path.sep)) {
    throw new Error('Invalid path: outside of the application directory');
  }

  return { appPath, absolute, relative: toPosix(path.relative(appPath, absolute)) };
};

/** Collect every file under `dir`, depth-first, as posix relative paths. */
const walkAppFiles = (dir, relativePath, collected) => {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  }
  catch {
    return collected;
  }

  for (const entry of entries) {
    if (IGNORED_APP_SEGMENTS.includes(entry.toLowerCase())) { continue; }

    const full = path.join(dir, entry);
    const itemRelative = relativePath ? `${relativePath}/${entry}` : entry;

    let stat;
    try {
      stat = fs.statSync(full);
    }
    catch {
      // Broken symlink or unreadable entry: skip it instead of failing
      continue;
    }

    if (stat.isDirectory()) {
      walkAppFiles(full, itemRelative, collected);
      continue;
    }

    collected.push({ path: itemRelative, exists: true });
  }

  return collected;
};

/**
 * List the files of an application. Every file on disk is listed, plus the
 * canonical ones (README.md, index.ts) when they are missing, so the UI can
 * offer creating them.
 * @param {string} applicationName
 * @returns {Promise<Array<{path: string, exists: boolean}>>}
 */
export const listAppFiles = async (applicationName) => {
  const appPath = await paths.contextDir(['applications', applicationName]);

  if (!fs.existsSync(appPath) || !fs.statSync(appPath).isDirectory()) {
    throw new Error('Application not found');
  }

  const files = walkAppFiles(appPath, '', [])
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));

  // Canonical files that do not exist yet, first, so they are easy to spot
  const has = (name) => files.some(file => file.path.toLowerCase() === name.toLowerCase());

  const missing = CANONICAL_APP_FILES
    .filter(name => !has(name) && !(CANONICAL_ALTERNATIVES[name] || []).some(has))
    .map(name => ({ path: name, exists: false }));

  return [...missing, ...files];
};

/**
 * Create a new file in an application. Fails when the path is already taken,
 * so the UI never silently replaces an existing file.
 * @param {string} applicationName
 * @param {string} relativePath
 * @param {string} content
 */
export const createAppFile = async (applicationName, relativePath, content) => {
  const { absolute, relative } = await resolveAppFile(applicationName, relativePath);

  if (fs.existsSync(absolute)) {
    const error: NodeJS.ErrnoException = new Error('A file or folder with that name already exists');
    error.code = 'EEXISTS';
    throw error;
  }

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content ?? '', 'utf8');

  return { path: relative };
};

/**
 * Rename (or move, when the new path has folders) a file or folder of an
 * application.
 * @param {string} applicationName
 * @param {string} fromPath
 * @param {string} toPath
 */
export const renameAppFile = async (applicationName, fromPath, toPath) => {
  const from = await resolveAppFile(applicationName, fromPath);
  const to = await resolveAppFile(applicationName, toPath);

  if (!fs.existsSync(from.absolute)) {
    throw new Error(`File not found: ${from.relative}`);
  }

  if (from.absolute === to.absolute) {
    return { path: to.relative, previousPath: from.relative };
  }

  // Renaming only the casing (readme.md → README.md) is a no-op collision on
  // case-insensitive file systems, so only guard against a different file
  if (fs.existsSync(to.absolute) && from.absolute.toLowerCase() !== to.absolute.toLowerCase()) {
    const error: NodeJS.ErrnoException = new Error('A file or folder with that name already exists');
    error.code = 'EEXISTS';
    throw error;
  }

  if (to.absolute.startsWith(from.absolute + path.sep)) {
    throw new Error('Cannot move a folder inside itself');
  }

  fs.mkdirSync(path.dirname(to.absolute), { recursive: true });
  fs.renameSync(from.absolute, to.absolute);

  return { path: to.relative, previousPath: from.relative };
};

/**
 * Delete a file or folder of an application.
 * @param {string} applicationName
 * @param {string} relativePath
 */
export const deleteAppFile = async (applicationName, relativePath) => {
  const { absolute, relative } = await resolveAppFile(applicationName, relativePath);

  // lstat instead of existsSync so broken symlinks can still be deleted
  try {
    fs.lstatSync(absolute);
  }
  catch {
    throw new Error(`File not found: ${relative}`);
  }

  fs.rmSync(absolute, { recursive: true, force: true });

  return { path: relative };
};

/**
 * An application is a folder inside the applications directory, and flows
 * name it as it is named there: anything that is not a plain folder name --
 * a path, a hidden folder -- is refused.
 * @param {string} name
 * @returns {string} The trimmed, usable name
 */
const applicationNameOf = (name) => {
  const trimmed = (name || '').trim();

  if (!trimmed) {
    throw new Error('Application name is required');
  }

  if (/[/\\]/.test(trimmed) || trimmed === '.' || trimmed === '..' || trimmed.startsWith('.')) {
    throw new Error('Invalid application name');
  }

  return trimmed;
};

/**
 * The files a new application starts from: a documented index.ts with example
 * methods, its README and a local environment. They live next to the example
 * applications rather than inside them, so seeding never copies the template
 * itself into the user's context directory.
 */
const APPLICATION_TEMPLATE_DIR = path.join(__dirname, '..', 'defaults', 'application-template');

/** What the template writes wherever the application's own name belongs. */
const NAME_PLACEHOLDER = /__APPLICATION_NAME__/g;

/**
 * Copy the template into a new application folder, naming it along the way.
 * Every template file is text, so each one is read, renamed and written.
 */
const copyTemplate = (source, destination, name) => {
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source)) {
    const from = path.join(source, entry);
    const to = path.join(destination, entry);

    if (fs.statSync(from).isDirectory()) {
      copyTemplate(from, to, name);
      continue;
    }

    const content = fs.readFileSync(from, 'utf8').replace(NAME_PLACEHOLDER, name);
    fs.writeFileSync(to, content, 'utf8');
  }
};

/**
 * Create an application: a folder in the applications directory, holding the
 * template -- a hello-world method writing to the flow memory, one reading it
 * back, an HTTP call, and the README and environment that go with them.
 * @param {string} name - A single folder name, no slashes
 * @returns {Promise<{name: string, slug: string, path: string}>}
 */
export const createApplication = async (name) => {
  const trimmed = applicationNameOf(name);

  const appsPath = await paths.contextDir(['applications']);
  const destination = path.join(appsPath, trimmed);

  if (fs.existsSync(destination)) {
    const error: NodeJS.ErrnoException = new Error(`An application named “${trimmed}” already exists`);
    error.code = 'EEXISTS';
    throw error;
  }

  if (!fs.existsSync(APPLICATION_TEMPLATE_DIR)) {
    throw new Error('The application template is missing from this installation');
  }

  fs.mkdirSync(appsPath, { recursive: true });
  copyTemplate(APPLICATION_TEMPLATE_DIR, destination, trimmed);

  return { name: trimmed, slug: trimmed, path: destination };
};

/**
 * Rename an application, i.e. its folder inside the applications directory.
 * Flows reference applications by this name, so the UI warns about it.
 * @param {string} applicationName
 * @param {string} newName - A single folder name, no slashes
 */
export const renameApplication = async (applicationName, newName) => {
  const appsPath = await paths.contextDir(['applications']);
  const from = path.join(appsPath, applicationName);

  if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) {
    throw new Error('Application not found');
  }

  const trimmed = applicationNameOf(newName);

  const to = path.join(appsPath, trimmed);

  if (to === from) {
    return { name: trimmed, slug: trimmed, previousName: applicationName };
  }

  if (fs.existsSync(to) && from.toLowerCase() !== to.toLowerCase()) {
    const error: NodeJS.ErrnoException = new Error(`An application named “${trimmed}” already exists`);
    error.code = 'EEXISTS';
    throw error;
  }

  fs.renameSync(from, to);

  // Applications are cached by file: drop the stale entries so the next parse
  // loads the renamed one from its new location
  appLoader.purge(from);

  return { name: trimmed, slug: trimmed, previousName: applicationName };
};

/**
 * Read an editable application file. Missing canonical files return empty
 * content with exists=false so the UI can offer creating them.
 * @param {string} applicationName
 * @param {string} relativePath
 */
export const readAppFile = async (applicationName, relativePath) => {
  const { absolute, relative } = await resolveAppFile(applicationName, relativePath);

  if (!fs.existsSync(absolute)) {
    return { path: relative, exists: false, content: '' };
  }

  return { path: relative, exists: true, content: fs.readFileSync(absolute, 'utf8') };
};

/**
 * Create or update an editable application file.
 * @param {string} applicationName
 * @param {string} relativePath
 * @param {string} content
 */
export const writeAppFile = async (applicationName, relativePath, content) => {
  const { absolute, relative } = await resolveAppFile(applicationName, relativePath);

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content ?? '', 'utf8');

  return { path: relative };
};
