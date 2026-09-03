/**
 * The document model behind the editable Document view.
 *
 * Obsidian edits Markdown where it is rendered, and so does this: the
 * document is cut into *blocks* — a paragraph, a heading, a list, a
 * blockquote, a fenced code block, a `step` — and each of them is rendered
 * until the caret enters it, at which point that one block shows its source.
 *
 * Two properties matter for a file that lives in the user's repository:
 *
 * - The split is lossless. Every block remembers the exact blank lines that
 *   followed it (`sep`), so editing one paragraph never reflows the rest of
 *   the document and the diff stays where the change was.
 * - The step numbering matches the parser. `stepIndex` is assigned the same
 *   way `helpers/markdownFlows` assigns it — in fence order — so the cells
 *   keep pointing at the right execution output while the document is being
 *   written.
 */

/** What a block reads as. Drives both the rendering and the keyboard rules. */
export type BlockKind =
  | 'step'
  | 'code'
  | 'heading'
  | 'quote'
  | 'callout'
  | 'list'
  | 'table'
  | 'rule'
  | 'paragraph';

export interface Block {
  /** Stable while the block lives in the editor; not derived from content. */
  id: string;
  /** Raw Markdown, without the blank lines that follow it. */
  text: string;
  /** The exact newlines between this block and the next one. */
  sep: string;
}

export interface BlockDocument {
  /** Frontmatter and the blank lines under it — owned by the properties panel. */
  head: string;
  blocks: Block[];
}

// Fence info tokens that mark a code block as an executable step. Kept in
// sync with STEP_TOKENS in helpers/markdownFlows.
const STEP_TOKENS = ['step', 'flow-step'];

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const RULE_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}>/;
const LIST_ITEM_RE = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))(?:[ \t]+|$)/;
const CALLOUT_RE = /^ {0,3}>[ \t]*\[!(note|tip|important|warning|caution)\]/i;
const TABLE_DELIMITER_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;

let sequence = 0;

/** A fresh block id. Ids are per-session and never read back from the file. */
export const nextBlockId = (): string => `block-${++sequence}`;

export const createBlock = (text: string, sep = '\n\n'): Block => ({ id: nextBlockId(), text, sep });

/** Line endings are normalized so the same rules apply to files written anywhere. */
const normalize = (content: string): string => (content || '').replace(/\r\n?/g, '\n');

const isBlank = (line: string): boolean => line.trim() === '';

