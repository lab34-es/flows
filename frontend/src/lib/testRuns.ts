/**
 * Shared bits for rendering test runs: URLs, labels and status mapping.
 */

/** URL of a run's page. */
export function testRunUrl(id) {
  return `/test-runs/${encodeURIComponent(id)}`;
}

/** URL of one stored flow copy inside a run. */
export function testRunFlowUrl(id, file) {
  return `/test-runs/${encodeURIComponent(id)}/flow?path=${encodeURIComponent(file)}`;
}

/** URL of a run's standalone HTML report (served by the API). */
export function testRunReportUrl(id) {
  return `/api/test-runs/${encodeURIComponent(id)}/report`;
}

/** A run (or run flow) status as the StatusDot understands it. */
export function dotStatus(status) {
  if (status === 'running' || status === 'pending') { return 'running'; }
  if (status === 'passed') { return 'ok'; }
  if (status === 'failed') { return 'error'; }
  return 'standby';
}

/** "Aug 20, 14:30" — how a run is named around the UI. */
export function runLabel(run) {
  const start = run?.times?.start;
  if (!start) { return run?.id || 'Test run'; }
  return new Date(start).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "3/4" — how many of the run's flows passed. */
export function runScore(run) {
  const flows = run?.flows || [];
  const passed = flows.filter((flow) => flow.status === 'passed').length;
  return `${passed}/${flows.length}`;
}

/** Where the run came from, for a badge. */
export function triggerLabel(trigger) {
  if (trigger === 'folder') { return 'Folder run'; }
  if (trigger === 'cli') { return 'CLI'; }
  return 'Flow run';
}

/** "1.2 s" / "480 ms" from a { start, end } pair or a duration in ms. */
export function formatDuration(times) {
  const ms = typeof times?.duration === 'number'
    ? times.duration
    : (times?.start && times?.end ? times.end - times.start : null);
  if (ms === null || ms === undefined) { return null; }
  if (ms < 1000) { return `${Math.round(ms)} ms`; }
  if (ms < 60000) { return `${(ms / 1000).toFixed(1)} s`; }
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
