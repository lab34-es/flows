import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import YAML from 'yaml';

import * as paths from './paths';
import { serialize } from './env';
import { envFileOf } from './applications';

/**
 * Moving the values of the env files from one developer to the next.
 *
 * `applications/<app>/env/<environment>.env` holds secrets, so it stays out
 * of git: a new tester starts with empty files, and is then told one variable
 * at a time what goes in them. This is the shortcut — one YAML document
 * carrying whichever applications, environments and variables the sender
 * picked, and an import that writes them back into the right files: creating
 * the ones that are not there yet, and touching only the variables it carries
 * in the ones that are.
 *
 * The document is what travels, so it is plain and hierarchical, the way the
 * files themselves are organised:
 *
 *     version: 1
 *     applications:
 *       payments:
 *         uat:
 *           API_URL: https://uat.payments.example
 *
 * Names read from it become path segments, so they are validated as such and
 * an application that is not in the context is reported rather than created:
 * an import writes env files, never applications.
 */

/** The version this module writes, and the only one it reads. */
const VERSION = 1;

/** Application and environment names are one path segment each. */
const PLAIN_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** What a shell — and dotenv — accepts as a variable name. */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Keys whose value is worth a second look before it travels. This is a hint
 * for the UI, not a rule: the export carries the real values either way.
 */
const SECRET_LIKE = /secret|token|password|credential|authorization|api[-_]?key|private/i;

/**
 * The env files of one application, read straight off the disk rather than
 * through parseApplications(): the inventory is a file listing, and has no
 * use for the application's code, README or methods.
 * @param {string} appDir - Absolute path of the application folder
 * @returns {Array<{name: string, path: string}>}
 */
