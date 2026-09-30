jest.mock('yargs-parser', () => () => ({}));
jest.mock('../../src/helpers/paths');

import fs from 'fs';
import os from 'os';
import path from 'path';

import * as paths from '../../src/helpers/paths';
import * as bootstrap from '../../src/helpers/bootstrap';

let ctx: string;

beforeEach(() => {
  jest.clearAllMocks();
  ctx = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-'));
  (paths.contextDir as jest.Mock).mockImplementation(
    async (parts: string[]) => path.join(ctx, ...(parts || []))
  );
});

afterEach(() => fs.rmSync(ctx, { recursive: true, force: true }));

describe('bootstrap.ensureDefaults', () => {
  test('creates the applications and flows folders', async () => {
    await bootstrap.ensureDefaults();
    expect(fs.existsSync(path.join(ctx, 'applications'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'flows'))).toBe(true);
  });

  test('seeds the bundled example applications and flows', async () => {
    await bootstrap.ensureDefaults();

    expect(fs.existsSync(path.join(ctx, 'applications', 'calculator', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'applications', 'httpbin'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'applications', 'jsonplaceholder'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'flows', 'examples', '01-welcome.md'))).toBe(true);
  });

  test('writes a marker so seeding only ever happens once', async () => {
    await bootstrap.ensureDefaults();
    const marker = path.join(ctx, '.examples-seeded');
    expect(fs.existsSync(marker)).toBe(true);
    expect(JSON.parse(fs.readFileSync(marker, 'utf8')).seededAt).toBeDefined();
  });

  test('a deleted example does not come back on the next start', async () => {
    await bootstrap.ensureDefaults();
    fs.rmSync(path.join(ctx, 'applications', 'calculator'), { recursive: true, force: true });

    await bootstrap.ensureDefaults();

    expect(fs.existsSync(path.join(ctx, 'applications', 'calculator'))).toBe(false);
  });

  test('an existing application folder is left untouched', async () => {
    const dest = path.join(ctx, 'applications', 'calculator');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'index.js'), '// mine');

    await bootstrap.ensureDefaults();

    expect(fs.readFileSync(path.join(dest, 'index.js'), 'utf8')).toBe('// mine');
  });

  test('an existing example flow is left untouched', async () => {
    const dest = path.join(ctx, 'flows', 'examples');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, '01-welcome.md'), '# mine');

    await bootstrap.ensureDefaults();

    expect(fs.readFileSync(path.join(dest, '01-welcome.md'), 'utf8')).toBe('# mine');
  });

  test('a folder that already holds something is served as it is', async () => {
    fs.writeFileSync(path.join(ctx, 'notes.txt'), 'mine');

    await bootstrap.ensureDefaults();

    expect(fs.existsSync(path.join(ctx, 'applications'))).toBe(false);
    expect(fs.existsSync(path.join(ctx, 'flows'))).toBe(false);
    expect(fs.existsSync(path.join(ctx, '.examples-seeded'))).toBe(false);
    expect(fs.existsSync(path.join(ctx, 'tsconfig.json'))).toBe(false);
  });

  test('a context that is already there keeps its tsconfig up to date', async () => {
    fs.mkdirSync(path.join(ctx, 'flows'));

    await bootstrap.ensureDefaults();

    // No examples: they only ever go into an empty folder
    expect(fs.existsSync(path.join(ctx, '.examples-seeded'))).toBe(false);
    expect(fs.existsSync(path.join(ctx, 'applications'))).toBe(false);
    // But the editor support follows the installation
    expect(fs.existsSync(path.join(ctx, 'tsconfig.json'))).toBe(true);
  });

  test('a folder holding only .DS_Store still counts as empty', async () => {
    fs.writeFileSync(path.join(ctx, '.DS_Store'), '');

    await bootstrap.ensureDefaults();

    expect(fs.existsSync(path.join(ctx, 'flows', 'examples', '01-welcome.md'))).toBe(true);
  });

  test('seeding never prevents the tool from starting', async () => {
    (paths.contextDir as jest.Mock).mockRejectedValue(new Error('no context'));

    await expect(bootstrap.ensureDefaults()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      'Could not seed default examples:', 'no context'
    );
  });
});

