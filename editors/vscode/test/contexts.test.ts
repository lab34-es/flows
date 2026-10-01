import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { contextOf, DEFAULT_VIEW, isContext, isFlowFile, listEnvironments, listFlows, listViews } from '../src/core/contexts';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ronsel-contexts-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

/** Write files under a fresh folder: { 'flows/a.md': '# A' }. */
const folder = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(scratch, 'ctx-'));
  Object.entries(files).forEach(([file, content]) => {
    const absolute = path.join(root, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (file.endsWith('/')) { fs.mkdirSync(absolute, { recursive: true }); }
    else { fs.writeFileSync(absolute, content); }
  });
  return root;
};

describe('isContext', () => {
  test('a flows folder and applications next to it make a context', () => {
    assert.equal(isContext(folder({ 'flows/a.md': '', 'applications/': '' })), true);
  });

  test('so does any other mark a context leaves', () => {
    assert.equal(isContext(folder({ 'flows/': '', 'views.yaml': '' })), true);
    assert.equal(isContext(folder({ 'flows/': '', 'test-runs/': '' })), true);
    assert.equal(isContext(folder({ 'flows/': '', '.examples-seeded': '' })), true);
  });

  test('a flows folder alone is somebody else\'s', () => {
    assert.equal(isContext(folder({ 'flows/a.md': '' })), false);
    assert.equal(isContext(folder({ 'applications/': '' })), false);
    assert.equal(isContext(path.join(scratch, 'missing')), false);
  });
});

describe('contextOf', () => {
  test('is the folder holding the flows folder a flow is in', () => {
    const root = folder({ 'flows/payments/refund.md': '', 'applications/': '' });

    assert.equal(contextOf(path.join(root, 'flows', 'payments', 'refund.md')), root);
  });

  test('a flows folder that is not a context is looked past', () => {
    const root = folder({ 'flows/archive/flows/old.md': '', 'applications/': '' });

    assert.equal(contextOf(path.join(root, 'flows', 'archive', 'flows', 'old.md')), root);
  });

  test('is nothing for a file in no context', () => {
    const root = folder({ 'docs/readme.md': '' });

    assert.equal(contextOf(path.join(root, 'docs', 'readme.md')), null);
    assert.equal(contextOf(path.join(root, 'docs', 'readme.md'), () => true), null);
  });
});

describe('listFlows', () => {
  test('lists every flow, relative and sorted, past what the UI does not show', () => {
    const root = folder({
      'flows/b.md': '',
      'flows/a.markdown': '',
      'flows/notes.txt': '',
      'flows/payments/refund.md': '',
      'flows/.hidden/secret.md': '',
      'flows/node_modules/pkg/readme.md': ''
    });

    assert.deepEqual(listFlows(path.join(root, 'flows')), ['a.markdown', 'b.md', 'payments/refund.md']);
  });

  test('a flows folder that is not there has none', () => {
    assert.deepEqual(listFlows(path.join(scratch, 'nowhere')), []);
  });

  test('follows a linked folder', () => {
    const root = folder({ 'shared/common.md': '', 'flows/': '' });
    fs.symlinkSync(path.join(root, 'shared'), path.join(root, 'flows', 'shared'), 'dir');

    assert.deepEqual(listFlows(path.join(root, 'flows')), ['shared/common.md']);
  });
});

describe('isFlowFile', () => {
  test('is a Markdown file', () => {
    assert.equal(isFlowFile('/x/a.md'), true);
    assert.equal(isFlowFile('/x/a.MARKDOWN'), true);
    assert.equal(isFlowFile('/x/a.yaml'), false);
  });
});

describe('listEnvironments', () => {
  test('is the union of every application\'s env files and templates', () => {
    const root = folder({
      'applications/payments/env/local.env': '',
      'applications/payments/env/uat.env.example': '',
      'applications/ledger/env/local.env': '',
      'applications/ledger/env/staging.env': '',
      'applications/ledger/env/README.md': '',
      'applications/ledger/env/odd.env/': '',
      'applications/ledger/index.ts': '',
      'applications/no-env/index.ts': ''
    });

    assert.deepEqual(listEnvironments(root), ['local', 'staging', 'uat']);
  });

  test('a context without applications has none', () => {
    assert.deepEqual(listEnvironments(folder({ 'flows/': '' })), []);
  });
});

describe('listViews', () => {
  test('lists the views, named the way the package names them', () => {
    const root = folder({ 'views.yaml': 'views:\n  - name: Smoke tests\n  - type: table\n  - name: "  Nightly "\n' });

    assert.deepEqual(listViews(root), ['Smoke tests', 'View 2', 'Nightly']);
  });

  test('without views.yaml, or views in it, there is the default one', () => {
    assert.deepEqual(listViews(folder({ 'flows/': '' })), [DEFAULT_VIEW]);
    assert.deepEqual(listViews(folder({ 'views.yaml': 'filters: {}\n' })), [DEFAULT_VIEW]);
    assert.deepEqual(listViews(folder({ 'views.yaml': '' })), [DEFAULT_VIEW]);
  });

  test('a views.yaml that does not parse says so', () => {
    assert.throws(() => listViews(folder({ 'views.yaml': 'views: [broken' })), /Invalid views.yaml/);
  });
});
