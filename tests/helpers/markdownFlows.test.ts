import * as markdownFlows from '../../src/helpers/markdownFlows';

const SAMPLE = `---
title: Sample flow
description: A markdown flow used in tests
---

# Sample flow

Some intro text explaining the flow.

\`\`\`step
application: calculator
method: add
parameters:
  body:
    a: 1
    b: 2
\`\`\`

Between steps we can write **anything**, including code blocks:

\`\`\`js
console.log('this is NOT a step');
\`\`\`

\`\`\`yaml step
application: calculator
method: multiply
parameters:
  body:
    a: 3
    b: 4
test:
  body:
    result: 12
\`\`\`

Closing remarks.
`;

describe('markdownFlows', () => {
  describe('withFrontmatter', () => {
    it('replaces the frontmatter and leaves the body alone', () => {
      const next = markdownFlows.withFrontmatter(SAMPLE, {
        title: 'Sample flow',
        description: 'A markdown flow used in tests',
        owner: 'ana',
        priority: 8
      });

      const { meta, body } = markdownFlows.parseFrontmatter(next);
      expect(meta).toEqual({
        title: 'Sample flow',
        description: 'A markdown flow used in tests',
        owner: 'ana',
        priority: 8
      });
      expect(body).toBe(markdownFlows.parseFrontmatter(SAMPLE).body);
      expect(markdownFlows.parse(next).steps).toHaveLength(2);
    });

    it('keeps the given key order', () => {
      const next = markdownFlows.withFrontmatter(SAMPLE, { title: 'T', zeta: 1, alpha: 2 });
      const keys = next.split('\n').slice(1, 4).map(line => line.split(':')[0]);
      expect(keys).toEqual(['title', 'zeta', 'alpha']);
    });

    it('adds a frontmatter block to a document that had none', () => {
      const next = markdownFlows.withFrontmatter('# Title\n\nBody\n', { owner: 'ana' });
      expect(next).toBe('---\nowner: ana\n---\n\n# Title\n\nBody\n');
    });

    it('removes the block when no property is left', () => {
      const next = markdownFlows.withFrontmatter(SAMPLE, {});
      expect(next.startsWith('# Sample flow')).toBe(true);
      expect(markdownFlows.parseFrontmatter(next).meta).toEqual({});
    });

    it('round-trips values YAML has to quote', () => {
      const meta = {
        title: 'A: colon, and a #hash',
        tags: ['smoke', 'slow'],
        reviewed: false,
        due: '2026-01-15'
      };
      const parsed = markdownFlows.parseFrontmatter(
        markdownFlows.withFrontmatter(SAMPLE, meta)
      ).meta;
      expect(parsed).toEqual(meta);
    });
  });

  describe('parseFrontmatter', () => {
    it('extracts YAML frontmatter', () => {
      const { meta, body } = markdownFlows.parseFrontmatter(SAMPLE);
      expect(meta.title).toBe('Sample flow');
      expect(meta.description).toBe('A markdown flow used in tests');
      expect(body).not.toContain('title: Sample flow');
    });

    it('returns empty meta when there is no frontmatter', () => {
      const { meta, body } = markdownFlows.parseFrontmatter('# Hello');
      expect(meta).toEqual({});
      expect(body).toBe('# Hello');
    });

    it('does not treat a horizontal rule later in the doc as frontmatter', () => {
      const doc = '# Title\n\n---\n\nmore';
      const { meta, body } = markdownFlows.parseFrontmatter(doc);
      expect(meta).toEqual({});
      expect(body).toBe(doc);
    });
  });

  describe('isStepInfo', () => {
    it('accepts step fences', () => {
      expect(markdownFlows.isStepInfo('step')).toBe(true);
      expect(markdownFlows.isStepInfo('yaml step')).toBe(true);
      expect(markdownFlows.isStepInfo('step yaml')).toBe(true);
      expect(markdownFlows.isStepInfo('  STEP  ')).toBe(true);
    });

    it('rejects non-step fences', () => {
      expect(markdownFlows.isStepInfo('js')).toBe(false);
      expect(markdownFlows.isStepInfo('yaml')).toBe(false);
      expect(markdownFlows.isStepInfo('steps')).toBe(false);
      expect(markdownFlows.isStepInfo('step-by-step')).toBe(false);
      expect(markdownFlows.isStepInfo('')).toBe(false);
    });
  });

  describe('parse', () => {
    it('splits markdown and step segments in order', () => {
      const parsed = markdownFlows.parse(SAMPLE);
      const types = parsed.segments.map(s => s.type);
      expect(types).toEqual(['markdown', 'step', 'markdown', 'step', 'markdown']);
    });

    it('keeps non-step code blocks inside markdown segments', () => {
      const parsed = markdownFlows.parse(SAMPLE);
      const middle = parsed.segments[2];
      expect(middle.content).toContain("console.log('this is NOT a step');");
      expect(middle.content).toContain('```js');
    });

    it('parses steps as YAML with stepIndex', () => {
      const parsed = markdownFlows.parse(SAMPLE);
      expect(parsed.steps).toHaveLength(2);
      expect(parsed.steps[0]).toMatchObject({
        application: 'calculator',
        method: 'add',
        stepIndex: 0
      });
      expect(parsed.steps[1]).toMatchObject({
        application: 'calculator',
        method: 'multiply',
        stepIndex: 1
      });
      expect(parsed.steps[1].test.body.result).toBe(12);
    });

    it('uses the frontmatter title', () => {
      const parsed = markdownFlows.parse(SAMPLE);
      expect(parsed.title).toBe('Sample flow');
    });

    it('falls back to the first heading when no frontmatter title', () => {
      const parsed = markdownFlows.parse('# My Heading\n\n```step\napplication: a\nmethod: b\n```\n');
      expect(parsed.title).toBe('My Heading');
    });

    it('collects YAML errors from invalid step blocks', () => {
      const doc = '```step\napplication: [unclosed\n```\n';
      const parsed = markdownFlows.parse(doc);
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.errors[0].stepIndex).toBe(0);
      expect(parsed.steps).toHaveLength(0);
      expect((parsed.segments[0] as any).error).toBeTruthy();
    });

    it('rejects step blocks that are not YAML objects', () => {
      const parsed = markdownFlows.parse('```step\njust a string\n```\n');
      expect(parsed.errors).toHaveLength(1);
      expect(parsed.steps).toHaveLength(0);
    });

    it('handles unclosed fences at end of document', () => {
      const parsed = markdownFlows.parse('intro\n\n```step\napplication: a\nmethod: b\n');
      expect(parsed.steps).toHaveLength(1);
      expect(parsed.steps[0].application).toBe('a');
    });

    it('supports tilde fences', () => {
      const parsed = markdownFlows.parse('~~~step\napplication: a\nmethod: b\n~~~\n');
      expect(parsed.steps).toHaveLength(1);
    });

    it('supports CRLF line endings', () => {
      const doc = ['---', 'title: T', '---', '', '```step', 'application: a', 'method: b', '```', ''].join('\r\n');
      const parsed = markdownFlows.parse(doc);
      expect(parsed.title).toBe('T');
      expect(parsed.steps).toHaveLength(1);
      expect(parsed.steps[0]).toMatchObject({ application: 'a', method: 'b' });
    });
  });

  describe('isStepEnabled', () => {
    it('treats a step that never mentions enabled as enabled', () => {
      expect(markdownFlows.isStepEnabled({ application: 'a', method: 'b' })).toBe(true);
    });

    it('only an explicit false takes a step out of the run', () => {
      expect(markdownFlows.isStepEnabled({ enabled: false })).toBe(false);
      expect(markdownFlows.isStepEnabled({ enabled: true })).toBe(true);
      expect(markdownFlows.isStepEnabled({ enabled: null })).toBe(true);
    });

    it('reads the string a hand-written "false" leaves behind', () => {
      expect(markdownFlows.isStepEnabled({ enabled: 'false' })).toBe(false);
      expect(markdownFlows.isStepEnabled({ enabled: ' False ' })).toBe(false);
      expect(markdownFlows.isStepEnabled({ enabled: 'yes' })).toBe(true);
    });

    it('survives a missing step', () => {
      expect(markdownFlows.isStepEnabled(null)).toBe(true);
    });

    it('comes off a parsed document', () => {
      const doc = [
        '```step',
        'enabled: false',
        'application: a',
        'method: b',
        '```'
      ].join('\n');
      expect(markdownFlows.parse(doc).steps.map(markdownFlows.isStepEnabled)).toEqual([false]);
    });
  });

  describe('toFlow', () => {
    it('builds a runner-compatible flow', () => {
      const flow = markdownFlows.toFlow(SAMPLE);
      expect(flow.title).toBe('Sample flow');
      expect(flow.description).toBe('A markdown flow used in tests');
      expect(flow.steps).toHaveLength(2);
      expect(flow.steps[0].stepIndex).toBe(0);
    });

    it('keeps extra frontmatter such as latentApplications', () => {
      const doc = [
        '---',
        'title: T',
        'latentApplications:',
        '  - application: mqtt',
        '    client: client1',
        '---',
        '```step',
        'application: a',
        'method: b',
        '```'
      ].join('\n');
      const flow = markdownFlows.toFlow(doc);
      expect(flow.latentApplications).toHaveLength(1);
      expect(flow.latentApplications[0].application).toBe('mqtt');
    });

    it('throws on invalid step YAML', () => {
      expect(() => markdownFlows.toFlow('```step\n[bad\n```\n')).toThrow(/Invalid markdown flow/);
    });

    it('throws when there are no steps', () => {
      expect(() => markdownFlows.toFlow('# Just prose')).toThrow(/no ```step blocks/);
    });
  });
});
