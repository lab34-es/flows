// yargs-parser v22 is ESM-only; Node's require(esm) handles it at runtime,
// but jest's module system does not — mock it out.
jest.mock('yargs-parser', () => () => ({}));

import fs from 'fs';
import os from 'os';
import path from 'path';
import YAML from 'yaml';

// A throwaway context directory, so the tests never touch the real one. The
// "mock" prefix is what lets jest.mock's hoisted factory reference it.
const mockContext = fs.mkdtempSync(path.join(os.tmpdir(), 'lab34-bases-'));

jest.mock('../../src/helpers/paths', () => ({
  contextDir: async (parts) => require('path').join(mockContext, ...(parts || [])),
  createFolder: async () => {},
  findFiles: () => []
}));

import * as bases from '../../src/helpers/bases';

const CONTEXT = mockContext;
const FLOWS_DIR = path.join(CONTEXT, 'flows');

/**
 * Write a markdown flow with the given frontmatter.
 * @param {string} relativePath
 * @param {Object} meta
 * @param {number} steps
 */
const writeFlow = (relativePath, meta, steps = 1) => {
  const absolute = path.join(FLOWS_DIR, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  const stepBlocks = Array.from({ length: steps }, () =>
    ['```step', 'application: calculator', 'method: add', '```'].join('\n')
  ).join('\n\n');

  fs.writeFileSync(
    absolute,
    `---\n${YAML.stringify(meta)}---\n\n# Heading\n\n${stepBlocks}\n`,
    'utf8'
  );
};

beforeAll(() => {
  fs.mkdirSync(FLOWS_DIR, { recursive: true });

  writeFlow('payments/fraud.md', {
    title: 'Fraud detection',
    description: 'A payment above the limit is held',
    owner: 'ana',
    priority: 8,
    reviewed: true,
    tags: ['smoke', 'payments']
  }, 3);

  writeFlow('payments/refunds/partial.md', {
    title: 'Partial refund',
    owner: 'bruno',
    priority: 3,
    reviewed: false
  }, 2);

  writeFlow('checkout/cart.md', {
    title: 'Cart',
    owner: 'ana',
    priority: 5,
    xray: {
      testKey: 'BOP-1769',
      status: 'Done',
      folder: '/ST/TLOC - 148'
    }
  }, 1);
});

afterAll(() => {
  fs.rmSync(CONTEXT, { recursive: true, force: true });
});

describe('bases.normalizeProperty', () => {
  it('qualifies a bare property name as frontmatter', () => {
    expect(bases.normalizeProperty('owner')).toBe('note.owner');
    expect(bases.normalizeProperty('note.owner')).toBe('note.owner');
    expect(bases.normalizeProperty('file.name')).toBe('file.name');
    expect(bases.normalizeProperty('formula.grade')).toBe('formula.grade');
    expect(bases.normalizeProperty('flow.steps')).toBe('flow.steps');
  });
});

describe('bases.defaultDisplayName', () => {
  it('humanizes a property id', () => {
    expect(bases.defaultDisplayName('note.nombre_comun')).toBe('Nombre comun');
    expect(bases.defaultDisplayName('note.zonaUsdaMin')).toBe('Zona Usda Min');
    expect(bases.defaultDisplayName('file.name')).toBe('Name');
  });

  it('reads a nested property as its whole path', () => {
    expect(bases.defaultDisplayName('note.xray.testKey')).toBe('Xray Test Key');
  });
});

describe('bases.viewSlug / bases.findView', () => {
  it('slugs a view name', () => {
    expect(bases.viewSlug('All flows')).toBe('all-flows');
    expect(bases.viewSlug('more than 80!')).toBe('more-than-80');
  });

  it('gives two views that slug alike different slugs', () => {
    const document = bases.normalizeDocument({
      views: [{ name: 'Smoke tests' }, { name: 'Smoke  tests' }]
    });
    expect(document.views.map(view => view.slug)).toEqual(['smoke-tests', 'smoke-tests-2']);
  });

  it('finds a view by name, by case, or by slug', () => {
    const { views } = bases.normalizeDocument({ views: [{ name: 'All flows' }, { name: 'Smoke tests' }] });

    expect(bases.findView(views, 'Smoke tests')!.name).toBe('Smoke tests');
    expect(bases.findView(views, 'smoke TESTS')!.name).toBe('Smoke tests');
    expect(bases.findView(views, 'smoke-tests')!.name).toBe('Smoke tests');
    expect(bases.findView(views, '')!.name).toBe('All flows');
    expect(bases.findView(views, 'nope')).toBeNull();
  });
});

describe('bases.load / bases.save', () => {
  afterEach(() => {
    const filePath = path.join(CONTEXT, 'views.yaml');
    if (fs.existsSync(filePath)) { fs.rmSync(filePath); }
  });

  it('returns a default document when views.yaml does not exist', async () => {
    const document = await bases.load();
    expect(document.views).toHaveLength(1);
    expect(document.views[0].type).toBe('table');
    expect(fs.existsSync(path.join(CONTEXT, 'views.yaml'))).toBe(false);
  });

  it('round-trips a document through disk', async () => {
    await bases.save({
      formulas: { grade: 'if(priority >= 5, "A", "B")' },
      properties: { owner: { displayName: 'Owner' } },
      views: [{
        type: 'table',
        name: 'Critical',
        filters: {
          conjunction: 'and',
          conditions: [{ property: 'priority', operator: 'greaterThan', value: 4 }]
        },
        order: ['file.name', 'owner', 'formula.grade'],
        sort: [{ property: 'priority', direction: 'desc' }],
        columnSize: { owner: 160 }
      }]
    });

    const raw = YAML.parse(fs.readFileSync(path.join(CONTEXT, 'views.yaml'), 'utf8'));
    expect(Object.keys(raw)).toEqual(['formulas', 'properties', 'views']);

    const document = await bases.load();
    expect(document.formulas.grade).toBe('if(priority >= 5, "A", "B")');
    // Bare names are qualified on the way in
    expect(document.properties['note.owner'].displayName).toBe('Owner');
    expect(document.views[0].order).toEqual(['file.name', 'note.owner', 'formula.grade']);
    expect(document.views[0].sort).toEqual([{ property: 'note.priority', direction: 'DESC' }]);
    expect(document.views[0].columnSize).toEqual({ 'note.owner': 160 });
  });

  it('drops malformed entries instead of failing', async () => {
    const document = bases.normalizeDocument({
      formulas: { good: 'note.a', bad: 42 },
      properties: { owner: { displayName: '' }, other: 'nope' },
      views: ['not a view', { name: 'Fine' }]
    });

    expect(Object.keys(document.formulas)).toEqual(['good']);
    expect(document.properties).toEqual({});
    expect(document.views).toHaveLength(1);
    expect(document.views[0].name).toBe('Fine');
  });
});

describe('bases.query', () => {
  it('lists every flow below the folder, recursively', async () => {
    const result = await bases.query({ folder: 'payments' });
    expect(result.rows.map(row => row.relativePath).sort()).toEqual([
      'payments/fraud.md',
      'payments/refunds/partial.md'
    ]);
  });

  it('lists the whole flows directory for an empty folder', async () => {
    const result = await bases.query({ folder: '' });
    expect(result.rows).toHaveLength(3);
  });

  it('exposes note, file, flow and formula values on every row', async () => {
    const result = await bases.query({
      folder: 'payments',
      document: {
        formulas: { grade: 'if(priority >= 5, "A", "B")' },
        views: [{ type: 'table', name: 'All', order: ['file.name', 'owner', 'formula.grade'] }]
      }
    });

    const fraud = result.rows.find(row => row.name === 'fraud.md')!;
    expect(fraud.values['note.owner']).toBe('ana');
    expect(fraud.values['file.folder']).toBe('payments');
    expect(fraud.values['flow.steps']).toBe(3);
    expect(fraud.values['formula.grade']).toBe('A');

    const partial = result.rows.find(row => row.name === 'partial.md')!;
    expect(partial.values['formula.grade']).toBe('B');
    expect(partial.values['file.folder']).toBe('payments/refunds');
  });

  it('applies the view filters', async () => {
    const result = await bases.query({
      folder: '',
      document: {
        views: [{
          type: 'table',
          name: 'Critical',
          filters: {
            conjunction: 'and',
            conditions: [{ property: 'priority', operator: 'greaterThan', value: 4 }]
          }
        }]
      }
    });

    expect(result.rows.map(row => row.name).sort()).toEqual(['cart.md', 'fraud.md']);
  });

  it('applies the document filters on top of the view ones', async () => {
    const result = await bases.query({
      folder: '',
      document: {
        filters: {
          conjunction: 'and',
          conditions: [{ property: 'file', operator: 'inFolder', value: 'payments' }]
        },
        views: [{
          type: 'table',
          name: 'Critical',
          filters: {
            conjunction: 'and',
            conditions: [{ property: 'priority', operator: 'greaterThan', value: 4 }]
          }
        }]
      }
    });

    expect(result.rows.map(row => row.name)).toEqual(['fraud.md']);
  });

  it('supports any / none filter groups', async () => {
    const result = await bases.query({
      folder: '',
      document: {
        views: [{
          type: 'table',
          name: 'Mixed',
          filters: {
            conjunction: 'or',
            conditions: [
              { property: 'owner', operator: 'is', value: 'bruno' },
              { property: 'file', operator: 'hasTag', value: 'smoke' }
            ]
          }
        }]
      }
    });
    expect(result.rows.map(row => row.name).sort()).toEqual(['fraud.md', 'partial.md']);

    const negated = await bases.query({
      folder: '',
      document: {
        views: [{
          type: 'table',
          name: 'Not ana',
          filters: {
            conjunction: 'none',
            conditions: [{ property: 'owner', operator: 'is', value: 'ana' }]
          }
        }]
      }
    });
    expect(negated.rows.map(row => row.name)).toEqual(['partial.md']);
  });

  it('picks the view by name, and the first one when it is unknown', async () => {
    const document = {
      views: [
        { type: 'table', name: 'First' },
        { type: 'list', name: 'Second' }
      ]
    };

    expect((await bases.query({ folder: '', view: 'Second', document })).view.name).toBe('Second');
    expect((await bases.query({ folder: '', view: 'Nope', document })).view.name).toBe('First');
  });

  it('reports an operator it does not know once, not once per flow', async () => {
    const result = await bases.query({
      folder: '',
      document: {
        views: [{
          type: 'table',
          name: 'Broken',
          filters: {
            conjunction: 'and',
            conditions: [{ property: 'owner', operator: 'nope', value: 'ana' }]
          }
        }]
      }
    });

    expect(result.rows).toHaveLength(0);
    // Three flows hit the same broken condition; it is one problem, not three
    expect(result.errors).toEqual(['Unknown operator "nope"']);
  });

  it('offers every property the listed flows carry', async () => {
    const result = await bases.query({ folder: '' });
    expect(result.availableProperties).toEqual(expect.arrayContaining([
      'file.name', 'file.path', 'flow.steps',
      'note.owner', 'note.priority', 'note.title'
    ]));
  });

  it('offers the fields of an embedded frontmatter object as columns', async () => {
    const result = await bases.query({ folder: 'checkout' });

    expect(result.availableProperties).toEqual(expect.arrayContaining([
      'note.xray', 'note.xray.testKey', 'note.xray.status', 'note.xray.folder'
    ]));

    const cart = result.rows[0];
    expect(cart.values['note.xray.testKey']).toBe('BOP-1769');
    expect(cart.values['note.xray.status']).toBe('Done');
    expect(cart.values['note.xray']).toEqual({
      testKey: 'BOP-1769',
      status: 'Done',
      folder: '/ST/TLOC - 148'
    });
  });

  it('reads a nested property that is not there as empty', async () => {
    const result = await bases.query({
      folder: 'payments',
      document: { views: [{ type: 'table', name: 'All', order: ['note.xray.testKey'] }] }
    });

    expect(result.rows.every(row => row.values['note.xray.testKey'] === null)).toBe(true);
  });

  it('shows only the top-level properties when the view has no order', async () => {
    const result = await bases.query({
      folder: 'checkout',
      document: { views: [{ type: 'table', name: 'Everything' }] }
    });
    expect(result.columns.map(column => column.id)).toContain('note.xray');
    expect(result.columns.map(column => column.id)).not.toContain('note.xray.testKey');
  });

  it('filters on a nested property', async () => {
    const result = await bases.query({
      folder: '',
      document: {
        views: [{
          type: 'table',
          name: 'Xrayed',
          filters: {
            conjunction: 'and',
            conditions: [{ property: 'xray.status', operator: 'is', value: 'Done' }]
          }
        }]
      }
    });

    expect(result.rows.map(row => row.name)).toEqual(['cart.md']);
  });

  it('returns the rows in the order the view sorts them', async () => {
    const result = await bases.query({
      folder: '',
      document: {
        views: [{ type: 'table', name: 'By priority', sort: [{ property: 'priority', direction: 'DESC' }] }]
      }
    });

    expect(result.rows.map(row => row.name)).toEqual(['fraud.md', 'cart.md', 'partial.md']);
  });

  it('picks the view by its slug too', async () => {
    const document = { views: [{ type: 'table', name: 'First' }, { type: 'list', name: 'Second one' }] };
    expect((await bases.query({ folder: '', view: 'second-one', document })).view.name).toBe('Second one');
  });

  it('resolves display names from the properties map', async () => {
    const result = await bases.query({
      folder: '',
      document: {
        properties: { owner: { displayName: 'Responsable' } },
        views: [{ type: 'table', name: 'All', order: ['owner', 'priority'] }]
      }
    });

    expect(result.columns).toEqual([
      { id: 'note.owner', displayName: 'Responsable', width: null },
      { id: 'note.priority', displayName: 'Priority', width: null }
    ]);
  });

  it('rejects a folder outside the flows directory', async () => {
    await expect(bases.query({ folder: '../..' })).rejects.toThrow(/outside of the flows directory/);
  });
});
