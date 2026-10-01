import fs from 'fs';
import path from 'path';

import { parseFlow } from './flowParser';
import { resultOf, summarize } from './tracker';
import type { RunSummary } from './tracker';

/**
 * The runs a context has recorded.
 *
 * Every run -- started here, from the CLI, from the web UI, or on an agent --
 * is a folder of the context's `test-runs`: a run.json summary, and a copy of
 * each flow it ran with a ```step-result block under every step
 * (src/helpers/testRuns.ts in the package). Reading them is all it takes to
 * show every execution, wherever it was started from.
 */

const RUNS_DIR = 'test-runs';
const SUMMARY_FILE = 'run.json';

/** A recorded run. */
export interface RunRecord {
  id: string;
  /** The run folder */
  dir: string;
  /** The context it belongs to */
  context: string;
  summary: RunSummary;
}

/** A step of a flow's copy, with what the run did with it. */
export interface StepRecord {
  index: number;
  label: string;
  /** passed, failed, errored, skipped -- or pending, when the copy holds no result for it */
  status: string;
  /** Milliseconds */
  duration?: number;
  error?: string;
  /** The line of the step block in the copy */
  line: number;
  /** The line of its result block in the copy, when it has one */
  resultLine?: number;
}

/**
 * The runs of a context, newest first. A folder whose run.json is missing or
 * broken is skipped, as the web UI skips it.
 * @param {string} context
 * @param {number} [limit]
 * @returns {RunRecord[]}
 */
export const listRuns = (context: string, limit = Infinity): RunRecord[] => {
  const root = path.join(context, RUNS_DIR);

  let names: string[];
  try {
    names = fs.readdirSync(root);
  }
  catch {
    return [];
  }

  const runs: RunRecord[] = [];

  for (const name of names) {
    const dir = path.join(root, name);
    try {
      const summary = JSON.parse(fs.readFileSync(path.join(dir, SUMMARY_FILE), 'utf8'));
      if (!summary || !Array.isArray(summary.flows)) { continue; }
      // The folder name is the id, whatever the file says
      runs.push({ id: name, dir, context, summary: { ...summary, id: name } });
    }
    catch {
      continue;
    }
  }

  return runs
    .sort((a, b) => startOf(b) - startOf(a) || b.id.localeCompare(a.id))
    .slice(0, limit);
};

const startOf = (run: RunRecord) => (run.summary.times && run.summary.times.start) || 0;

/**
 * Where the copy of one flow of a run is.
 * @param {RunRecord} run
 * @param {string} file - As the run names it
 * @returns {string|null} null for a name that would leave the run folder
 */
export const copyOf = (run: RunRecord, file: string): string | null => {
  const absolute = path.resolve(run.dir, String(file || '').replace(/\\/g, '/'));
  return absolute.startsWith(run.dir + path.sep) ? absolute : null;
};

/**
 * The steps of a flow's copy and what became of each.
 * @param {string} file - The copy
 * @returns {StepRecord[]|null} null when there is no copy to read
 */
export const readSteps = (file: string): StepRecord[] | null => {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  }
  catch {
    return null;
  }

  const parsed = parseFlow(text);

  return parsed.steps.map(step => {
    const block = parsed.results.find(result => result.stepIndex === step.index);
    const stored = block && block.result && block.result.execution ? block.result : null;
    const position = {
      index: step.index,
      label: step.label,
      line: step.line,
      ...(block ? { resultLine: block.line } : {})
    };

    if (!stored || !stored.execution.status) {
      return { ...position, status: 'pending' };
    }

    // Read the way a live run is read: an assertion that did not hold is a
    // failure, whatever status the runner stored for it
    const result = resultOf(stored);
    const failure = result.failures[0];

    return {
      ...position,
      status: result.status,
      ...(result.duration !== undefined ? { duration: result.duration } : {}),
      ...(failure ? { error: summarize(failure) } : {})
    };
  });
};
