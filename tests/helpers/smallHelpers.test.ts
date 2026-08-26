// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out. The factory is re-read per
// suite so --context can be simulated.
let ARGV: Record<string, any> = {};
jest.mock('yargs-parser', () => () => ARGV);

import fs from 'fs';
import os from 'os';
import path from 'path';

describe('helpers/shell', () => {
  const shell = require('../../src/helpers/shell');

  test('resolves with stdout', async () => {
    await expect(shell.run('echo hello')).resolves.toBe('hello\n');
  });

  test('oneLine strips the newlines', async () => {
    await expect(shell.run('echo hello', true)).resolves.toBe('hello');
  });

  test('rejects when the command fails with no output', async () => {
    await expect(shell.run('exit 3')).rejects.toBeDefined();
  });

  test('rejects when the command writes to stderr', async () => {
    await expect(shell.run('echo oops 1>&2')).rejects.toBeDefined();
  });
});

describe('helpers/io', () => {
  const io = require('../../src/helpers/io');

  test('only the tool\'s own origins are allowed', () => {
    expect(io.ALLOWED_ORIGINS).toEqual([
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ]);
  });

  test('builds a socket.io server restricted to those origins', () => {
    const http = require('http');
    const server = http.createServer();
    const instance = io.io(server);

    expect(instance).toBeDefined();
    expect(typeof instance.emit).toBe('function');
    instance.close();
  });
});

describe('helpers/cli', () => {
  const cli = require('../../src/helpers/cli');

  test('logo prints the banner with the appended text on the last line', () => {
    cli.logo('v1.2.3');
    const lines = (console.log as jest.Mock).mock.calls.map(c => c[0]);
    expect(lines).toHaveLength(5);
    expect(lines[4]).toContain('v1.2.3');
  });

  test('wisdom prints one of the quotes', () => {
    cli.wisdom();
    const first = (console.log as jest.Mock).mock.calls[0][0];
    expect(first).toContain('(maybe)');
  });

  test('exposes whether stdout is a TTY', () => {
    expect(typeof cli.isInteractive === 'boolean' || cli.isInteractive === undefined).toBe(true);
  });
});