const envFilesOf = (appDir: string) => {
  const envDir = path.join(appDir, 'env');

  if (!fs.existsSync(envDir)) { return []; }

  return fs.readdirSync(envDir)
    .filter(file => file.endsWith('.env') && fs.statSync(path.join(envDir, file)).isFile())
    .map(file => ({ name: file.replace(/\.env$/i, ''), path: path.join(envDir, file) }))
    .filter(env => PLAIN_SEGMENT.test(env.name))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Everything that could be exported, as the three levels the export tree
 * renders: application, then environment, then variable.
 *
 * Values are not included — the tree only has to let someone pick — but
 * whether a variable is empty is, because an empty one is rarely worth
 * sending, and so is whether its name reads like a secret.
 *
 * @returns {Promise<{applications: Array<{name: string, slug: string, environments: Array<{name: string, file: string, variables: Array<{key: string, empty: boolean, secret: boolean}>}>}>}>}
 */
const inventory = async () => {
  const appsPath = await paths.contextDir(['applications']);

  if (!fs.existsSync(appsPath)) { return { applications: [] }; }

  const applications = fs.readdirSync(appsPath)
    .filter(name => PLAIN_SEGMENT.test(name) && fs.statSync(path.join(appsPath, name)).isDirectory())
    .sort((a, b) => a.localeCompare(b))
    .map(name => {
      const environments = envFilesOf(path.join(appsPath, name)).map(env => {
        let parsed: Record<string, string> = {};

        try {
          parsed = dotenv.parse(fs.readFileSync(env.path, 'utf8'));
        }
        catch {
          // A file nobody can parse has nothing to offer the tree
          parsed = {};
        }

        return {
          name: env.name,
          file: `applications/${name}/env/${env.name}.env`,
          variables: Object.keys(parsed)
            .filter(key => VARIABLE_NAME.test(key))
            .map(key => ({
              key,
              empty: !parsed[key],
              secret: SECRET_LIKE.test(key)
            }))
        };
      });

      return { name, slug: name, environments };
    })
    // An application with no env file has nothing to export
    .filter(app => app.environments.length > 0);

  return { applications };
};

export { inventory };

/**
 * The YAML document for a selection, read from the env files as they are now.
 *
 * The selection is what the tree ticked: one entry per application and
 * environment, with the variable names to take from it. No `keys` means the
 * whole file. Anything that is not on disk any more is left out rather than
 * failing the export.
 *
 * @param {Array<{application: string, environment: string, keys?: string[]}>} selection
 * @returns {Promise<{yaml: string, summary: {applications: number, environments: number, variables: number}}>}
 */
type Selection = { application: string, environment: string, keys?: string[] };

const exportSelection = async (selection: Selection[]) => {
  if (!Array.isArray(selection) || !selection.length) {
    throw new Error('Invalid selection: pick at least one variable to export');
  }

  const applications: Record<string, Record<string, Record<string, string>>> = {};
  const summary = { applications: 0, environments: 0, variables: 0 };

  // The document is sorted rather than left in the order the boxes happened
  // to be ticked in: the same picks then always produce the same text, which
  // is what makes two of these worth diffing
  const ordered = [...selection].sort((a, b) => (
    `${a?.application} ${a?.environment}`.localeCompare(`${b?.application} ${b?.environment}`)
  ));

  for (const entry of ordered) {
    const { application, environment } = entry || ({} as Selection);
    const envFile = await envFileOf(application, environment);

    if (!envFile || !fs.existsSync(envFile)) { continue; }

    const parsed = dotenv.parse(fs.readFileSync(envFile, 'utf8'));

    // The order of the file is the order of the document: whoever reads it
    // recognises their own file
    const keys = Object.keys(parsed).filter(key => (
      VARIABLE_NAME.test(key) && (!entry.keys || entry.keys.includes(key))
    ));

    if (!keys.length) { continue; }

    if (!applications[application]) { applications[application] = {}; }

    const variables: Record<string, string> = {};
    keys.forEach(key => { variables[key] = parsed[key]; });

    applications[application][environment] = variables;
    summary.variables += keys.length;
  }

  summary.applications = Object.keys(applications).length;
  summary.environments = Object.values(applications)
    .reduce((total, environments) => total + Object.keys(environments).length, 0);

  if (!summary.variables) {
    throw new Error('Nothing to export: none of the selected variables exist any more');
  }

  const header = [
    '# Environment variables exported from lab34/flows.',
    '# Paste it into the Import section of the Environment variables screen to',
    '# write these values into the env files of your own context.',
    '#',
    '# These are the real values, secrets included: share it the way you would',
    '# share a password, and keep it out of git.',
    ''
  ].join('\n');

  // lineWidth: 0 keeps long values -- URLs, tokens, connection strings -- on
  // the one line they came from, so the document can be read and edited
  const body = YAML.stringify({ version: VERSION, applications }, { lineWidth: 0 });

  return { yaml: `${header}${body}`, summary };
};

export { exportSelection };

/**
 * The applications block of a document, whichever way it was written: the
 * whole document as this module exports it, or just the applications when
 * somebody trimmed the header off by hand.
 * @param {string} text - YAML
 * @returns {Record<string, any>}
 */
const applicationsOf = (text: string): Record<string, any> => {
  if (!(text || '').trim()) {
    throw new Error('Invalid document: nothing to import');
  }

  let parsed;

  try {
    parsed = YAML.parse(text);
  }
  catch (ex) {
    throw new Error(`Invalid YAML: ${ex.message}`, { cause: ex });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid document: expected applications, each with its environments');
  }

  const bare = parsed.applications === undefined;
  const applications = bare ? parsed : parsed.applications;

  if (!applications || typeof applications !== 'object' || Array.isArray(applications)) {
    throw new Error('Invalid document: "applications" must list one entry per application');
  }

  // The bare form is the document with its header trimmed off, so a leftover
  // `version` there is the header, not an application
  if (bare) {
    const rest = { ...(applications as Record<string, any>) };
    delete rest.version;
    return rest;
  }

  return applications;
};

/**
 * A YAML scalar as a .env file can carry it. Numbers and booleans are written
 * unquoted often enough — `PORT: 3000` — that reading them back as strings is
 * the only useful answer; anything with a shape of its own is not a value.
 * @param {*} value
 * @returns {string|null} null when it cannot be one
 */
const valueOf = (value): string | null => {
  if (value === null || value === undefined) { return ''; }
  if (typeof value === 'string') { return value; }
  if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
  return null;
};

/**
 * Write the variables of one document entry into one env file, leaving every
 * other line of it — comments, order, the variables the document says nothing
 * about — exactly as it was.
 * @param {string} file - Absolute path of the env file
 * @param {Record<string, string>} values
 * @param {boolean} dryRun - Work out what would change, write nothing
 * @returns {{added: string[], changed: string[], unchanged: string[]}}
 */
const applyToFile = (file: string, values: Record<string, string>, dryRun: boolean) => {
  const existed = fs.existsSync(file);
  const current = existed ? fs.readFileSync(file, 'utf8') : '';
  const lines = current ? current.split('\n') : [];

  let parsed: Record<string, string> = {};
  try { parsed = dotenv.parse(current); }
  catch { parsed = {}; }

  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  Object.keys(values).forEach(key => {
    const value = values[key];

    // The name is a validated identifier, so it is safe in the pattern
    const declares = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    const at = lines.findIndex(line => declares.test(line));

    if (at === -1) {
      // Land after the last line that says something, not after the blank
      // one the previous write left
      if (lines.length && lines[lines.length - 1] === '') { lines.pop(); }
      lines.push(`${key}=${serialize(value)}`);
      added.push(key);
      return;
    }

    if (parsed[key] === value) {
      unchanged.push(key);
      return;
    }

    lines[at] = `${key}=${serialize(value)}`;
    changed.push(key);
  });

  if (!dryRun && (added.length || changed.length || !existed)) {
    const contents = lines.length ? `${lines.join('\n').replace(/\n*$/, '')}\n` : '';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, 'utf8');
  }

  return { added, changed, unchanged };
};