describe('bootstrap.initialise', () => {
  const logged = () => (console.log as jest.Mock).mock.calls.map(call => call.join(' ')).join('\n');

  // Also the guard on the order of things: seed() creates flows/ and
  // applications/ first thing, so an emptiness read from inside it would
  // answer "not empty" for a folder that was empty a moment earlier, and
  // nothing below would be copied
  test('an empty folder gets the examples', async () => {
    await bootstrap.initialise();

    expect(fs.existsSync(path.join(ctx, 'flows', 'examples', '01-welcome.md'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'applications', 'calculator'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'tsconfig.json'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, '.examples-seeded'))).toBe(true);
    expect(logged()).toContain('The folder was empty');
  });

  test('a folder with anything at all in it gets the scaffolding and no examples', async () => {
    fs.writeFileSync(path.join(ctx, 'notes.txt'), 'mine');

    await bootstrap.initialise();

    // Nothing of the examples
    expect(fs.existsSync(path.join(ctx, 'flows', 'examples'))).toBe(false);
    expect(fs.readdirSync(path.join(ctx, 'applications'))).toEqual([]);
    // But everything that is additive and gets out of the way
    expect(fs.existsSync(path.join(ctx, 'flows'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'applications'))).toBe(true);
    expect(fs.readFileSync(path.join(ctx, 'tsconfig.json'), 'utf8')).toContain('Generated by ronsel');
    expect(fs.readFileSync(path.join(ctx, 'notes.txt'), 'utf8')).toBe('mine');
    expect(logged()).toContain('no examples seeded');
  });

  test('not seeding leaves no marker, so an emptied folder can still be seeded', async () => {
    fs.writeFileSync(path.join(ctx, 'notes.txt'), 'mine');
    await bootstrap.initialise();

    expect(fs.existsSync(path.join(ctx, '.examples-seeded'))).toBe(false);

    // The same folder, emptied: the examples are still available to it
    fs.rmSync(ctx, { recursive: true, force: true });
    fs.mkdirSync(ctx);
    await bootstrap.initialise();

    expect(fs.existsSync(path.join(ctx, 'flows', 'examples', '01-welcome.md'))).toBe(true);
  });

  test('running it twice over neither duplicates nor restores anything', async () => {
    await bootstrap.initialise();
    const marker = fs.readFileSync(path.join(ctx, '.examples-seeded'), 'utf8');
    const welcome = path.join(ctx, 'flows', 'examples', '01-welcome.md');
    fs.writeFileSync(welcome, '# mine now');
    fs.rmSync(path.join(ctx, 'applications', 'calculator'), { recursive: true, force: true });

    await bootstrap.initialise();

    // Nothing copied a second time, nothing brought back
    expect(fs.readFileSync(welcome, 'utf8')).toBe('# mine now');
    expect(fs.existsSync(path.join(ctx, 'applications', 'calculator'))).toBe(false);
    expect(fs.readFileSync(path.join(ctx, '.examples-seeded'), 'utf8')).toBe(marker);
    // The scaffolding it does keep is there
    expect(fs.existsSync(path.join(ctx, 'flows'))).toBe(true);
    expect(fs.existsSync(path.join(ctx, 'tsconfig.json'))).toBe(true);
  });

  test('a folder holding only .DS_Store still counts as empty', async () => {
    fs.writeFileSync(path.join(ctx, '.DS_Store'), '');

    await bootstrap.initialise();

    expect(fs.existsSync(path.join(ctx, 'flows', 'examples', '01-welcome.md'))).toBe(true);
  });

  test('never throws: the rest of the setup is still worth doing', async () => {
    (paths.contextDir as jest.Mock).mockRejectedValue(new Error('no context'));

    await expect(bootstrap.initialise()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('Could not seed default examples:', 'no context');
  });
});

describe('bootstrap.isContextDirectory', () => {
  test('an empty folder is one, and so is a folder with flows in it', () => {
    expect(bootstrap.isContextDirectory(ctx)).toBe(true);

    fs.mkdirSync(path.join(ctx, 'flows'));
    expect(bootstrap.isContextDirectory(ctx)).toBe(true);
  });

  test('somebody else\'s folder is not', () => {
    fs.writeFileSync(path.join(ctx, 'notes.txt'), 'mine');

    expect(bootstrap.isContextDirectory(ctx)).toBe(false);
  });
});

describe('bootstrap.ensureTypeScriptConfig', () => {
  const read = () => fs.readFileSync(path.join(ctx, 'tsconfig.json'), 'utf8');

  test('writes a tsconfig pointing at the types of this installation', async () => {
    await bootstrap.ensureTypeScriptConfig();

    const written = read();
    const config = JSON.parse(written.slice(written.indexOf('{')));

    // Resolved from the package root rather than matched against a folder
    // name: a checkout is not always named after the package, so asserting on
    // the name only ever tested what the clone directory happened to be called.
    const packageRoot = path.resolve(__dirname, '..', '..');
    const built = path.join(packageRoot, 'dist', 'index.d.ts');
    const expected = fs.existsSync(built) ? built : path.join(packageRoot, 'src', 'index.ts');

    expect(config.include).toEqual(['applications/**/*.ts']);
    expect(config.compilerOptions.paths['ronsel'][0]).toBe(expected);
    expect(config.compilerOptions.paths['@lab34/flows']).toEqual(
      config.compilerOptions.paths['ronsel']
    );
    expect(config.compilerOptions.paths['lab34-flows']).toEqual(
      config.compilerOptions.paths['ronsel']
    );
  });

  test('is created by ensureDefaults too', async () => {
    await bootstrap.ensureDefaults();
    expect(fs.existsSync(path.join(ctx, 'tsconfig.json'))).toBe(true);
  });

  test('is never dropped into a folder that is not a context of ours', async () => {
    fs.writeFileSync(path.join(ctx, 'README.md'), '# somebody else\'s project');

    await bootstrap.ensureTypeScriptConfig();

    expect(fs.existsSync(path.join(ctx, 'tsconfig.json'))).toBe(false);
  });

  test('refreshes a stale generated file, so the paths follow the install', async () => {
    await bootstrap.ensureTypeScriptConfig();
    const generated = read();

    fs.writeFileSync(path.join(ctx, 'tsconfig.json'), generated.replace(/"paths".*/, '"paths": {},'));
    await bootstrap.ensureTypeScriptConfig();

    expect(read()).toBe(generated);
  });

  test('a file the user took over is never rewritten', async () => {
    fs.writeFileSync(path.join(ctx, 'tsconfig.json'), '{ "mine": true }');
    await bootstrap.ensureTypeScriptConfig();
    expect(read()).toBe('{ "mine": true }');
  });

  test('a file generated before the rename is still rewritten', async () => {
    fs.writeFileSync(
      path.join(ctx, 'tsconfig.json'),
      '/* Generated by @lab34/flows. */\n{ "compilerOptions": {} }'
    );
    await bootstrap.ensureTypeScriptConfig();
    expect(read()).toContain('Generated by ronsel');
    expect(JSON.parse(read().replace(/^\/\*[\s\S]*?\*\/\n/, '')).compilerOptions.paths['ronsel']).toBeDefined();
  });

  test('leaves an up-to-date file alone', async () => {
    await bootstrap.ensureTypeScriptConfig();
    const before = fs.statSync(path.join(ctx, 'tsconfig.json')).mtimeMs;

    await bootstrap.ensureTypeScriptConfig();

    expect(fs.statSync(path.join(ctx, 'tsconfig.json')).mtimeMs).toBe(before);
  });

  test('a failure is reported, never thrown', async () => {
    (paths.contextDir as jest.Mock).mockRejectedValue(new Error('no context'));

    await expect(bootstrap.ensureTypeScriptConfig()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      'Could not write tsconfig.json for the applications:', 'no context'
    );
  });
});
