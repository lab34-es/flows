import * as filters from '../../src/helpers/bases/filters';

/**
 * A scope shaped like the one bases builds for a flow, with only the parts
 * the filters read.
 * @param {Object} note - Frontmatter
 * @param {Object} file - Overrides for the file namespace
 * @returns {Object}
 */
const scopeOf = (note: Record<string, any> = {}, file: Record<string, any> = {}) => {
  const folder = String(file.folder ?? 'payments');
  const tags = Array.isArray(file.tags) ? file.tags : ['smoke'];

  return {
    note,
    flow: { title: 'A flow', steps: 3, hasErrors: false },
    formula: {},
    file: {
      name: 'fraud.md',
      basename: 'fraud',
      path: `${folder}/fraud.md`,
      folder,
      ext: 'md',
      size: 120,
      ctime: new Date('2026-01-01'),
      mtime: new Date('2026-02-01'),
      tags,
      hasTag: (...candidates) => candidates.flat().some(
        candidate => tags.some(tag => tag.toLowerCase() === String(candidate ?? '').replace(/^#/, '').toLowerCase())
      ),
      hasProperty: (property) => Object.prototype.hasOwnProperty.call(note, String(property ?? '')),
      inFolder: (candidate) => {
        const target = String(candidate ?? '').replace(/^\/+|\/+$/g, '');
        if (!target) { return true; }
        return folder === target || folder.startsWith(`${target}/`);
      }
    }
  };
};

/**
 * Whether one condition keeps a flow.
 * @param {string} property
 * @param {string} operator
 * @param {*} value
 * @param {Object} scope
 * @returns {boolean}
 */
const keeps = (property, operator, value, scope) => filters.matches(
  filters.normalize({ conjunction: 'and', conditions: [{ property, operator, value }] }),
  scope
);

describe('filters.normalize', () => {
  it('qualifies a bare property and keeps the file pseudo-property alone', () => {
    const normalized = filters.normalize({
      conjunction: 'and',
      conditions: [
        { property: 'owner', operator: 'is', value: 'ana' },
        { property: 'file', operator: 'inFolder', value: 'payments' }
      ]
    })!;

    expect(normalized.conditions).toEqual([
      { property: 'note.owner', operator: 'is', value: 'ana' },
      { property: 'file', operator: 'inFolder', value: 'payments' }
    ]);
  });

  it('defaults an unknown conjunction to "and"', () => {
    const normalized = filters.normalize({
      conjunction: 'maybe',
      conditions: [{ property: 'owner', operator: 'isNotEmpty' }]
    })!;

    expect(normalized.conjunction).toBe('and');
  });

  it('drops a condition with no property or no operator, and an empty group', () => {
    expect(filters.normalize({
      conjunction: 'and',
      conditions: [{ property: '', operator: 'is' }, { property: 'owner', operator: '' }, 'nonsense', null]
    })).toBeNull();

    expect(filters.normalize({ conjunction: 'and', conditions: [] })).toBeNull();
    expect(filters.normalize(null)).toBeNull();
    expect(filters.normalize('priority > 4')).toBeNull();
  });

  it('carries no value for an operator that takes none', () => {
    const normalized = filters.normalize({
      conjunction: 'and',
      conditions: [{ property: 'owner', operator: 'isEmpty', value: 'ignored' }]
    })!;

    expect(normalized.conditions[0]).toEqual({ property: 'note.owner', operator: 'isEmpty' });
  });

  it('keeps an operator it does not know, so the view reports it', () => {
    const normalized = filters.normalize({
      conjunction: 'and',
      conditions: [{ property: 'owner', operator: 'nope', value: 'ana' }]
    })!;

    expect(normalized.conditions[0]).toEqual({ property: 'note.owner', operator: 'nope', value: 'ana' });
  });

  it('normalizes nested groups, and drops one left empty', () => {
    const normalized = filters.normalize({
      conjunction: 'or',
      conditions: [
        { property: 'owner', operator: 'is', value: 'ana' },
        { conjunction: 'and', conditions: [{ property: '', operator: '' }] },
        { conjunction: 'none', conditions: [{ property: 'priority', operator: 'lessThan', value: 3 }] }
      ]
    })!;

    expect(normalized.conditions).toHaveLength(2);
    expect(filters.count(normalized)).toBe(2);
  });
});

describe('filters.matches', () => {
  const scope = scopeOf({
    owner: 'ana',
    priority: 8,
    reviewed: true,
    tags: ['smoke', 'payments'],
    due: '2026-03-10'
  });

  it('keeps everything when there is no filter', () => {
    expect(filters.matches(null, scope)).toBe(true);
  });

  it('compares text', () => {
    expect(keeps('owner', 'is', 'ana', scope)).toBe(true);
    expect(keeps('owner', 'isNot', 'ana', scope)).toBe(false);
    expect(keeps('owner', 'contains', 'AN', scope)).toBe(true);
    expect(keeps('owner', 'doesNotContain', 'zz', scope)).toBe(true);
    expect(keeps('owner', 'startsWith', 'a', scope)).toBe(true);
    expect(keeps('owner', 'endsWith', 'na', scope)).toBe(true);
  });

  it('compares numbers', () => {
    expect(keeps('priority', 'greaterThan', 4, scope)).toBe(true);
    expect(keeps('priority', 'greaterOrEqual', 8, scope)).toBe(true);
    expect(keeps('priority', 'lessThan', 8, scope)).toBe(false);
    expect(keeps('priority', 'lessOrEqual', 8, scope)).toBe(true);
    // The value as the UI sends it, a string from an input, still compares
    expect(keeps('priority', 'greaterThan', '4', scope)).toBe(true);
  });

  it('reads a checkbox', () => {
    expect(keeps('reviewed', 'isTrue', null, scope)).toBe(true);
    expect(keeps('reviewed', 'isFalse', null, scope)).toBe(false);
    // A property no flow carries is not checked, rather than an error
    expect(keeps('missing', 'isFalse', null, scope)).toBe(true);
  });

  it('compares dates by day, and understands today', () => {
    expect(keeps('due', 'is', '2026-03-10', scope)).toBe(true);
    expect(keeps('due', 'is', '2026-03-10T18:00:00', scope)).toBe(true);
    expect(keeps('due', 'before', '2026-03-11', scope)).toBe(true);
    expect(keeps('due', 'after', '2026-03-11', scope)).toBe(false);
    expect(keeps('due', 'onOrBefore', '2026-03-10', scope)).toBe(true);
    expect(keeps('due', 'onOrAfter', '2026-03-10', scope)).toBe(true);
    expect(keeps('file.mtime', 'before', 'today', scope)).toBe(true);
    expect(keeps('file.mtime', 'after', 'now', scope)).toBe(false);
  });

  it('compares lists', () => {
    expect(keeps('tags', 'hasAny', ['wip', 'smoke'], scope)).toBe(true);
    expect(keeps('tags', 'hasAll', ['smoke', 'payments'], scope)).toBe(true);
    expect(keeps('tags', 'hasAll', ['smoke', 'wip'], scope)).toBe(false);
    expect(keeps('tags', 'hasNone', ['wip'], scope)).toBe(true);
    expect(keeps('tags', 'contains', 'smoke', scope)).toBe(true);
  });

  it('reads emptiness the way the rest of bases does', () => {
    expect(keeps('owner', 'isEmpty', null, scope)).toBe(false);
    expect(keeps('owner', 'isNotEmpty', null, scope)).toBe(true);
    expect(keeps('missing', 'isEmpty', null, scope)).toBe(true);
    expect(keeps('missing', 'isNotEmpty', null, scope)).toBe(false);
  });

  it('tests the file itself', () => {
    expect(keeps('file', 'inFolder', 'payments', scope)).toBe(true);
    expect(keeps('file', 'inFolder', 'checkout', scope)).toBe(false);
    expect(keeps('file', 'notInFolder', 'checkout', scope)).toBe(true);
    expect(keeps('file', 'hasTag', 'smoke', scope)).toBe(true);
    expect(keeps('file', 'hasTag', '#smoke', scope)).toBe(true);
    expect(keeps('file', 'doesNotHaveTag', 'wip', scope)).toBe(true);
    expect(keeps('file', 'hasProperty', 'owner', scope)).toBe(true);
    expect(keeps('file', 'doesNotHaveProperty', 'owner', scope)).toBe(false);
  });

  it('matches a flow in a subfolder of the one asked for', () => {
    const nested = scopeOf({ owner: 'bruno' }, { folder: 'payments/refunds' });
    expect(keeps('file', 'inFolder', 'payments', nested)).toBe(true);
  });

  it('combines conditions with all, any and none', () => {
    const conditions = [
      { property: 'owner', operator: 'is', value: 'ana' },
      { property: 'priority', operator: 'lessThan', value: 4 }
    ];

    expect(filters.matches(filters.normalize({ conjunction: 'and', conditions }), scope)).toBe(false);
    expect(filters.matches(filters.normalize({ conjunction: 'or', conditions }), scope)).toBe(true);
    expect(filters.matches(filters.normalize({ conjunction: 'none', conditions }), scope)).toBe(false);
  });

  it('nests a group inside a group', () => {
    const node = filters.normalize({
      conjunction: 'and',
      conditions: [
        { property: 'owner', operator: 'is', value: 'ana' },
        {
          conjunction: 'or',
          conditions: [
            { property: 'priority', operator: 'greaterThan', value: 100 },
            { property: 'file', operator: 'hasTag', value: 'smoke' }
          ]
        }
      ]
    });

    expect(filters.matches(node, scope)).toBe(true);
  });

  it('reports an unknown operator once, and keeps nothing', () => {
    const node = filters.normalize({
      conjunction: 'and',
      conditions: [{ property: 'owner', operator: 'nope', value: 'ana' }]
    });

    const errors: string[] = [];
    expect(filters.matches(node, scope, errors)).toBe(false);
    expect(filters.matches(node, scopeOf({ owner: 'bruno' }), errors)).toBe(false);
    expect(errors).toEqual(['Unknown operator "nope"']);
  });
});

describe('filters.inferType', () => {
  it('knows the types the file and flow namespaces carry', () => {
    expect(filters.inferType('file.name')).toBe('text');
    expect(filters.inferType('file.size')).toBe('number');
    expect(filters.inferType('file.mtime')).toBe('date');
    expect(filters.inferType('file.tags')).toBe('list');
    expect(filters.inferType('flow.steps')).toBe('number');
    expect(filters.inferType('flow.hasErrors')).toBe('checkbox');
    expect(filters.inferType('file')).toBe('file');
  });

  it('reads a frontmatter property from the values it is seen with', () => {
    expect(filters.inferType('note.owner', ['ana', 'bruno'])).toBe('text');
    expect(filters.inferType('note.priority', [8, 3])).toBe('number');
    expect(filters.inferType('note.reviewed', [true, false])).toBe('checkbox');
    expect(filters.inferType('note.due', ['2026-03-10'])).toBe('date');
    expect(filters.inferType('note.tags', [['smoke']])).toBe('list');
  });

  it('ignores empties, and falls back to text when the values disagree', () => {
    expect(filters.inferType('note.owner', [null, '', 'ana'])).toBe('text');
    expect(filters.inferType('note.mixed', ['ana', 8])).toBe('text');
    expect(filters.inferType('note.unknown', [])).toBe('text');
    // Sometimes a bare value, sometimes an array of them: still a list
    expect(filters.inferType('note.tags', ['smoke', ['smoke', 'wip']])).toBe('list');
  });
});

describe('filters.catalog', () => {
  const catalog = filters.catalog();

  it('offers an operator only to the types that implement it', () => {
    expect(filters.operatorsFor('number')).toContain('greaterThan');
    expect(filters.operatorsFor('number')).not.toContain('startsWith');
    expect(filters.operatorsFor('text')).toContain('startsWith');
    expect(filters.operatorsFor('checkbox')).toEqual(['isTrue', 'isFalse', 'isEmpty', 'isNotEmpty']);
    expect(filters.operatorsFor('file')).toContain('inFolder');
  });

  it('describes every operator it implements, and nothing it does not', () => {
    expect(catalog.operators.map(operator => operator.id).sort())
      .toEqual(Object.keys(filters.OPERATORS).sort());
    catalog.operators.forEach(operator => {
      expect(typeof operator.label).toBe('string');
      expect(operator.types.length).toBeGreaterThan(0);
    });
  });

  it('names the three conjunctions', () => {
    expect(catalog.conjunctions.map(entry => entry.id)).toEqual(['and', 'or', 'none']);
  });
});

describe('filters.readColumn', () => {
  const scope = scopeOf({ owner: 'ana', xray: { status: 'Done' } });

  it('reads each namespace', () => {
    expect(filters.readColumn('note.owner', scope).value).toBe('ana');
    expect(filters.readColumn('note.xray.status', scope).value).toBe('Done');
    expect(filters.readColumn('file.folder', scope).value).toBe('payments');
    expect(filters.readColumn('flow.steps', scope).value).toBe(3);
    expect(filters.readColumn('formula.nope', scope).value).toBeNull();
    expect(filters.readColumn('nowhere.at.all', scope).value).toBeNull();
  });

  it('reads a function on the file namespace as empty, not as a function', () => {
    expect(filters.readColumn('file.hasTag', scope).value).toBeNull();
  });

  it('reports a formula that throws instead of throwing', () => {
    const angry = {
      ...scope,
      formula: { get boom() { throw new Error('nope'); } }
    };

    expect(filters.readColumn('formula.boom', angry).error).toContain('nope');
  });
});
