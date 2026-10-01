import YAML from 'yaml';

/**
 * Where the steps of a flow document are.
 *
 * A flow is a Markdown document whose executable parts are fenced code blocks
 * tagged `step` (see src/helpers/markdownFlows.ts in the package). The editor
 * needs three things from it that the run itself never says: the line every
 * step block starts on, so a check or a cross can be drawn there; the index
 * the runner gives each block, so an event about step 3 lands on the third
 * block; and the id the runner gives each step, so results stay attached to
 * the same step when another one is inserted above it.
 *
 * The rules are the package's own, restated: the same fences, the same info
 * tokens, the same frontmatter, the same ids. Anything that changes there has
 * to change here, or the marks end up on the wrong lines.
 */

/** A ```step block, where it is and what it says. */
export interface StepBlock {
  /** Its position among the document's step blocks, as the runner counts them */
  index: number;
  /** The id the runner gives it: its slug, or application-method, made unique */
  id: string;
  /** Line of the opening fence, zero based */
  line: number;
  /** Line of the closing fence, or the last line when it was never closed */
  endLine: number;
  /** Its description, or what it calls */
  label: string;
  /** What it calls, as application.method, when it says */
  call: string | null;
  enabled: boolean;
  /** Why the block cannot run: its YAML does not parse, or is not an object */
  error?: string;
}

/** A ```step-result block a test run writes under a step, in its copy. */
export interface ResultBlock {
  /** The step block it belongs to: the one right above it */
  stepIndex: number;
  line: number;
  endLine: number;
  /** The YAML it holds, parsed; null when it does not parse */
  result: Record<string, any> | null;
}

export interface ParsedFlow {
  /** The frontmatter title, or else the first `# heading` */
  title: string | null;
  /** The line the title is on; the first line when there is none */
  titleLine: number;
  /** The frontmatter, parsed; empty when there is none, or it does not parse */
  meta: Record<string, any>;
  steps: StepBlock[];
  results: ResultBlock[];
}

const STEP_TOKENS = ['step', 'flow-step'];
const RESULT_TOKENS = ['step-result'];

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}#\s+(.+?)\s*#*\s*$/;

const tokensOf = (info: string) => info.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** Whether a fence's info string marks a step. */
export const isStepInfo = (info: string): boolean => tokensOf(info).some(token => STEP_TOKENS.includes(token));

/** Whether a fence's info string marks a stored step result. */
export const isResultInfo = (info: string): boolean => tokensOf(info).some(token => RESULT_TOKENS.includes(token));

/**
 * Whether a step runs: only an explicit `enabled: false` (or "false") takes
 * one out, which is what the toggle of the web UI writes.
 */
export const isEnabled = (step: Record<string, any> | null): boolean => {
  const enabled = step ? step.enabled : undefined;
  if (enabled === undefined || enabled === null) { return true; }
  if (typeof enabled === 'string') { return enabled.trim().toLowerCase() !== 'false'; }
  return enabled !== false;
};

/**
 * The frontmatter: where it ends, and what it says.
 * @returns {{meta: Object, bodyStart: number, titleLine: number|null}}
 */
