jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';

const CONTEXT = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-'));
jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (parts) => require('path').join(CONTEXT, ...(parts || []))
}));

import * as apps from '../../src/helpers/applications';

const appsDir = path.join(CONTEXT, 'applications');

const write = (relative: string, content = '') => {
  const file = path.join(appsDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
};

/**
 * A minimal self-describing application, in the shape the loader expects:
 * TypeScript, with the ESM import and export style applications now use.
 */
const CALC_INDEX = `
import { validate, applications } from '@lab34/flows';
import type { Context, Parameters } from '@lab34/flows';

/**
 * Adds two numbers.
 * @param {number} a - First
 * @returns {200} The sum
 */
export const add = applications.handler([
  validate.body({ type: 'object', properties: { a: { type: 'number' } } }),
  (ctx: Context, parameters: Parameters) => ({ sum: 1 })
], 'add');
`;

/** The same application as it was written before the TypeScript migration. */
const CALC_INDEX_JS = `
const { validate, applications } = require('lab34-flows');

/**
 * Adds two numbers.
 * @param {number} a - First
 * @returns {200} The sum
 */
module.exports.add = applications.handler([
  validate.body({ type: 'object', properties: { a: { type: 'number' } } }),
  (ctx, parameters) => ({ sum: 1 })
], 'add');
`;

beforeEach(() => {
  fs.rmSync(appsDir, { recursive: true, force: true });
  fs.mkdirSync(appsDir, { recursive: true });
});

afterAll(() => fs.rmSync(CONTEXT, { recursive: true, force: true }));

describe('applications.handler', () => {
  test('describes itself, exposing the body and query schemas', () => {
    const bodySchema = { type: 'object' };
    const querySchema = { type: 'object' };
    const bodyValidator: any = () => {}; bodyValidator.schemaType = 'body'; bodyValidator.schema = bodySchema;
    const queryValidator: any = () => {}; queryValidator.schemaType = 'query'; queryValidator.schema = querySchema;

    const fn = apps.handler([bodyValidator, queryValidator, () => 'done'], 'add');

    expect(fn('describe', null, null)).toEqual({
      name: 'add',
      description: null,
      parameters: { body: bodySchema, query: querySchema }
    });
  });

  test('a leading string is still accepted as the description', () => {
    const fn = apps.handler(['Legacy description', () => 'done'], 'add');
    expect(fn('describe', null, null).description).toBe('Legacy description');
  });

  test('running it calls every validator and then the last function', () => {
    const validator = jest.fn();
    const execute = jest.fn().mockReturnValue('result');
    const ctx = { env: {} };

    const result = apps.handler([validator, execute], 'add')(ctx, { body: {} }, { memory: {} });

    expect(validator).toHaveBeenCalledWith(ctx, { body: {} }, { memory: {} });
    expect(execute).toHaveBeenCalled();
    expect(result).toBe('result');
  });

  test('a leading description is not called as a validator', () => {
    const execute = jest.fn().mockReturnValue('ok');
    expect(apps.handler(['desc', execute], 'add')({}, {}, {})).toBe('ok');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('non-function entries are skipped', () => {
    const execute = jest.fn().mockReturnValue('ok');
    expect(apps.handler([null as any, execute], 'add')({}, {}, {})).toBe('ok');
  });
});

describe('applications.description', () => {
  test('is an identity passthrough kept for application authors', () => {
    expect(apps.description('text')).toBe('text');
  });
});

describe('applications.parseApplications', () => {
  test('is empty when there is no applications directory', async () => {
    fs.rmSync(appsDir, { recursive: true, force: true });
    expect(await apps.parseApplications()).toEqual([]);
  });

  test('ignores loose files, listing only application folders', async () => {
    write('notes.txt', 'x');
    fs.mkdirSync(path.join(appsDir, 'calculator'), { recursive: true });
    const list = await apps.parseApplications();
    expect(list.map(a => a.name)).toEqual(['calculator']);
  });

  test('loads an application, its methods and its JSDoc', async () => {
    write('calculator/index.ts', CALC_INDEX);

    const [app] = await apps.parseApplications();

    expect(app.name).toBe('calculator');
    expect(app.slug).toBe('calculator');
    expect(app.errors).toEqual([]);

    const add = app.methods.find(m => m.name === 'add')!;
    expect(add.implemented).toBe(true);
    expect(add.description).toBe('Adds two numbers.');
    expect(add.docs).toBeDefined();
  });

  test('never touches the source it loads', async () => {
    const file = write('calculator/index.ts', CALC_INDEX);
    await apps.parseApplications();
    expect(fs.readFileSync(file, 'utf8')).toBe(CALC_INDEX);
  });

  test('loads an application still written in JavaScript', async () => {
    write('calculator/index.js', CALC_INDEX_JS);

    const [app] = await apps.parseApplications();

    expect(app.errors).toEqual([]);
    expect(app.methods.find(m => m.name === 'add')!.implemented).toBe(true);
  });

  test('index.ts wins over an index.js left behind by a migration', async () => {
    write('calculator/index.ts', CALC_INDEX);
    write('calculator/index.js', 'throw new Error("the old one");');

    const [app] = await apps.parseApplications();

    expect(app.errors).toEqual([]);
  });

  test('an export that is not a method is left out rather than failing', async () => {
    write('calculator/index.ts', `${CALC_INDEX}\nexport const VERSION = '1';`);

    const [app] = await apps.parseApplications();

    expect(app.errors).toEqual([]);
    expect(app.methods.map(m => m.name)).toEqual(['add']);
  });

  test('a type error does not stop an application from loading', async () => {
    write('calculator/index.ts', CALC_INDEX.replace("'add');", "'add') as unknown as never;"));

    const [app] = await apps.parseApplications();

    expect(app.errors).toEqual([]);
  });

  test('a syntax error is reported against the application', async () => {
    write('calculator/index.ts', 'export const broken = (');

    const [app] = await apps.parseApplications();

    expect(app.errors.length).toBeGreaterThan(0);
  });

  test('reports an application whose code throws, without failing the list', async () => {
    write('broken/index.js', 'throw new Error("boom");');

    const [app] = await apps.parseApplications();

    expect(app.name).toBe('broken');
    expect(app.errors[0].message).toContain('boom');
    expect(app.errors[0].stack).toBeDefined();
  });

  test('an application with no index.js still lists', async () => {
    write('empty/README.md', '# Empty');
    const [app] = await apps.parseApplications();
    expect(app.methods).toEqual([]);
    expect(app.readme).toBe('# Empty');
  });

  test('reads the README case-insensitively', async () => {
    write('calculator/readme.md', '# Calc');
    const [app] = await apps.parseApplications();
    expect(app.readme).toBe('# Calc');
  });

  test('warns that docs.json is no longer used', async () => {
    write('calculator/index.ts', CALC_INDEX);
    write('calculator/docs.json', '{}');

    const [app] = await apps.parseApplications();

    expect(app.errors.some(e => e.message.includes('docs.json is no longer used'))).toBe(true);
  });

  test('a documented but unimplemented method is listed as not implemented', async () => {
    write('calculator/index.ts', [
      '/**', ' * Subtracts.', ' * @returns {200} diff', ' */', 'export const subtract = 1;'
    ].join('\n'));

    const [app] = await apps.parseApplications();
    const subtract = app.methods.find(m => m.name === 'subtract')!;

    expect(subtract).toBeDefined();
    expect(subtract.implemented).toBe(false);
  });

  test('env files are listed with their values, secrets masked', async () => {
    write('calculator/env/local.env', 'BASE_URL=http://x\nTOKEN=abcdefghijkl\n');

    const [app] = await apps.parseApplications();
    const local = app.envFiles.find(e => e.name === 'local')!;

    expect(local.contents).toEqual(expect.arrayContaining([
      { key: 'BASE_URL', isSecret: false, value: 'http://x' },
      { key: 'TOKEN', isSecret: true, value: '********ijkl' }
    ]));
  });

  test('a short secret is masked entirely', async () => {
    write('calculator/env/local.env', 'PASSWORD=abc\n');
    const [app] = await apps.parseApplications();
    expect(app.envFiles[0].contents[0].value).toBe('***');
  });

  test('an empty secret is left as it is', async () => {
    write('calculator/env/local.env', 'SECRET=\n');
    const [app] = await apps.parseApplications();
    expect(app.envFiles[0].contents[0].value).toBe('');
  });

  test('an application with no env folder reports none', async () => {
    write('calculator/index.ts', CALC_INDEX);
    const [app] = await apps.parseApplications();
    expect(app.envFiles).toEqual([]);
  });

  test('only .env files are picked up', async () => {
    write('calculator/env/local.env', 'A=1\n');
    write('calculator/env/notes.txt', 'x');
    const [app] = await apps.parseApplications();
    expect(app.envFiles.map(e => e.name)).toEqual(['local']);
  });

  test('a .env.example is a template, not an env file', async () => {
    write('calculator/env/local.env', 'A=1\n');
    write('calculator/env/prod.env.example', 'A=\nTOKEN=\n');

    const [app] = await apps.parseApplications();

    expect(app.envFiles.map(e => e.name)).toEqual(['local']);
    expect(app.envTemplates.map(t => t.name)).toEqual(['prod']);
    expect(app.envTemplates[0].contents.map(c => c.key)).toEqual(['A', 'TOKEN']);
  });

  test('an application with no env folder reports no templates', async () => {
    write('calculator/index.ts', CALC_INDEX);
    const [app] = await apps.parseApplications();
    expect(app.envTemplates).toEqual([]);
  });
});

describe('applications.allPossibleEnvironments', () => {
  test('is the sorted union across applications, without blanks', async () => {
    write('a/env/prod.env', 'A=1\n');
    write('a/env/local.env', 'A=1\n');
    write('b/env/local.env', 'B=1\n');

    expect(await apps.allPossibleEnvironments()).toEqual(['local', 'prod']);
  });

  test('counts environments only declared by a template', async () => {
    write('a/env/local.env', 'A=1\n');
    write('a/env/prod.env.example', 'A=\n');

    expect(await apps.allPossibleEnvironments()).toEqual(['local', 'prod']);
  });

  test('is empty when nothing declares an environment', async () => {
    write('a/index.ts', 'export const nothing = 1;');
    expect(await apps.allPossibleEnvironments()).toEqual([]);
  });
});

describe('applications.environmentsStatus', () => {
  test('reports each application against each environment', async () => {
    write('a/env/local.env', 'A=1\n');
    write('a/env/prod.env.example', 'A=\nTOKEN=\n');
    write('b/env/local.env', 'B=1\n');

    const status = await apps.environmentsStatus();

    expect(status.environments).toEqual(['local', 'prod']);

    const a = status.applications.find(app => app.slug === 'a')!;
    expect(a.environments.local).toMatchObject({ exists: true, hasTemplate: false, missingKeys: [] });
    expect(a.environments.prod).toMatchObject({
      exists: false,
      hasTemplate: true,
      file: 'env/prod.env',
      template: 'env/prod.env.example'
    });

    const b = status.applications.find(app => app.slug === 'b')!;
    expect(b.environments.prod).toMatchObject({ exists: false, hasTemplate: false });

    expect(status.summary).toEqual({ total: 4, missing: 2, creatable: 1, incomplete: 0 });
  });

  test('flags an env file missing variables of its template', async () => {
    write('a/env/prod.env', 'A=1\n');
    write('a/env/prod.env.example', 'A=\nTOKEN=\n');

    const status = await apps.environmentsStatus();
    const a = status.applications[0];

    expect(a.environments.prod.exists).toBe(true);
    expect(a.environments.prod.missingKeys).toEqual(['TOKEN']);
    expect(status.summary.incomplete).toBe(1);
  });
});

describe('applications.createMissingEnvFiles', () => {
  test('creates every missing env file from its template, verbatim', async () => {
    write('a/env/prod.env.example', 'A=\nTOKEN=\n');
    write('b/env/prod.env.example', 'B=\n');
    write('b/env/prod.env', 'B=already-there\n');

    const created = await apps.createMissingEnvFiles();

    expect(created).toEqual([
      { application: 'a', environment: 'prod', path: path.join(appsDir, 'a/env/prod.env') }
    ]);
    expect(fs.readFileSync(path.join(appsDir, 'a/env/prod.env'), 'utf8')).toBe('A=\nTOKEN=\n');
    // The existing file is never replaced
    expect(fs.readFileSync(path.join(appsDir, 'b/env/prod.env'), 'utf8')).toBe('B=already-there\n');
  });

  test('narrows to one environment and one application', async () => {
    write('a/env/prod.env.example', 'A=\n');
    write('a/env/staging.env.example', 'A=\n');
    write('b/env/prod.env.example', 'B=\n');

    const created = await apps.createMissingEnvFiles({ environment: 'prod', application: 'a' });

    expect(created.map(c => `${c.application}/${c.environment}`)).toEqual(['a/prod']);
    expect(fs.existsSync(path.join(appsDir, 'a/env/staging.env'))).toBe(false);
    expect(fs.existsSync(path.join(appsDir, 'b/env/prod.env'))).toBe(false);
  });
});

describe('applications.addEnvironmentToAll', () => {
  test('creates the env file in every application that lacks it', async () => {
    write('a/env/local.env', 'A=1\nTOKEN=abc\n');
    write('b/env/staging.env', 'B=1\n');

    const created = await apps.addEnvironmentToAll('staging', 'local');

    expect(created.map(c => c.application)).toEqual(['a']);

    const content = fs.readFileSync(path.join(appsDir, 'a/env/staging.env'), 'utf8');
    expect(content).toContain('A=');
    expect(content).toContain('TOKEN=');
    expect(content).not.toContain('abc');
  });

  test('prefers the application template over the base environment', async () => {
    write('a/env/local.env', 'A=1\n');
    write('a/env/staging.env.example', 'FROM_TEMPLATE=\n');

    await apps.addEnvironmentToAll('staging', 'local');

    expect(fs.readFileSync(path.join(appsDir, 'a/env/staging.env'), 'utf8')).toBe('FROM_TEMPLATE=\n');
  });

  test('creates a commented stub when there is nothing to copy from', async () => {
    write('a/index.ts', 'export const nothing = 1;');

    await apps.addEnvironmentToAll('staging');

    expect(fs.readFileSync(path.join(appsDir, 'a/env/staging.env'), 'utf8')).toContain('# Environment "staging"');
  });

  test('rejects names that are not a plain file-name stem', async () => {
    await expect(apps.addEnvironmentToAll('')).rejects.toThrow('Environment name is required');
    await expect(apps.addEnvironmentToAll('../evil')).rejects.toThrow('Invalid environment name');
    await expect(apps.addEnvironmentToAll('.hidden')).rejects.toThrow('Invalid environment name');
    await expect(apps.addEnvironmentToAll('prod.env')).rejects.toThrow('Invalid environment name');
  });
});

describe('applications.updateEnvFile', () => {
  test('updates an existing key, leaving the others', async () => {
    const file = write('calculator/env/local.env', 'A=1\nB=2\n');

    await apps.updateEnvFile(file, 'A', '9');

    const written = fs.readFileSync(file, 'utf8');
    expect(written).toContain('A=9');
    expect(written).toContain('B=2');
  });

  test('adds a key that was not there', async () => {
    const file = write('calculator/env/local.env', 'A=1\n');
    await apps.updateEnvFile(file, 'NEW', 'x');
    expect(fs.readFileSync(file, 'utf8')).toContain('NEW=x');
  });

  test('rejects when the file cannot be read', async () => {
    await expect(apps.updateEnvFile(path.join(appsDir, 'ghost.env'), 'A', '1')).rejects.toBeDefined();
  });
});

describe('applications.loadAll', () => {
  test('registers every application that has an entry point', async () => {
    write('calculator/index.ts', CALC_INDEX);
    write('legacy/index.js', CALC_INDEX_JS);
    write('noindex/README.md', '# x');

    await apps.loadAll();

    expect(apps.applications.calculator.add).toBeInstanceOf(Function);
    expect(apps.applications.legacy.add).toBeInstanceOf(Function);
    expect(apps.applications.noindex).toBeUndefined();
  });

  test('picks up an edit made since the last load', async () => {
    write('calculator/index.ts', CALC_INDEX);
    await apps.loadAll();

    write('calculator/index.ts', CALC_INDEX.replace(/add/g, 'subtract'));
    await apps.loadAll();

    expect(apps.applications.calculator.subtract).toBeInstanceOf(Function);
  });
});

describe('applications.summary', () => {
  test('prints each application and its methods', async () => {
    write('calculator/index.ts', CALC_INDEX);

    await apps.summary();

    const out = (console.log as jest.Mock).mock.calls.map(c => c.join(' ')).join('\n');
    expect(out).toContain('Applications Summary');
    expect(out).toContain('Application: calculator');
    expect(out).toContain('- add:');
  });

  test('says so when there are no applications', async () => {
    await apps.summary();
    const out = (console.log as jest.Mock).mock.calls.map(c => c.join(' ')).join('\n');
    expect(out).toContain('No applications found.');
  });

  test('says so when an application has no methods', async () => {
    write('empty/README.md', '# x');
    await apps.summary();
    const out = (console.log as jest.Mock).mock.calls.map(c => c.join(' ')).join('\n');
    expect(out).toContain('No methods found.');
  });
});