/**
 * Write a document back into the context's env files.
 *
 * Every application it names has to be one of the context's own — an import
 * fills env files in, it does not invent applications — but the environments
 * do not: an environment nobody has yet is exactly what is being shared, and
 * its file is created. Existing files keep everything the document does not
 * mention.
 *
 * Nothing is written when `dryRun` is set, which is how the UI shows what an
 * import would do before it does it. Both answer with the same report.
 *
 * @param {string} text - The YAML document
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - Report the changes without making them
 * @returns {Promise<{dryRun: boolean, files: Array<Object>, skipped: Array<Object>, summary: Object}>}
 */
const importDocument = async (text: string, { dryRun = false } = {}) => {
  const applications = applicationsOf(text);
  const appsPath = await paths.contextDir(['applications']);

  const files: Record<string, any>[] = [];
  const skipped: Record<string, any>[] = [];

  for (const application of Object.keys(applications)) {
    const environments = applications[application];

    if (!PLAIN_SEGMENT.test(application)) {
      skipped.push({ application, reason: 'not a usable application name' });
      continue;
    }

    if (!environments || typeof environments !== 'object' || Array.isArray(environments)) {
      skipped.push({ application, reason: 'expected one entry per environment' });
      continue;
    }

    if (!fs.existsSync(path.join(appsPath, application))) {
      skipped.push({ application, reason: 'no such application in this context' });
      continue;
    }

    for (const environment of Object.keys(environments)) {
      const variables = environments[environment];
      const envFile = await envFileOf(application, environment);

      if (!envFile) {
        skipped.push({ application, environment, reason: 'not a usable environment name' });
        continue;
      }

      if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
        skipped.push({ application, environment, reason: 'expected one entry per variable' });
        continue;
      }

      const values: Record<string, string> = {};

      Object.keys(variables).forEach(key => {
        const value = valueOf(variables[key]);

        if (!VARIABLE_NAME.test(key)) {
          skipped.push({ application, environment, key, reason: 'not a usable variable name' });
          return;
        }

        if (value === null) {
          skipped.push({ application, environment, key, reason: 'not a value' });
          return;
        }

        values[key] = value;
      });

      const exists = fs.existsSync(envFile);

      if (!Object.keys(values).length && exists) { continue; }

      const result = applyToFile(envFile, values, dryRun);

      files.push({
        application,
        environment,
        file: `applications/${application}/env/${environment}.env`,
        created: !exists,
        ...result
      });
    }
  }

  const summary = {
    files: files.length,
    created: files.filter(file => file.created).length,
    updated: files.filter(file => !file.created && (file.added.length || file.changed.length)).length,
    added: files.reduce((total, file) => total + file.added.length, 0),
    changed: files.reduce((total, file) => total + file.changed.length, 0),
    unchanged: files.reduce((total, file) => total + file.unchanged.length, 0),
    skipped: skipped.length
  };

  return { dryRun, files, skipped, summary };
};