/** True when the fence info string marks the block as an executable step. */
export const isStepInfo = (info: string): boolean => {
  const tokens = (info || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.some((token) => STEP_TOKENS.includes(token));
};

/** The three parts of a fenced block, or null when the text is not one. */
export const fenceParts = (
  text: string
): { open: string; info: string; body: string; close: string } | null => {
  const lines = normalize(text).split('\n');
  const match = lines[0]?.match(FENCE_RE);
  if (!match) return null;

  const [, fence, info] = match;
  // Info strings of backtick fences cannot contain backticks (CommonMark)
  if (fence[0] === '`' && info.includes('`')) return null;

  const closeRe = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`);
  const last = lines.length - 1;
  const closed = last > 0 && closeRe.test(lines[last]);

  return {
    open: lines[0],
    info: info.trim(),
    body: lines.slice(1, closed ? last : undefined).join('\n'),
    close: closed ? lines[last] : '',
  };
};

/** Rebuild a fenced block around a new body, keeping its own fence lines. */
export const withFenceBody = (text: string, body: string): string => {
  const parts = fenceParts(text);
  if (!parts) return body;
  return parts.close ? `${parts.open}\n${body}\n${parts.close}` : `${parts.open}\n${body}`;
};

/** What kind of block a chunk of Markdown reads as. */
export const blockKind = (text: string): BlockKind => {
  const lines = normalize(text).split('\n');
  const first = lines[0] || '';

  const fence = fenceParts(text);
  if (fence) return isStepInfo(fence.info) ? 'step' : 'code';
  if (RULE_RE.test(first)) return 'rule';
  if (HEADING_RE.test(first)) return 'heading';
  if (QUOTE_RE.test(first)) return CALLOUT_RE.test(first) ? 'callout' : 'quote';
  if (LIST_ITEM_RE.test(first)) return 'list';
  if (lines.length > 1 && lines.some((line) => TABLE_DELIMITER_RE.test(line))) return 'table';
  return 'paragraph';
};

/**
 * Blocks the caret cannot merge into: backspacing at the start of the text
 * that follows one selects it instead of gluing prose to its source.
 */
export const isAtomicKind = (kind: BlockKind): boolean =>
  kind === 'step' || kind === 'code' || kind === 'rule' || kind === 'table';

/** True for the blocks the editor renders as a step cell. */
export const isStepBlock = (block: Block): boolean => blockKind(block.text) === 'step';

/** The YAML inside a `step` block — what the step cell shows and edits. */
export const stepBody = (text: string): string => fenceParts(text)?.body ?? '';

/**
 * A top-level `enabled:` key of a step's YAML. Nested keys are indented, so
 * column 0 is what makes this the step's own switch rather than something
 * inside its parameters.
 */
const ENABLED_LINE = /^enabled[ \t]*:[ \t]*([^\n]*)$/;

/**
 * Whether a step is meant to run. Kept in sync with `isStepEnabled` in
 * helpers/markdownFlows: steps are enabled by default, and only an explicit
 * `enabled: false` takes one out of the run.
 *
 * Read straight off the YAML rather than off the parsed step, so the toggle
 * answers on the keystroke instead of waiting for the next re-parse.
 *
 * @param {string} body - The YAML inside a `step` block
 * @returns {boolean}
 */
export const stepEnabled = (body: string): boolean => {
  const match = normalize(body).split('\n').map((line) => ENABLED_LINE.exec(line)).find(Boolean);
  if (!match) return true;
  return match[1].split('#')[0].trim().toLowerCase() !== 'false';
};

/**
 * The same YAML with the step switched on or off.
 *
 * Switching a step on removes the key rather than writing `enabled: true`:
 * the default is what a flow says by not mentioning it, and a document that
 * was never toggled must come back byte for byte as it was.
 *
 * @param {string} body - The YAML inside a `step` block
 * @param {boolean} enabled - What the switch was moved to
 * @returns {string}
 */
export const withStepEnabled = (body: string, enabled: boolean): string => {
  const lines = normalize(body).split('\n');
  const at = lines.findIndex((line) => ENABLED_LINE.test(line));

  if (enabled) {
    if (at < 0) return normalize(body);
    lines.splice(at, 1);
    return lines.join('\n');
  }

  if (at >= 0) {
    lines[at] = 'enabled: false';
    return lines.join('\n');
  }

  // First line, where a reader meets it before the step's own keys
  return lines.some((line) => line.trim() !== '')
    ? ['enabled: false', ...lines].join('\n')
    : 'enabled: false';
};

/**
 * Number the step blocks in fence order, the way the parser does, so cell
 * `n` lines up with `steps[n]` and with the run's `stepOrder[n]`.
 */
export const stepIndexes = (blocks: Block[]): Map<string, number> => {
  const indexes = new Map<string, number>();
  let index = 0;
  blocks.forEach((block) => {
    if (isStepBlock(block)) {
      indexes.set(block.id, index);
      index += 1;
    }
  });
  return indexes;
};

/**
 * Split the YAML frontmatter (plus the blank lines under it) off the body.
 * A document without frontmatter simply gets an empty head.
 */
const splitFrontmatter = (content: string): { head: string; body: string } => {
  const lines = normalize(content).split('\n');
  if (!lines.length || lines[0].trim() !== '---') return { head: '', body: normalize(content) };

  for (let i = 1; i < lines.length; i++) {
    // The closing marker must start at column 0 — indented '---' lines can
    // legitimately appear inside YAML block scalars
    if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
      return {
        head: `${lines.slice(0, i + 1).join('\n')}\n`,
        body: lines.slice(i + 1).join('\n'),
      };
    }
  }

  // No closing marker: the parser reads the whole document as body, so do the same
  return { head: '', body: normalize(content) };
};

/** Where the run of lines belonging to one block ends (exclusive). */
const blockEnd = (lines: string[], start: number): number => {
  const first = lines[start];

  const fenceMatch = first.match(FENCE_RE);
  if (fenceMatch) {
    const [, fence, info] = fenceMatch;
    if (!(fence[0] === '`' && info.includes('`'))) {
      const closeRe = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`);
      for (let i = start + 1; i < lines.length; i++) {
        if (closeRe.test(lines[i])) return i + 1;
      }
      return lines.length;
    }
  }

  if (RULE_RE.test(first) || HEADING_RE.test(first)) return start + 1;

  if (QUOTE_RE.test(first)) {
    let i = start + 1;
    while (i < lines.length && QUOTE_RE.test(lines[i])) i += 1;
    return i;
  }

  if (LIST_ITEM_RE.test(first)) {
    // A list runs on across single blank lines as long as an item or an
    // indented continuation follows: loose lists stay one block.
    let i = start + 1;
    while (i < lines.length) {
      if (!isBlank(lines[i])) {
        if (FENCE_RE.test(lines[i]) || HEADING_RE.test(lines[i]) || RULE_RE.test(lines[i])) break;
        i += 1;
        continue;
      }
      const next = lines[i + 1];
      if (next !== undefined && !isBlank(next) && (LIST_ITEM_RE.test(next) || /^[ \t]{2,}\S/.test(next))) {
        i += 2;
        continue;
      }
      break;
    }
    return i;
  }

  // A paragraph runs until a blank line or until something that interrupts it
  let i = start + 1;
  while (i < lines.length && !isBlank(lines[i])) {
    const line = lines[i];
    if (FENCE_RE.test(line) || HEADING_RE.test(line) || RULE_RE.test(line) || QUOTE_RE.test(line) || LIST_ITEM_RE.test(line)) break;
    i += 1;
  }
  return i;
};

/**
 * Cut a Markdown document into blocks.
 *
 * @param {string} content - The whole document, frontmatter included
 * @returns {BlockDocument} The frontmatter and the blocks of the body
 */
export const parseDocument = (content: string): BlockDocument => {
  const { head, body } = splitFrontmatter(content);
  const lines = body.split('\n');
  const blocks: Block[] = [];

  let i = 0;
  let leading = 0;
  while (i < lines.length && isBlank(lines[i])) {
    i += 1;
    leading += 1;
  }

  while (i < lines.length) {
    const end = blockEnd(lines, i);
    const text = lines.slice(i, end).join('\n');

    let next = end;
    while (next < lines.length && isBlank(lines[next])) next += 1;

    // Joining lines with '\n' means the gap is one newline per line skipped,
    // and one more for the line break that closed the block itself
    const sep = '\n'.repeat(next === lines.length ? lines.length - end : next - end + 1);
    blocks.push({ id: nextBlockId(), text, sep });
    i = next;
  }

  // A body made of nothing but blank lines has one line more than it has
  // line breaks, so the last one is not a separator
  const lead = '\n'.repeat(blocks.length ? leading : Math.max(0, leading - 1));

  return { head: `${head}${lead}`, blocks };
};

/** Put a document back together, byte for byte where nothing changed. */
export const serializeDocument = (doc: BlockDocument): string =>
  doc.head + doc.blocks.map((block) => block.text + block.sep).join('');

export default parseDocument;
