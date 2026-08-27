// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';

// A throwaway context directory, so the tests never touch the real one. The
// "mock" prefix is what lets jest.mock's hoisted factory reference it.
const mockContext = fs.mkdtempSync(path.join(os.tmpdir(), 'lab34-env-'));

jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (parts) => require('path').join(mockContext, ...(parts || []))
}));

import * as env from '../../src/helpers/env';

const ENV_FILE = path.join(mockContext, '.env');
const GITIGNORE = path.join(mockContext, '.gitignore');

const read = () => fs.readFileSync(ENV_FILE, 'utf8');

beforeEach(() => {
  fs.rmSync(ENV_FILE, { force: true });
  fs.rmSync(GITIGNORE, { force: true });
});

describe('the context .env file', () => {
  test('reads nothing when the file does not exist', async () => {
    expect(await env.readAll()).toEqual({});
    expect(await env.read('SHAREPOINT_CLIENT_SECRET')).toBeUndefined();
  });

  test('writes a variable and reads it back', async () => {
    await env.write('SHAREPOINT_CLIENT_SECRET', 'super-secret');

    expect(read()).toBe('SHAREPOINT_CLIENT_SECRET=super-secret\n');
    expect(await env.read('SHAREPOINT_CLIENT_SECRET')).toBe('super-secret');
  });

  test('replaces a variable, leaving the other lines exactly as they were', async () => {
    fs.writeFileSync(ENV_FILE, [
      '# The secrets of the integrations',
      'OTHER=untouched',
      'SHAREPOINT_CLIENT_SECRET=old',
      ''
    ].join('\n'));

    await env.write('SHAREPOINT_CLIENT_SECRET', 'new');

    expect(read()).toBe([
      '# The secrets of the integrations',
      'OTHER=untouched',
      'SHAREPOINT_CLIENT_SECRET=new',
      ''
    ].join('\n'));
  });

  test('quotes a value a bare one could not carry', async () => {
    await env.write('SECRET', 'a value with spaces # and a hash');

    expect(read()).toBe('SECRET="a value with spaces # and a hash"\n');
    expect(await env.read('SECRET')).toBe('a value with spaces # and a hash');
  });

  test('keeps a line break, and reads it back as one', async () => {
    await env.write('SECRET', 'first line\nsecond line');

    expect(read()).toBe('SECRET="first line\\nsecond line"\n');
    expect(await env.read('SECRET')).toBe('first line\nsecond line');
  });

  test('quotes a value with a value-ending character it does not carry', async () => {
    await env.write('SECRET', 'say "hi"');
    expect(await env.read('SECRET')).toBe('say "hi"');

    await env.write('SECRET', 'say "hi", it\'s me');
    expect(await env.read('SECRET')).toBe('say "hi", it\'s me');
  });

  test('removes the variable when the value is null or empty', async () => {
    fs.writeFileSync(ENV_FILE, 'KEEP=yes\nSECRET=gone\n');

    await env.write('SECRET', null);

    expect(read()).toBe('KEEP=yes\n');
    expect(await env.read('SECRET')).toBeUndefined();
  });

  test('removing a variable that is not there does nothing', async () => {
    await env.write('SECRET', null);

    expect(fs.existsSync(ENV_FILE)).toBe(false);
  });

  test('appends without leaving a blank line between variables', async () => {
    await env.write('FIRST', 'one');
    await env.write('SECOND', 'two');

    expect(read()).toBe('FIRST=one\nSECOND=two\n');
  });

  test('recognises a variable written with export', async () => {
    fs.writeFileSync(ENV_FILE, 'export SECRET=old\n');

    await env.write('SECRET', 'new');

    expect(read()).toBe('SECRET=new\n');
  });

  test('keeps the file out of git, once', async () => {
    await env.write('SECRET', 'one');
    await env.write('SECRET', 'two');

    const ignored = fs.readFileSync(GITIGNORE, 'utf8');
    expect(ignored.split('\n').filter(line => line.trim() === '.env')).toHaveLength(1);
  });

  test('does not add a .gitignore entry twice when one is already there', async () => {
    fs.writeFileSync(GITIGNORE, 'node_modules\n/.env\n');

    await env.write('SECRET', 'one');

    expect(fs.readFileSync(GITIGNORE, 'utf8')).toBe('node_modules\n/.env\n');
  });

  test('a .env nobody can parse reads as empty rather than throwing', async () => {
    fs.mkdirSync(ENV_FILE, { recursive: true });

    expect(await env.readAll()).toEqual({});

    fs.rmSync(ENV_FILE, { recursive: true, force: true });
  });
});
