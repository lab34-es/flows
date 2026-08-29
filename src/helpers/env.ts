import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import * as paths from './paths';

/**
 * The context's own .env file.
 *
 * Applications keep their variables in their own env folder, one file per
 * environment. This is a different thing: a single `.env` at the root of the
 * context directory, where the integrations store the secrets a user typed in
 * Settings -- the SharePoint client secret, for instance.
 *
 * Secrets live here rather than in config/<name>.json so that the config
 * files stay shareable (they can be committed, diffed, reviewed) while the
 * one file that must not travel is the one everybody already knows not to
 * commit. To make that true rather than hoped for, writing a value also adds
 * `.env` to the context's .gitignore.
 */

const FILE = '.env';

/**
 * Absolute path of the context's .env file.
 * @returns {Promise<string>}
 */
const filePath = async () => paths.contextDir([FILE]);

export { FILE, filePath };

/**
 * Every variable the file declares. A missing file is an empty one.
 * @returns {Promise<Record<string, string>>}
 */
const readAll = async (): Promise<Record<string, string>> => {
  const file = await filePath();

  if (!fs.existsSync(file)) { return {}; }

  try {
    return dotenv.parse(fs.readFileSync(file, 'utf8'));
  }
  catch {
    return {};
  }
};

export { readAll };

/**
 * One variable of the context's .env file.
 * @param {string} key
 * @returns {Promise<string|undefined>} undefined when it is not set or empty
 */
const read = async (key: string): Promise<string | undefined> => {
  const value = (await readAll())[key];
  return value ? String(value) : undefined;
};

export { read };

/**
 * A value as a .env file can carry it, and as dotenv reads it back.
 *
 * dotenv strips the surrounding quotes and expands `\n` inside double quoted
 * values -- but it does not undo any other escape, so a value is quoted with
 * a character it does not itself contain rather than escaped.
 *
 * @param {string} value
 * @returns {string}
 */
const serialize = (value: string): string => {
  const text = String(value);

  // Plain enough to need no quoting at all
  if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(text)) { return text; }

  // Double quotes are the readable choice, and the only ones that can carry
  // a line break
  if (!text.includes('"')) {
    return `"${text.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
  }

  // Single quotes and backticks keep every character of the value verbatim,
  // line breaks included
  if (!text.includes('\'')) { return `'${text}'`; }
  if (!text.includes('`')) { return `\`${text}\``; }

  // A value carrying all three kinds of quote: nothing can hold it verbatim,
  // so escape the one that would end it early
  return `"${text.replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`;
};

export { serialize };

/**
 * Keep the context's .env out of git. The file holds secrets, and a context
 * directory is very often a repository -- the entry is added once, and never
 * duplicated.
 * @returns {Promise<void>}
 */
const ignoreInGit = async () => {
  try {
    const ignoreFile = await paths.contextDir(['.gitignore']);
    const current = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, 'utf8') : '';

    const listed = current
      .split('\n')
      .some(line => line.trim().replace(/^\/+/, '') === FILE);

    if (listed) { return; }

    const addition = [
      ...(current && !current.endsWith('\n') ? [''] : []),
      '# Secrets of the integrations configured in Settings',
      FILE,
      ''
    ].join('\n');

    fs.writeFileSync(ignoreFile, current + addition, 'utf8');
  }
  catch (ex) {
    // Not being able to write .gitignore is not a reason to lose the secret
    console.error('Could not add .env to the context .gitignore:', ex.message);
  }
};

/**
 * Set (or remove) one variable, leaving every other line -- comments and
 * order included -- exactly as it was.
 *
 * @param {string} key
 * @param {string|null|undefined} value - null or empty removes the variable
 * @returns {Promise<void>}
 */
const write = async (key: string, value: string | null | undefined) => {
  const file = await filePath();
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

  const lines = current ? current.split('\n') : [];
  const declares = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  const at = lines.findIndex(line => declares.test(line));

  const text = value === null || value === undefined ? '' : String(value);

  if (!text) {
    if (at === -1) { return; }
    lines.splice(at, 1);
  }
  else if (at === -1) {
    // Drop the trailing empty line the previous write left, so the new
    // variable does not land after a blank one
    if (lines.length && lines[lines.length - 1] === '') { lines.pop(); }
    lines.push(`${key}=${serialize(text)}`);
  }
  else {
    lines[at] = `${key}=${serialize(text)}`;
  }

  const contents = lines.length ? `${lines.join('\n').replace(/\n*$/, '')}\n` : '';

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { encoding: 'utf8', mode: 0o600 });

  if (text) { await ignoreInGit(); }
};

export { write };