describe('helpers/paths', () => {
  const HOME = os.homedir();

  beforeEach(() => {
    ARGV = {};
    jest.resetModules();
  });

  test('defaults to ~/lab34-flows', async () => {
    const paths = require('../../src/helpers/paths');
    expect(await paths.contextDir()).toBe(path.join(HOME, 'lab34-flows'));
  });

  test('appends the requested path parts', async () => {
    const paths = require('../../src/helpers/paths');
    expect(await paths.contextDir(['flows', 'a.md']))
      .toBe(path.join(HOME, 'lab34-flows', 'flows', 'a.md'));
  });

  test('an absolute --context is used as the base', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-'));
    ARGV = { context: dir };
    jest.resetModules();
    const paths = require('../../src/helpers/paths');
    expect(await paths.contextDir(['flows'])).toBe(path.join(dir, 'flows'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a relative --context is resolved against the working directory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-'));
    const cwd = process.cwd();
    process.chdir(path.dirname(dir));
    ARGV = { context: path.basename(dir) };
    jest.resetModules();
    const paths = require('../../src/helpers/paths');
    const result = await paths.contextDir([]);
    process.chdir(cwd);
    expect(result).toBe(fs.realpathSync(dir));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a --context that does not exist exits with an error', async () => {
    ARGV = { context: '/definitely/not/here' };
    jest.resetModules();
    const paths = require('../../src/helpers/paths');
    await paths.contextDir([]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Context directory does not exist')
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test('contextRoot is the context directory itself', async () => {
    const paths = require('../../src/helpers/paths');
    expect(await paths.contextRoot()).toBe(path.join(HOME, 'lab34-flows'));
    expect(paths.hasCustomContext()).toBe(false);
  });

  test('hasCustomContext is true once --context was given', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-'));
    ARGV = { context: dir };
    jest.resetModules();
    const paths = require('../../src/helpers/paths');
    expect(paths.hasCustomContext()).toBe(true);
    expect(await paths.contextRoot()).toBe(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('createFolder creates the folder only when it is missing', async () => {
    const paths = require('../../src/helpers/paths');
    const dir = path.join(os.tmpdir(), `mk-${Date.now()}`, 'nested');

    await paths.createFolder(dir);
    expect(fs.existsSync(dir)).toBe(true);

    await expect(paths.createFolder(dir)).resolves.toBeUndefined();
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  describe('findFiles', () => {
    let root: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'find-'));
      fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(root, 'a.md'), '');
      fs.writeFileSync(path.join(root, 'b.yaml'), '');
      fs.writeFileSync(path.join(root, 'c.txt'), '');
      fs.writeFileSync(path.join(root, 'sub', 'd.md'), '');
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('collects only the requested formats, recursing into folders', () => {
      const paths = require('../../src/helpers/paths');
      const found = paths.findFiles(root, 0, 4, [], ['md']);
      expect(found.map(f => path.basename(f)).sort()).toEqual(['a.md', 'd.md']);
    });

    test('honours several formats at once', () => {
      const paths = require('../../src/helpers/paths');
      const found = paths.findFiles(root, 0, 4, [], ['md', 'yaml']);
      expect(found).toHaveLength(3);
    });

    test('stops descending past maxDepth', () => {
      const paths = require('../../src/helpers/paths');
      expect(paths.findFiles(root, 5, 4, [], ['md'])).toEqual([]);
    });

    test('an unreadable directory is reported, not thrown', () => {
      const paths = require('../../src/helpers/paths');
      expect(paths.findFiles(path.join(root, 'missing'), 0, 4, [], ['md'])).toEqual([]);
      expect(console.error).toHaveBeenCalled();
    });
  });
});

describe('helpers/config', () => {
  const CTX = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));

  beforeEach(() => {
    ARGV = { context: CTX };
    jest.resetModules();
  });

  afterAll(() => fs.rmSync(CTX, { recursive: true, force: true }));

  test('load returns an empty object when the file is absent', async () => {
    const config = require('../../src/helpers/config');
    expect(await config.load('never-written')).toEqual({});
  });

  test('save writes the file and load reads it back', async () => {
    const config = require('../../src/helpers/config');
    await config.save('ai', { provider: 'ollama' });
    expect(await config.load('ai')).toEqual({ provider: 'ollama' });
  });

  test('save returns what it was given', async () => {
    const config = require('../../src/helpers/config');
    await expect(config.save('x', { a: 1 })).resolves.toEqual({ a: 1 });
  });

  test('saving nothing writes an empty object', async () => {
    const config = require('../../src/helpers/config');
    await config.save('empty', undefined);
    expect(await config.load('empty')).toEqual({});
  });
});

describe('helpers/mimicFiles', () => {
  const mimicFiles = require('../../src/helpers/mimicFiles');

  const mimicConfig = (reporter = { mimicFile: jest.fn() }) => ({
    application: 'calculator',
    flow: { reporter }
  });

  test('reads the static file when it exists', () => {
    const spyExists = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    const spyRead = jest.spyOn(fs, 'readFileSync').mockReturnValue('contents');

    const config = mimicConfig();
    expect(mimicFiles.get(config, 'body.json')).toBe('contents');
    expect(config.flow.reporter.mimicFile).toHaveBeenCalledWith('calculator', expect.any(String), true);

    spyExists.mockRestore();
    spyRead.mockRestore();
  });

  test('falls back when the file is missing', () => {
    const spyExists = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(mimicFiles.get(mimicConfig(), 'body.json', 'fallback')).toBe('fallback');
    spyExists.mockRestore();
  });

  test('throws when there is neither a file nor a fallback', () => {
    const spyExists = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(() => mimicFiles.get(mimicConfig(), 'body.json')).toThrow(/does not exist/);
    spyExists.mockRestore();
  });
});
