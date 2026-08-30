jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';

const CONTEXT = fs.mkdtempSync(path.join(os.tmpdir(), 'env-transfer-'));
jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (parts) => require('path').join(CONTEXT, ...(parts || [])),
  contextRoot: async () => CONTEXT
}));

import * as envTransfer from '../../src/helpers/envTransfer';

const appsDir = path.join(CONTEXT, 'applications');

/** Write a file under applications/, creating what it needs. */
const write = (relative: string, content = '') => {
  const file = path.join(appsDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
};

const read = (relative: string) => fs.readFileSync(path.join(appsDir, relative), 'utf8');

/** A document as this module writes them, from the applications alone. */
const document = (applications) => YAML.stringify({ version: 1, applications });

beforeEach(() => {
  fs.rmSync(appsDir, { recursive: true, force: true });
  fs.mkdirSync(appsDir, { recursive: true });
});

afterAll(() => fs.rmSync(CONTEXT, { recursive: true, force: true }));

describe('inventory', () => {
  test('lists application, environment and variable, in that order', async () => {
    write('payments/env/uat.env', 'API_URL=https://uat\nAPI_TOKEN=abc123\n');
    write('payments/env/st.env', 'API_URL=https://st\n');
    write('checkout/env/st.env', 'TIMEOUT=3000\n');

    const { applications } = await envTransfer.inventory();

    expect(applications.map(app => app.slug)).toEqual(['checkout', 'payments']);

    const payments = applications.find(app => app.slug === 'payments')!;
    expect(payments.environments.map(env => env.name)).toEqual(['st', 'uat']);

    const uat = payments.environments.find(env => env.name === 'uat')!;
    expect(uat.file).toBe('applications/payments/env/uat.env');
    expect(uat.variables).toEqual([
      { key: 'API_URL', empty: false, secret: false },
      { key: 'API_TOKEN', empty: false, secret: true }
    ]);
  });

  test('an empty variable is flagged, so nobody sends a blank', async () => {
    write('payments/env/st.env', 'API_URL=\n');

    const { applications } = await envTransfer.inventory();

    expect(applications[0].environments[0].variables).toEqual([
      { key: 'API_URL', empty: true, secret: false }
    ]);
  });

  test('templates are not variables to export, and neither is an application without files', async () => {
    write('payments/env/st.env.example', 'API_URL=\n');
    write('checkout/README.md', '# checkout');

    const { applications } = await envTransfer.inventory();

    expect(applications).toEqual([]);
  });

  test('a file nobody can read leaves the environment empty rather than failing', async () => {
    write('payments/env/st.env', 'API_URL=https://st\n');
    const { applications } = await envTransfer.inventory();
    expect(applications[0].environments[0].variables).toHaveLength(1);
  });

  test('no applications folder at all is an empty inventory', async () => {
    fs.rmSync(appsDir, { recursive: true, force: true });
    expect(await envTransfer.inventory()).toEqual({ applications: [] });
  });
});

describe('exportSelection', () => {
  beforeEach(() => {
    write('payments/env/uat.env', '# The payments API\nAPI_URL=https://uat\nAPI_TOKEN=abc123\n');
    write('checkout/env/uat.env', 'TIMEOUT=3000\n');
  });

  test('writes the applications, environments and variables picked, hierarchically', async () => {
    const { yaml, summary } = await envTransfer.exportSelection([
      { application: 'payments', environment: 'uat', keys: ['API_TOKEN'] },
      { application: 'checkout', environment: 'uat' }
    ]);

    expect(YAML.parse(yaml)).toEqual({
      version: 1,
      applications: {
        payments: { uat: { API_TOKEN: 'abc123' } },
        checkout: { uat: { TIMEOUT: '3000' } }
      }
    });

    expect(summary).toEqual({ applications: 2, environments: 2, variables: 2 });
    expect(yaml).toMatch(/^# Environment variables exported from lab34\/flows\./);
  });

  test('a value that looks like a number still reads back as the string it is', async () => {
    const { yaml } = await envTransfer.exportSelection([{ application: 'checkout', environment: 'uat' }]);
    expect(typeof YAML.parse(yaml).applications.checkout.uat.TIMEOUT).toBe('string');
  });

  test('an entry whose file is gone is left out rather than failing the export', async () => {
    const { summary } = await envTransfer.exportSelection([
      { application: 'payments', environment: 'uat' },
      { application: 'payments', environment: 'production' },
      { application: 'gone', environment: 'uat' }
    ]);

    expect(summary).toEqual({ applications: 1, environments: 1, variables: 2 });
  });

  test('a name that is not a path segment never reaches the disk', async () => {
    await expect(envTransfer.exportSelection([
      { application: '../../etc', environment: 'uat' }
    ])).rejects.toThrow(/nothing to export/i);
  });

  test('an empty selection is refused', async () => {
    await expect(envTransfer.exportSelection([])).rejects.toThrow(/at least one variable/i);
    await expect(envTransfer.exportSelection(undefined as any)).rejects.toThrow(/at least one variable/i);
  });
});

describe('importDocument', () => {
  test('creates the env file of an environment the application does not have yet', async () => {
    write('payments/README.md', '# payments');

    const result = await envTransfer.importDocument(document({
      payments: { uat: { API_URL: 'https://uat', API_TOKEN: 'abc123' } }
    }));

    expect(result.summary).toMatchObject({ files: 1, created: 1, updated: 0, added: 2, changed: 0 });
    expect(result.files[0]).toMatchObject({
      application: 'payments',
      environment: 'uat',
      file: 'applications/payments/env/uat.env',
      created: true,
      added: ['API_URL', 'API_TOKEN']
    });

    expect(read('payments/env/uat.env')).toBe('API_URL=https://uat\nAPI_TOKEN=abc123\n');
  });

  test('updates an existing file, keeping its comments, its order and what it does not carry', async () => {
    write('payments/env/uat.env', [
      '# The payments API',
      'API_URL=https://old',
      '',
      '# Left alone',
      'DATABASE_URL=postgres://local',
      ''
    ].join('\n'));

    const result = await envTransfer.importDocument(document({
      payments: { uat: { API_URL: 'https://uat', API_TOKEN: 'abc123' } }
    }));

    expect(result.files[0]).toMatchObject({
      created: false,
      added: ['API_TOKEN'],
      changed: ['API_URL'],
      unchanged: []
    });
    expect(result.summary).toMatchObject({ created: 0, updated: 1, added: 1, changed: 1 });

    expect(read('payments/env/uat.env')).toBe([
      '# The payments API',
      'API_URL=https://uat',
      '',
      '# Left alone',
      'DATABASE_URL=postgres://local',
      'API_TOKEN=abc123',
      ''
    ].join('\n'));
  });

  test('a variable that already holds the value is reported as unchanged', async () => {
    write('payments/env/uat.env', 'API_URL=https://uat\n');

    const result = await envTransfer.importDocument(document({
      payments: { uat: { API_URL: 'https://uat' } }
    }));

    expect(result.files[0]).toMatchObject({ added: [], changed: [], unchanged: ['API_URL'] });
    expect(result.summary).toMatchObject({ updated: 0, unchanged: 1 });
  });

  test('a value that needs quoting comes back as it went in', async () => {
    write('payments/env/uat.env', '');

    await envTransfer.importDocument(document({
      payments: { uat: { GREETING: 'hello world # not a comment' } }
    }));

    expect(read('payments/env/uat.env')).toBe('GREETING="hello world # not a comment"\n');
  });

  test('numbers and booleans are read as the strings a .env file carries', async () => {
    write('payments/env/uat.env', '');

    await envTransfer.importDocument('applications:\n  payments:\n    uat:\n      PORT: 3000\n      DEBUG: true\n');

    expect(read('payments/env/uat.env')).toBe('PORT=3000\nDEBUG=true\n');
  });

  test('an empty value is a value: the variable is written blank', async () => {
    write('payments/env/uat.env', '');

    await envTransfer.importDocument('applications:\n  payments:\n    uat:\n      API_TOKEN:\n');

    expect(read('payments/env/uat.env')).toBe('API_TOKEN=\n');
  });

  test('dryRun reports the very same changes and writes nothing', async () => {
    write('payments/env/uat.env', 'API_URL=https://old\n');

    const doc = document({ payments: { uat: { API_URL: 'https://uat', API_TOKEN: 'abc' } } });

    const preview = await envTransfer.importDocument(doc, { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(read('payments/env/uat.env')).toBe('API_URL=https://old\n');

    const applied = await envTransfer.importDocument(doc);
    expect(applied.files).toEqual(preview.files.map(file => ({ ...file })));
    expect(read('payments/env/uat.env')).toBe('API_URL=https://uat\nAPI_TOKEN=abc\n');
  });

  test('dryRun does not create the file it says it would create', async () => {
    write('payments/README.md', '# payments');

    const result = await envTransfer.importDocument(
      document({ payments: { uat: { API_URL: 'https://uat' } } }),
      { dryRun: true }
    );

    expect(result.files[0]).toMatchObject({ created: true });
    expect(fs.existsSync(path.join(appsDir, 'payments/env/uat.env'))).toBe(false);
  });

  test('an application this context does not have is reported, not created', async () => {
    const result = await envTransfer.importDocument(document({
      unknown: { uat: { API_URL: 'https://uat' } }
    }));

    expect(result.files).toEqual([]);
    expect(result.skipped).toEqual([
      { application: 'unknown', reason: 'no such application in this context' }
    ]);
    expect(fs.existsSync(path.join(appsDir, 'unknown'))).toBe(false);
  });

  test('names that are not path segments, and variable names that are not names, are skipped', async () => {
    write('payments/env/uat.env', '');

    const result = await envTransfer.importDocument(document({
      '../escape': { uat: { A: '1' } },
      payments: { '../..': { A: '1' }, uat: { 'not a name': '1', GOOD: '1' } }
    }));

    expect(result.skipped).toEqual([
      { application: '../escape', reason: 'not a usable application name' },
      { application: 'payments', environment: '../..', reason: 'not a usable environment name' },
      { application: 'payments', environment: 'uat', key: 'not a name', reason: 'not a usable variable name' }
    ]);
    expect(read('payments/env/uat.env')).toBe('GOOD=1\n');
  });

  test('a value with a shape of its own is not a value', async () => {
    write('payments/env/uat.env', '');

    const result = await envTransfer.importDocument(
      'applications:\n  payments:\n    uat:\n      LIST:\n        - a\n        - b\n'
    );

    expect(result.skipped).toEqual([
      { application: 'payments', environment: 'uat', key: 'LIST', reason: 'not a value' }
    ]);
  });

  test('an application or environment that is not a mapping is reported', async () => {
    write('payments/env/uat.env', '');

    const result = await envTransfer.importDocument('applications:\n  payments: nonsense\n');
    expect(result.skipped).toEqual([
      { application: 'payments', reason: 'expected one entry per environment' }
    ]);

    const other = await envTransfer.importDocument('applications:\n  payments:\n    uat: nonsense\n');
    expect(other.skipped).toEqual([
      { application: 'payments', environment: 'uat', reason: 'expected one entry per variable' }
    ]);
  });

  test('an environment with nothing left to write leaves the file alone', async () => {
    write('payments/env/uat.env', 'A=1\n');

    const result = await envTransfer.importDocument('applications:\n  payments:\n    uat: {}\n');

    expect(result.files).toEqual([]);
  });

  test('the document is accepted with its header trimmed off', async () => {
    write('payments/README.md', '# payments');

    const result = await envTransfer.importDocument('payments:\n  uat:\n    API_URL: https://uat\n');

    expect(result.summary).toMatchObject({ files: 1, created: 1, added: 1 });
  });

  test('a version left behind by the trimming is the header, not an application', async () => {
    const result = await envTransfer.importDocument('version: 1\npayments:\n  uat:\n    A: "1"\n');
    expect(result.skipped).toEqual([
      { application: 'payments', reason: 'no such application in this context' }
    ]);
  });

  test('a document that is not one is refused', async () => {
    await expect(envTransfer.importDocument('')).rejects.toThrow(/nothing to import/i);
    await expect(envTransfer.importDocument('   ')).rejects.toThrow(/nothing to import/i);
    await expect(envTransfer.importDocument('- a\n- b\n')).rejects.toThrow(/expected applications/i);
    await expect(envTransfer.importDocument('just a string')).rejects.toThrow(/expected applications/i);
    await expect(envTransfer.importDocument('applications: nope\n')).rejects.toThrow(/one entry per application/i);
    await expect(envTransfer.importDocument('a: [\n')).rejects.toThrow(/Invalid YAML/);
  });

  test('what is exported is what is imported', async () => {
    write('payments/env/uat.env', '# hello\nAPI_URL=https://uat\nAPI_TOKEN=a b"c\n');
    write('checkout/README.md', '# checkout');

    const { yaml } = await envTransfer.exportSelection([{ application: 'payments', environment: 'uat' }]);

    // The same document, landing in a context where checkout is the one that
    // needs it: the values survive the round trip verbatim
    const moved = yaml.replace(/^ {2}payments:$/m, '  checkout:');
    await envTransfer.importDocument(moved);

    expect(read('checkout/env/uat.env')).toBe('API_URL=https://uat\nAPI_TOKEN=\'a b"c\'\n');
  });
});

describe('importFile', () => {
  test('reads a document relative to the working directory', async () => {
    write('payments/env/uat.env', 'API_URL=https://old\n');

    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'env-transfer-cwd-'));
    fs.writeFileSync(path.join(cwd, 'env.yaml'), document({ payments: { uat: { API_URL: 'https://new' } } }));
    jest.spyOn(process, 'cwd').mockReturnValue(cwd);

    const result = await envTransfer.importFile('env.yaml');

    expect(result.file).toBe(path.join(cwd, 'env.yaml'));
    expect(result.summary).toMatchObject({ files: 1, changed: 1 });
    expect(read('payments/env/uat.env')).toBe('API_URL=https://new\n');

    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test('falls back to the context directory, so the document can live with the flows', async () => {
    write('payments/env/uat.env', '');
    fs.writeFileSync(
      path.join(CONTEXT, 'shared.yaml'),
      document({ payments: { uat: { API_TOKEN: 'abc' } } })
    );

    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'env-transfer-cwd-'));
    jest.spyOn(process, 'cwd').mockReturnValue(cwd);

    const result = await envTransfer.importFile('shared.yaml');

    expect(result.file).toBe(path.join(CONTEXT, 'shared.yaml'));
    expect(read('payments/env/uat.env')).toBe('API_TOKEN=abc\n');

    fs.rmSync(path.join(CONTEXT, 'shared.yaml'), { force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test('an absolute path is taken as it is', async () => {
    write('payments/env/uat.env', '');

    const file = path.join(CONTEXT, 'absolute.yaml');
    fs.writeFileSync(file, document({ payments: { uat: { A: '1' } } }));

    const result = await envTransfer.importFile(file);

    expect(result.file).toBe(file);
    expect(read('payments/env/uat.env')).toBe('A=1\n');

    fs.rmSync(file, { force: true });
  });

  test('a dry run reports without writing', async () => {
    write('payments/env/uat.env', 'A=1\n');

    const file = path.join(CONTEXT, 'preview.yaml');
    fs.writeFileSync(file, document({ payments: { uat: { A: '2' } } }));

    const result = await envTransfer.importFile(file, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.summary).toMatchObject({ changed: 1 });
    expect(read('payments/env/uat.env')).toBe('A=1\n');

    fs.rmSync(file, { force: true });
  });

  test('a document that is not there names where it was looked for', async () => {
    await expect(envTransfer.importFile('nope.yaml')).rejects.toThrow(/Document not found/);
    await expect(envTransfer.importFile('nope.yaml')).rejects.toThrow(CONTEXT);
    await expect(envTransfer.importFile('/definitely/not/here.yaml')).rejects.toThrow(/Document not found/);
    // A folder is not a document either
    await expect(envTransfer.importFile(appsDir)).rejects.toThrow(/Document not found/);
  });

  test('no path at all is refused', async () => {
    await expect(envTransfer.importFile('')).rejects.toThrow(/No document given/);
    await expect(envTransfer.importFile('   ')).rejects.toThrow(/No document given/);
    await expect(envTransfer.importFile(undefined as any)).rejects.toThrow(/No document given/);
    // `--import-env` with nothing after it
    await expect(envTransfer.importFile(true as any)).rejects.toThrow(/No document given/);
  });
});

describe('reportLines', () => {
  test('one line per file, with what happened to it', () => {
    const lines = envTransfer.reportLines({
      file: '/tmp/env.yaml',
      dryRun: false,
      files: [
        { file: 'applications/payments/env/uat.env', created: true, added: ['A', 'B'], changed: [], unchanged: [] },
        { file: 'applications/checkout/env/uat.env', created: false, added: ['C'], changed: ['D'], unchanged: ['E'] },
        { file: 'applications/billing/env/uat.env', created: false, added: [], changed: [], unchanged: ['F'] }
      ],
      skipped: [],
      summary: { files: 3, created: 1, updated: 2, added: 3, changed: 1, unchanged: 2, skipped: 0 }
    });

    expect(lines[0]).toBe('Environment variables — imported /tmp/env.yaml:');
    expect(lines[1]).toBe('  created applications/payments/env/uat.env — 2 added');
    expect(lines[2]).toBe('  updated applications/checkout/env/uat.env — 1 added, 1 overwritten, 1 already the same');
    // Nothing added and nothing overwritten: the file was already right
    expect(lines[3]).toBe('  unchanged applications/billing/env/uat.env — 1 already the same');
    expect(lines[4]).toContain('1 created, 2 updated');
    expect(lines[4]).toContain('3 added, 1 overwritten, 2 already the same');
  });

  test('what was left out is named, at whichever level it was', () => {
    const lines = envTransfer.reportLines({
      file: '/tmp/env.yaml',
      dryRun: false,
      files: [],
      skipped: [
        { application: 'billing', reason: 'no such application in this context' },
        { application: 'payments', environment: 'uat', key: 'not a name', reason: 'not a usable variable name' }
      ],
      summary: { files: 0, created: 0, updated: 0, added: 0, changed: 0, unchanged: 0, skipped: 2 }
    }).join('\n');

    expect(lines).toContain('skipped billing — no such application in this context');
    expect(lines).toContain('skipped payments · uat · not a name — not a usable variable name');
    expect(lines).toContain('2 skipped');
  });

  test('a dry run says so, and a document that does nothing says that', () => {
    const lines = envTransfer.reportLines({
      file: '/tmp/env.yaml',
      dryRun: true,
      files: [],
      skipped: [],
      summary: { files: 0, created: 0, updated: 0, added: 0, changed: 0, unchanged: 0, skipped: 0 }
    }).join('\n');

    expect(lines).toContain('what /tmp/env.yaml would do');
    expect(lines).toContain('nothing to do: the document changes nothing in this context');
    expect(lines).toContain('Dry run: nothing was written, and no flow was run.');
  });
});