const frontmatter = (lines: string[]): { meta: Record<string, any>; bodyStart: number; titleLine: number | null } => {
  const none = { meta: {}, bodyStart: 0, titleLine: null };

  if (!lines.length || lines[0].trim() !== '---') { return none; }

  for (let i = 1; i < lines.length; i++) {
    // The closing marker sits at column 0: an indented one is inside a block scalar
    if (!/^(---|\.\.\.)\s*$/.test(lines[i])) { continue; }

    let meta: Record<string, any> = {};
    try {
      const parsed = YAML.parse(lines.slice(1, i).join('\n'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) { meta = parsed; }
    }
    catch {
      // A frontmatter that does not parse names nothing
    }

    const titleAt = lines.slice(1, i).findIndex(line => /^title\s*:/.test(line));

    return { meta, bodyStart: i + 1, titleLine: titleAt === -1 ? null : titleAt + 1 };
  }

  // Never closed: the whole document is body
  return none;
};

/**
 * The id the runner gives a step (buildSteps in runner/v1): its slug when it
 * has one, otherwise what it calls.
 */
const baseId = (step: Record<string, any>): string => {
  if (step.slug) { return String(step.slug); }

  const waitForTime = step.waitForTime;

  return [
    step.application,
    step.method,
    waitForTime ? 'waitForTime' : '',
    waitForTime ? waitForTime.time || '?' : ''
  ].filter(Boolean).join('-');
};

/** The first line of a description, which is what fits in a tree. */
const firstLine = (value: unknown): string | null => {
  if (typeof value !== 'string') { return null; }
  const line = value.trim().split('\n')[0].trim();
  return line || null;
};

/**
 * Parse a flow document.
 * @param {string} text - The document
 * @returns {ParsedFlow}
 */
export const parseFlow = (text: string): ParsedFlow => {
  const lines = (text || '').replace(/\r\n?/g, '\n').split('\n');
  const { meta, bodyStart, titleLine: frontmatterTitleLine } = frontmatter(lines);

  const blocks: Array<{ start: number; end: number; step: boolean; result: boolean; content: string }> = [];
  let heading: { title: string; line: number } | null = null;

  for (let i = bodyStart; i < lines.length; i++) {
    const match = lines[i].match(FENCE);

    if (!match) {
      if (!heading) {
        const found = lines[i].match(HEADING);
        if (found) { heading = { title: found[1].trim(), line: i }; }
      }
      continue;
    }

    const [, fence, info] = match;

    // The info string of a backtick fence cannot hold a backtick (CommonMark)
    if (fence[0] === '`' && info.includes('`')) {
      continue;
    }

    const close = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`);
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (close.test(lines[j])) { end = j; break; }
    }

    const last = end === -1 ? lines.length - 1 : end;
    blocks.push({
      start: i,
      end: last,
      step: isStepInfo(info),
      result: !isStepInfo(info) && isResultInfo(info),
      content: lines.slice(i + 1, end === -1 ? lines.length : end).join('\n')
    });

    i = last;
  }

  const steps: StepBlock[] = [];
  const results: ResultBlock[] = [];

  blocks.forEach(block => {
    if (block.result) {
      let result: Record<string, any> | null = null;
      try {
        const parsed = YAML.parse(block.content);
        if (parsed && typeof parsed === 'object') { result = parsed; }
      }
      catch {
        // A hand-edited result is not worth failing the document over
      }
      results.push({ stepIndex: steps.length - 1, line: block.start, endLine: block.end, result });
      return;
    }

    if (!block.step) { return; }

    const index = steps.length;
    let step: Record<string, any> | null = null;
    let error: string | undefined;

    try {
      const parsed = YAML.parse(block.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        step = parsed;
      }
      else {
        error = 'Step block must contain a YAML object (application, method, ...)';
      }
    }
    catch (ex) {
      error = `Invalid step YAML: ${(ex as Error).message}`;
    }

    const call = step && step.application && step.method ? `${step.application}.${step.method}` : null;

    steps.push({
      index,
      id: step ? baseId(step) : '',
      line: block.start,
      endLine: block.end,
      label: firstLine(step && step.description) || call || `Step ${index + 1}`,
      call,
      enabled: isEnabled(step),
      ...(error ? { error } : {})
    });
  });

  // Ids must be unique: every step sharing one gets its position appended,
  // exactly as the runner does it
  const counts = new Map<string, number>();
  steps.forEach(step => counts.set(step.id, (counts.get(step.id) || 0) + 1));
  steps.forEach(step => {
    if ((counts.get(step.id) || 0) > 1) { step.id = `${step.id}-${step.index}`; }
  });

  const title = typeof meta.title === 'string' && meta.title.trim()
    ? meta.title.trim()
    : heading ? heading.title : null;

  const titleLine = typeof meta.title === 'string' && meta.title.trim() && frontmatterTitleLine !== null
    ? frontmatterTitleLine
    : heading ? heading.line : 0;

  return { title, titleLine, meta, steps, results };
};
