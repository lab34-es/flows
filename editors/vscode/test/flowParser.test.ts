import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { isEnabled, isResultInfo, isStepInfo, parseFlow } from '../src/core/flowParser';

/** The package's own examples: what the runner counted, the parser must count. */
const EXAMPLES = path.join(__dirname, '..', '..', '..', '..', 'src', 'defaults', 'flows', 'examples');

const doc = (...lines: string[]) => lines.join('\n');

describe('parseFlow', () => {
  test('finds every step block, where it starts and ends', () => {
    const parsed = parseFlow(doc(
      '# Pay',            // 0
      '',                 // 1
      '```step',          // 2
      'application: cards',
      'method: charge',
      '```',              // 5
      'Some prose',       // 6
      '```yaml step',     // 7
      'application: ledger',
      'method: post',
      'description: Post the movement',
      '```'               // 11
    ));

    assert.deepEqual(parsed.steps.map(step => [step.index, step.line, step.endLine]), [[0, 2, 5], [1, 7, 11]]);
    assert.deepEqual(parsed.steps.map(step => step.id), ['cards-charge', 'ledger-post']);
    assert.deepEqual(parsed.steps.map(step => step.call), ['cards.charge', 'ledger.post']);
    assert.deepEqual(parsed.steps.map(step => step.label), ['cards.charge', 'Post the movement']);
  });

  test('gives steps the ids the runner gives them', () => {
    const parsed = parseFlow(doc(
      '```step', 'application: a', 'method: get', '```',
      '```step', 'slug: login', 'application: a', 'method: post', '```',
      '```step', 'application: a', 'method: get', '```',
      '```step', 'application: tester', 'method: wait', 'waitForTime:', '  time: 500', '```',
      '```step', 'application: tester', 'method: wait', 'waitForTime: {}', '```'
    ));

    // Shared ids get their position; a slug is the id; waits name their time
    assert.deepEqual(parsed.steps.map(step => step.id), [
      'a-get-0', 'login', 'a-get-2', 'tester-wait-waitForTime-500', 'tester-wait-waitForTime-?'
    ]);
  });

  test('matches what the runner reported for the welcome example', () => {
    const parsed = parseFlow(fs.readFileSync(path.join(EXAMPLES, '01-welcome.md'), 'utf8'));

    // Recorded from `ronsel --ipc` on that very file
    assert.deepEqual(parsed.steps.map(step => step.id), ['calculator-add', 'calculator-multiply', 'calculator-divide']);
    assert.equal(parsed.title, 'Welcome to Markdown flows');
    assert.equal(parsed.titleLine, 1);
  });

  test('every bundled example parses without a broken step', () => {
    for (const file of fs.readdirSync(EXAMPLES)) {
      const parsed = parseFlow(fs.readFileSync(path.join(EXAMPLES, file), 'utf8'));
      assert.ok(parsed.steps.length > 0, file);
      assert.deepEqual(parsed.steps.filter(step => step.error), [], file);
      assert.ok(parsed.title, file);
    }
  });

  test('takes the title from the frontmatter, on the line it is written', () => {
    const parsed = parseFlow(doc('---', 'description: x', 'title: Refunds', '---', '# Heading', '```step', 'application: a', 'method: b', '```'));

    assert.equal(parsed.title, 'Refunds');
    assert.equal(parsed.titleLine, 2);
    assert.deepEqual(parsed.meta, { description: 'x', title: 'Refunds' });
    assert.equal(parsed.steps[0].line, 5);
  });

  test('falls back to the first top-level heading outside of a code block', () => {
    const parsed = parseFlow(doc('```bash', '# not a title', '```', '', '## A section', '# Real one', '# Later'));

    assert.equal(parsed.title, 'Real one');
    assert.equal(parsed.titleLine, 5);
  });

  test('without a title, the flow is named on its first line', () => {
    const parsed = parseFlow(doc('```step', 'application: a', 'method: b', '```'));

    assert.equal(parsed.title, null);
    assert.equal(parsed.titleLine, 0);
  });

  test('a frontmatter that is never closed is body', () => {
    const parsed = parseFlow(doc('---', 'title: nope', '# Body title'));

    assert.equal(parsed.title, 'Body title');
    assert.deepEqual(parsed.meta, {});
  });

  test('a frontmatter that does not parse names nothing', () => {
    const parsed = parseFlow(doc('---', 'title: [broken', '---', '# Heading'));

    assert.equal(parsed.title, 'Heading');
    assert.deepEqual(parsed.meta, {});
  });

  test('ignores fences that are not steps, and their contents', () => {
    const parsed = parseFlow(doc(
      '````markdown',
      '```step',
      'application: a',
      'method: b',
      '```',
      '````',
      '~~~ step',
      'application: c',
      'method: d',
      '~~~'
    ));

    assert.deepEqual(parsed.steps.map(step => step.id), ['c-d']);
  });

  test('a backtick in the info string is not a fence', () => {
    const parsed = parseFlow(doc('```step`', 'application: a', 'method: b', '```'));

    // The opening line is prose, so the closing one opens a block that never closes
    assert.equal(parsed.steps.length, 0);
  });

  test('a step block that is never closed runs to the end', () => {
    const parsed = parseFlow(doc('```step', 'application: a', 'method: b'));

    assert.equal(parsed.steps[0].endLine, 2);
    assert.equal(parsed.steps[0].id, 'a-b');
  });

  test('keeps a block that does not parse, and says why', () => {
    const parsed = parseFlow(doc('```step', 'application: [a', '```', '```step', '- a list', '```', '```step', 'application: c', 'method: d', '```'));

    assert.equal(parsed.steps.length, 3);
    assert.match(parsed.steps[0].error || '', /^Invalid step YAML/);
    assert.match(parsed.steps[1].error || '', /must contain a YAML object/);
    assert.equal(parsed.steps[0].label, 'Step 1');
    assert.equal(parsed.steps[2].index, 2);
  });

  test('a step turned off is still a step', () => {
    const parsed = parseFlow(doc('```step', 'application: a', 'method: b', 'enabled: false', '```', '```step', 'application: a', 'method: c', 'enabled: "false"', '```'));

    assert.deepEqual(parsed.steps.map(step => step.enabled), [false, false]);
  });

  test('labels a step with the first line of its description', () => {
    const parsed = parseFlow(doc('```step', 'application: a', 'method: b', 'description: |', '  First line', '  second', '```'));

    assert.equal(parsed.steps[0].label, 'First line');
  });

  test('reads the results a test run wrote under each step', () => {
    const parsed = parseFlow(doc(
      '```step', 'application: a', 'method: b', '```',
      '',
      '```step-result', 'execution:', '  status: passed', '```',
      '```step', 'application: a', 'method: c', '```',
      '```step-result', 'execution: [broken', '```'
    ));

    assert.equal(parsed.steps.length, 2);
    assert.deepEqual(parsed.results.map(result => [result.stepIndex, result.line]), [[0, 5], [1, 13]]);
    assert.deepEqual(parsed.results[0].result, { execution: { status: 'passed' } });
    assert.equal(parsed.results[1].result, null);
  });

  test('reads documents written on Windows', () => {
    const parsed = parseFlow('# T\r\n\r\n```step\r\napplication: a\r\nmethod: b\r\n```\r\n');

    assert.equal(parsed.steps[0].line, 2);
    assert.equal(parsed.steps[0].id, 'a-b');
  });

  test('an empty document has nothing in it', () => {
    assert.deepEqual(parseFlow(''), { title: null, titleLine: 0, meta: {}, steps: [], results: [] });
  });
});

describe('fence info strings', () => {
  test('step and flow-step mark steps, in any order', () => {
    assert.equal(isStepInfo('step'), true);
    assert.equal(isStepInfo(' YAML Step '), true);
    assert.equal(isStepInfo('flow-step'), true);
    assert.equal(isStepInfo('yaml'), false);
    assert.equal(isStepInfo('step-result'), false);
  });

  test('step-result marks a stored result', () => {
    assert.equal(isResultInfo('step-result'), true);
    assert.equal(isResultInfo('yaml'), false);
  });
});

describe('isEnabled', () => {
  test('only an explicit false turns a step off', () => {
    assert.equal(isEnabled(null), true);
    assert.equal(isEnabled({}), true);
    assert.equal(isEnabled({ enabled: null }), true);
    assert.equal(isEnabled({ enabled: true }), true);
    assert.equal(isEnabled({ enabled: 'yes' }), true);
    assert.equal(isEnabled({ enabled: false }), false);
    assert.equal(isEnabled({ enabled: ' False ' }), false);
  });
});
