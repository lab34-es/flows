import type { RunSummary } from './tracker';

/**
 * How runs read in the editor: the same words and numbers the web UI uses
 * (frontend/src/lib/testRuns.ts), so a run looks the same wherever it is
 * looked at.
 */

/** "480 ms", "1.2 s", "2m 5s"; null when there is nothing to say. */
export const formatDuration = (ms: number | undefined | null): string | null => {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) { return null; }
  if (ms < 1000) { return `${Math.round(ms)} ms`; }
  if (ms < 60000) { return `${(ms / 1000).toFixed(1)} s`; }
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * When a run started: the time alone today, the date as well before.
 * @param {number} epoch - Milliseconds
 * @param {number} [now]
 * @returns {string}
 */
export const formatStart = (epoch: number, now: number = Date.now()): string => {
  const date = new Date(epoch);
  const today = new Date(now);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

  const sameDay = date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();

  return sameDay ? time : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
};

/** "3/4": how many of the run's flows passed. */
export const runScore = (run: RunSummary): string => {
  const flows = run.flows || [];
  return `${flows.filter(flow => flow.status === 'passed').length}/${flows.length}`;
};

/** What a run ran: its one flow, the view that chose its flows, or how many. */
export const runLabel = (run: RunSummary): string => {
  const flows = run.flows || [];
  if (flows.length === 1) { return flows[0].title || flows[0].file; }
  if (run.view) { return run.view; }
  return `${flows.length} flows`;
};

/** How long a run, or a flow of one, has taken: to its end, or until now. */
export const elapsed = (times: { start?: number; end?: number; duration?: number } | undefined, now = Date.now()) => {
  if (!times) { return undefined; }
  if (typeof times.duration === 'number') { return times.duration; }
  if (typeof times.start === 'number') { return (times.end || now) - times.start; }
  return undefined;
};
