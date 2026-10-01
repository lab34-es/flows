import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { fromFolder, fromPackage, fromSetting, globalModules, locate } from '../src/core/install';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ronsel-install-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

let count = 0;

/** A ronsel package (or something posing as one) under a fresh folder. */
const installation = (relative: string, manifest: Record<string, unknown>, withScript = true) => {
  const root = path.join(scratch, `case-${++count}`);
  const directory = path.join(root, relative);
  fs.mkdirSync(path.join(directory, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest));
  if (withScript) { fs.writeFileSync(path.join(directory, 'dist', 'cli.js'), ''); }
  return { root, directory };
};

const RONSEL = { name: 'ronsel', version: '2.3.0', bin: { ronsel: './dist/cli.js' } };

describe('fromPackage', () => {
  test('answers the CLI of a ronsel package', () => {
    const { directory } = installation('pkg', RONSEL);

    assert.deepEqual(fromPackage(directory), {
      script: path.join(directory, 'dist', 'cli.js'),
      version: '2.3.0',
      root: directory
    });
  });

  test('takes a bin given as a string too', () => {
    const { directory } = installation('pkg', { name: 'ronsel', version: '1.0.0', bin: 'dist/cli.js' });

    assert.equal(fromPackage(directory)?.script, path.join(directory, 'dist', 'cli.js'));
  });

  test('is nothing for another package, a missing bin or a build that is not there', () => {
    assert.equal(fromPackage(installation('a', { ...RONSEL, name: 'other' }).directory), null);
    assert.equal(fromPackage(installation('b', { name: 'ronsel', version: '1.0.0' }).directory), null);
    assert.equal(fromPackage(installation('c', RONSEL, false).directory), null);
    assert.equal(fromPackage(path.join(scratch, 'nowhere')), null);
  });
});

describe('fromFolder', () => {
  test('finds the install of the folder, or of a folder above it, as node would', () => {
    const { root, directory } = installation('node_modules/ronsel', RONSEL);
    const deep = path.join(root, 'e2e', 'flows');
    fs.mkdirSync(deep, { recursive: true });

    assert.equal(fromFolder(deep)?.root, directory);
  });

  test('finds ronsel\'s own repository, for whoever is working on it', () => {
    const { root } = installation('.', RONSEL);
    const devContext = path.join(root, '.dev-context');
    fs.mkdirSync(devContext);

    assert.equal(fromFolder(devContext)?.root, root);
  });

  test('is nothing when there is none', () => {
    const lonely = path.join(scratch, 'lonely');
    fs.mkdirSync(lonely);

    assert.equal(fromFolder(lonely), null);
  });
});

describe('fromSetting', () => {
  test('takes the folder of the package', () => {
    const { directory } = installation('pkg', RONSEL);

    assert.equal(fromSetting(directory)?.version, '2.3.0');
  });

  test('takes the script, and the version of the package it is in', () => {
    const { directory } = installation('pkg', RONSEL);
    const script = path.join(directory, 'dist', 'cli.js');

    assert.deepEqual(fromSetting(script), { script, version: '2.3.0', root: directory });
  });

  test('a script that belongs to no package has no version', () => {
    const loose = path.join(scratch, 'loose-cli.js');
    fs.writeFileSync(loose, '');

    assert.deepEqual(fromSetting(loose), { script: loose, version: '', root: scratch });
  });

  test('is nothing for a path that is not there', () => {
    assert.equal(fromSetting(path.join(scratch, 'missing', 'cli.js')), null);
  });
});

describe('locate', () => {
  test('the setting has the last word', () => {
    const { directory: configured } = installation('configured', RONSEL);
    const { root: context } = installation('node_modules/ronsel', { ...RONSEL, version: '9.9.9' });

    assert.equal(locate(context, { configured })?.root, configured);
  });

  test('the context\'s own install comes before the workspace\'s', () => {
    const { root: context } = installation('node_modules/ronsel', { ...RONSEL, version: '1.1.1' });
    const { root: workspace } = installation('node_modules/ronsel', { ...RONSEL, version: '2.2.2' });

    assert.equal(locate(context, { folders: [workspace] })?.version, '1.1.1');
  });

  test('then the workspace\'s, then the global one', () => {
    const empty = path.join(scratch, 'empty-context');
    fs.mkdirSync(empty);
    const { root: workspace } = installation('node_modules/ronsel', { ...RONSEL, version: '2.2.2' });
    const { root: global } = installation('ronsel', { ...RONSEL, version: '3.3.3' });

    assert.equal(locate(empty, { folders: [workspace] })?.version, '2.2.2');
    assert.equal(locate(empty, { globalRoot: global })?.version, '3.3.3');
    assert.equal(locate(empty, { globalRoot: null }), null);
    assert.equal(locate(empty), null);
  });
});

describe('globalModules', () => {
  test('is where npm installs globally', async () => {
    const found = await globalModules();

    assert.ok(found === null || path.isAbsolute(found), String(found));
  });

  test('is nothing when npm cannot be asked', async () => {
    assert.equal(await globalModules(path.join(scratch, 'no-npm')), null);
  });
});