export { importDocument };

/**
 * Where a document named on the command line actually is.
 *
 * An export usually arrives as a file somewhere outside the context — the
 * Downloads folder, a checkout of the pipeline's repository — so the path is
 * resolved against the working directory first. Falling back to the context
 * directory afterwards is what makes `--import-env env.yaml` work from
 * anywhere once the file lives next to the flows it is for.
 *
 * @param {string} file - Path as it was typed
 * @returns {Promise<string>} Absolute path of the file that was found
 */
const documentPath = async (file: string): Promise<string> => {
  // `--import-env` with no value reaches here as a boolean, and is the same
  // mistake as no flag at all: a path is what this needs
  if (typeof file !== 'string' || !file.trim()) {
    throw new Error('No document given: pass the path of the YAML to import');
  }

  const candidates = path.isAbsolute(file)
    ? [file]
    : [...new Set([path.resolve(process.cwd(), file), path.resolve(await paths.contextRoot(), file)])];

  const found = candidates.find(candidate => (
    fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  ));

  if (!found) {
    throw new Error(`Document not found: ${candidates.join(', nor ')}`);
  }

  return found;
};

/**
 * Import a document straight off the disk, which is how the CLI does it: the
 * UI has the text in a textarea, a command line has a path.
 *
 * The report is the one importDocument() answers with, plus the file it was
 * read from — with the path resolved, because "which of the two places it was
 * found in" is exactly what someone whose import wrote nothing wants to know.
 *
 * @param {string} file - Path of the YAML document
 * @param {Object} [options]
 * @param {boolean} [options.dryRun] - Report the changes without making them
 * @returns {Promise<{file: string, dryRun: boolean, files: Array<Object>, skipped: Array<Object>, summary: Object}>}
 */
const importFile = async (file: string, { dryRun = false } = {}) => {
  const resolved = await documentPath(file);
  const text = fs.readFileSync(resolved, 'utf8');

  return { file: resolved, ...(await importDocument(text, { dryRun })) };
};

export { importFile };

/**
 * The report of an import as the lines a terminal shows it in.
 *
 * One line per file, one per entry that was left out, and a last one with the
 * totals — the same three things the UI's plan renders, in the shape a log
 * scrolled past in a pipeline can still be read in.
 *
 * @param {Object} result - What importFile() answered with
 * @returns {string[]}
 */
const reportLines = (result): string[] => {
  const { file, dryRun, files, skipped, summary } = result || ({} as Record<string, any>);

  const lines = [dryRun
    ? `Environment variables — what ${file} would do:`
    : `Environment variables — imported ${file}:`];

  (files || []).forEach(entry => {
    // A file the document only confirmed is worth a line of its own: it says
    // the variables are there, which is not the same as nothing happening
    const verb = entry.created
      ? 'created'
      : (entry.added.length || entry.changed.length) ? 'updated' : 'unchanged';

    const counts = [
      entry.added.length && `${entry.added.length} added`,
      entry.changed.length && `${entry.changed.length} overwritten`,
      entry.unchanged.length && `${entry.unchanged.length} already the same`
    ].filter(Boolean).join(', ');

    lines.push(`  ${verb} ${entry.file}${counts ? ` — ${counts}` : ''}`);
  });

  (skipped || []).forEach(entry => {
    const what = [entry.application, entry.environment, entry.key].filter(Boolean).join(' · ');
    lines.push(`  skipped ${what} — ${entry.reason}`);
  });

  if (!(files || []).length && !(skipped || []).length) {
    lines.push('  nothing to do: the document changes nothing in this context');
  }

  lines.push(
    `  ${summary.created} created, ${summary.updated} updated; ` +
    `${summary.added} added, ${summary.changed} overwritten, ${summary.unchanged} already the same` +
    (summary.skipped ? `, ${summary.skipped} skipped` : '')
  );

  if (dryRun) {
    lines.push('  Dry run: nothing was written, and no flow was run.');
  }

  return lines;
};

export { reportLines };
