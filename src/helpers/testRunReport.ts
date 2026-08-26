import fs from 'fs';
import path from 'path';

import * as markdownFlows from './markdownFlows';
import type { TestRunSummary, TestRunFlowSummary } from './testRuns';

/**
 * The standalone HTML report of a test run.
 *
 * When a run finishes, a single self-contained report.html lands next to
 * run.json inside the run folder: the run's outcome at a glance, every
 * failure with its evidence (the steps that ran, the assertion that broke,
 * the response that broke it), and one square per flow grouped by suite.
 * The file opens anywhere -- a browser tab, an email attachment, a CI
 * artifact -- with no server behind it.
 *
 * Everything here reads the run folder directly (run.json plus the stored
 * flow copies), so the report can also be rebuilt on demand for runs
 * recorded before this feature existed.
 */

const REPORT_FILE = 'report.html';

export { REPORT_FILE };

/* -------------------------------------------------------------- formatting */

/** HTML-safe text. */
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export { escapeHtml };

/** "14m 32s" / "1.2 s" / "480 ms" from a duration in milliseconds. */
const duration = (ms) => {
  if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) { return null; }
  if (ms < 1000) { return `${Math.round(ms)} ms`; }
  if (ms < 60000) { return `${(ms / 1000).toFixed(1)} s`; }
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

/** "2026-08-20 09:14 UTC" from epoch milliseconds. */
const utc = (ms) => {
  if (typeof ms !== 'number') { return null; }
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

/** The suite a flow file belongs to: its top folder, "./" at the root. */
const suiteOf = (file) => {
  const parts = String(file || '').split('/');
  return parts.length > 1 ? `${parts[0]}/` : './';
};

/** Where the run came from, for the report's corner badge. */
const triggerLabel = (trigger) => {
  if (trigger === 'folder') { return 'Folder run'; }
  if (trigger === 'cli') { return 'CLI'; }
  return 'Flow run';
};

/** A JSON value as one line of evidence, cut before it floods the report. */
const jsonLine = (value, max = 2000) => {
  let text;
  try {
    text = JSON.stringify(value);
  }
  catch {
    text = String(value);
  }
  if (text === undefined) { return 'undefined'; }
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/* ------------------------------------------------------------ collecting */

/**
 * The evidence of one failed flow, read from its stored copy: every step
 * with how it went, and what the failing steps had to say (assertion
 * errors, execution errors, the response that was asserted on).
 *
 * A copy that is missing or does not parse must not take the report down --
 * the run summary's own error message is evidence enough.
 *
 * @param {string} dir - The run folder
 * @param {TestRunFlowSummary} entry - The flow as run.json carries it
 * @returns {{tags: string[], steps: Array<Object>, evidence: Array<Object>}}
 */
const failureDetails = (dir, entry) => {
  const details: { tags: string[]; steps: any[]; evidence: any[] } = { tags: [], steps: [], evidence: [] };

  if (entry.error) {
    details.evidence.push({ label: 'error', text: entry.error });
  }

  let parsed;
  let results;
  try {
    const absolute = path.resolve(dir, String(entry.file || '').replace(/\\/g, '/'));
    if (absolute === dir || !absolute.startsWith(dir + path.sep)) { return details; }
    const raw = fs.readFileSync(absolute, 'utf8');
    const extracted = markdownFlows.extractResults(raw);
    parsed = markdownFlows.parse(extracted.content);
    results = extracted.results;
  }
  catch {
    return details;
  }

  if (Array.isArray(parsed.meta && parsed.meta.tags)) {
    details.tags = parsed.meta.tags.map(tag => String(tag));
  }

  parsed.steps.forEach((step, index) => {
    const at = typeof step.stepIndex === 'number' ? step.stepIndex : index;
    const result = results[at] || { execution: { status: 'skipped' } };
    const status = (result.execution && result.execution.status) || 'skipped';
    const failed = status === 'failed' || status === 'error';

    const name = [step.application, step.method].filter(Boolean).join(' ') || `step ${at + 1}`;
    const took = duration(result.execution && result.execution.times && result.execution.times.duration);

    details.steps.push({
      no: at + 1,
      name: took ? `${name} · ${took}` : name,
      status: failed ? 'failed' : (status === 'passed' ? 'passed' : 'skipped')
    });

    if (!failed) { return; }

    const report = result.testReport || {};
    ['status', 'body'].forEach(aspect => {
      (Array.isArray(report[aspect]) ? report[aspect] : []).forEach(problem => {
        const parts = [problem.message];
        if ('expression' in problem) {
          parts.push(`expression: ${problem.expression}`, `actual: ${jsonLine(problem.actualValue)}`);
        }
        else if ('expected' in problem || 'actual' in problem) {
          parts.push(`expected: ${jsonLine(problem.expected)}`, `actual: ${jsonLine(problem.actual)}`);
        }
        details.evidence.push({ label: 'assertion', text: parts.filter(Boolean).join(' — ') });
      });
    });
    (Array.isArray(report.latentApplications) ? report.latentApplications : []).forEach(problem => {
      details.evidence.push({ label: 'assertion', text: `${problem.application}: ${jsonLine(problem.errors)}` });
    });

    const error = result.execution && result.execution.error;
    if (error && error.message) {
      details.evidence.push({ label: 'error', text: error.message });
    }

    if (result.response) {
      const label = typeof result.response.status === 'number' ? `response ${result.response.status}` : 'response';
      details.evidence.push({ label, text: jsonLine(result.response.body) });
    }
  });

  return details;
};

/* -------------------------------------------------------------- rendering */

const COLORS = {
  passed: '#3E7C4F',
  failed: '#B3402F',
  skipped: '#C9C6C2'
};

const MARKS = { passed: '✓', failed: '✕', skipped: '○' };

/** The colored square of one flow in the suite overview. */
const dot = (flow: TestRunFlowSummary) => {
  const color = COLORS[flow.status] || COLORS.skipped;
  return `<span class="dot" style="background:${color}" title="${escapeHtml(flow.title || flow.file)}"></span>`;
};

/** One expandable failure card. */
const failureCard = (entry: TestRunFlowSummary, details) => {
  const tags = details.tags
    .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join('');

  const meta = [suiteOf(entry.file), duration(entry.times && entry.times.duration)]
    .filter(Boolean)
    .join(' · ');

  const steps = details.steps
    .map(step => [
      '<div class="step">',
      `<span class="mark" style="color:${COLORS[step.status]}">${MARKS[step.status]}</span>`,
      `<span class="no">${step.no}</span>`,
      `<span class="text ${step.status}">${escapeHtml(step.name)}</span>`,
      '</div>'
    ].join(''))
    .join('\n');

  const evidence = details.evidence
    .map(item => `<div><span class="key">${escapeHtml(item.label)}</span> ${escapeHtml(item.text)}</div>`)
    .join('\n');

  return [
    '<details class="failure">',
    '<summary>',
    '<span class="verdict">FAIL</span>',
    `<span class="name">${escapeHtml(entry.title || entry.file)}</span>`,
    tags ? `<span class="tags">${tags}</span>` : '',
    '<span class="spacer"></span>',
    `<span class="meta">${escapeHtml(meta)}</span>`,
    '</summary>',
    '<div class="body">',
    steps ? `<div class="steps">\n${steps}\n</div>` : '',
    evidence ? `<div class="console">\n${evidence}\n</div>` : '',
    '</div>',
    '</details>'
  ].filter(Boolean).join('\n');
};

/**
 * The whole report as one self-contained HTML document.
 *
 * @param {TestRunSummary} summary - The run.json document
 * @param {string} dir - The run folder, to read failed flows' copies from
 * @returns {string}
 */
const buildHtml = (summary: TestRunSummary, dir: string) => {
  const flows = summary.flows || [];
  const passed = flows.filter(flow => flow.status === 'passed').length;
  const failed = flows.filter(flow => flow.status === 'failed').length;
  const rest = flows.length - passed - failed;

  // Suites in order of first appearance, like the run itself went
  const suites = new Map<string, TestRunFlowSummary[]>();
  flows.forEach(flow => {
    const suite = suiteOf(flow.file);
    if (!suites.has(suite)) { suites.set(suite, []); }
    suites.get(suite)!.push(flow);
  });

  const failures = flows.filter(flow => flow.status === 'failed');
  const status = summary.status === 'running' ? 'RUNNING' : summary.status.toUpperCase();
  const statusColor = summary.status === 'passed' ? COLORS.passed
    : summary.status === 'failed' ? COLORS.failed : '#B68235';

  const percent = (count) => (flows.length ? (count / flows.length) * 100 : 0);

  const headline = [
    escapeHtml(summary.id),
    utc(summary.times && summary.times.start),
    duration(summary.times && summary.times.duration),
    escapeHtml(summary.environment)
  ].filter(Boolean).join(' · ');

  const counts = [
    `<span style="color:${COLORS.passed}">${passed} passed</span>`,
    `<span style="color:${COLORS.failed}">${failed} failed</span>`,
    ...(rest ? [`<span class="muted">${rest} not run</span>`] : []),
    `<span class="muted">· ${flows.length} flow${flows.length === 1 ? '' : 's'}, ${suites.size} suite${suites.size === 1 ? '' : 's'}</span>`
  ].join('\n');

  const failuresSection = failures.length ? [
    '<div class="section">',
    `<div class="section-title" style="color:${COLORS.failed}">Failures — ${failures.length}</div>`,
    '<div class="failures">',
    failures.map(entry => failureCard(entry, failureDetails(dir, entry))).join('\n'),
    '</div>',
    '</div>'
  ].join('\n') : '';

  const suiteRows = [...suites.entries()]
    .map(([suite, members]) => {
      const ok = members.filter(flow => flow.status === 'passed').length;
      const ko = members.filter(flow => flow.status === 'failed').length;
      const summaryText = [
        `${ok} passed`,
        ...(ko ? [`${ko} failed`] : []),
        ...(members.length - ok - ko ? [`${members.length - ok - ko} not run`] : [])
      ].join(', ');
      return [
        '<div class="suite">',
        `<span class="suite-name">${escapeHtml(suite)}</span>`,
        `<span class="dots">${members.map(dot).join('')}</span>`,
        `<span class="suite-summary">${escapeHtml(summaryText)}</span>`,
        '</div>'
      ].join('\n');
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test run ${escapeHtml(summary.id)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; }
body { margin: 0; background: #E9E7E4; color: #201F1D;
  font-family: 'IBM Plex Sans', -apple-system, 'Segoe UI', sans-serif; }
.mono, .meta, .no, .mark, .verdict, .tag, .key, .suite-name, .suite-summary, .headline, .brand, .footer
  { font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
.muted { color: #9B9797; }
.page { max-width: 1160px; margin: 0 auto; padding: clamp(12px, 3vw, 40px); }
.panel { background: #F3F2F2; border: 1px solid #D8D5D1; }
.head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center;
  gap: 12px 16px; padding: 24px clamp(16px, 3.5vw, 40px); border-bottom: 1px solid #D8D5D1; }
.head .titles { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.brand { font-weight: 500; font-size: 18px; }
.headline { font-size: 13px; color: #9B9797; }
.corner { font-weight: 600; font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase;
  border: 1px dashed #9B9797; padding: 5px 12px; }
.status { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 32px;
  padding: 24px clamp(16px, 3.5vw, 40px); border-bottom: 1px solid #D8D5D1; }
.status .word { font-size: 30px; font-weight: 600; }
.status .chart { flex: 1; min-width: 260px; }
.bar { display: flex; height: 18px; background: #C9C6C2; }
.counts { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-top: 8px;
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 13px; }
.section { padding: 28px clamp(16px, 3.5vw, 40px); border-bottom: 1px solid #D8D5D1; }
.section:last-of-type { border-bottom: 0; }
.section-title { font-size: 14px; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: #9B9797; margin-bottom: 18px; }
.failures { display: flex; flex-direction: column; gap: 16px; }
.failure { background: #FFFFFF; border: 1px solid #D8D5D1; }
.failure > summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 14px;
  padding: 14px 20px; cursor: pointer; list-style: none; }
.failure > summary::-webkit-details-marker { display: none; }
.failure > summary::after { content: '▸'; font-family: 'IBM Plex Mono', monospace;
  font-size: 12px; color: #B68235; }
.failure[open] > summary { border-bottom: 1px solid #EEEBE7; }
.failure[open] > summary::after { content: '▾'; }
.verdict { font-size: 12px; font-weight: 500; color: #B3402F; }
.failure .name { font-weight: 600; font-size: 15px; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.tag { font-size: 11px; color: #7A5A26; background: #EFE4D2; padding: 2px 7px; }
.spacer { flex: 1; }
.meta { font-size: 12px; color: #9B9797; }
.failure .body { padding: 16px 20px; }
.steps { display: flex; flex-direction: column; gap: 5px;
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12.5px; margin-bottom: 12px; }
.step { display: flex; gap: 12px; }
.step .mark { width: 14px; flex-shrink: 0; }
.step .no { color: #9B9797; width: 16px; flex-shrink: 0; }
.step .text.failed { color: #B3402F; }
.step .text.skipped { color: #9B9797; }
.console { background: #201F1D; color: #C9C6C2; padding: 14px 16px;
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: 12px; line-height: 1.6;
  overflow-x: auto; }
.console .key { color: #B68235; }
.suite { display: flex; flex-wrap: wrap; gap: 10px 20px; align-items: center;
  background: #FFFFFF; border: 1px solid #E2DFDB; padding: 12px 20px; margin-bottom: 8px; }
.suite:last-child { margin-bottom: 0; }
.suite-name { font-size: 14px; font-weight: 500; width: 130px; }
.dots { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; min-width: 140px; }
.dot { width: 12px; height: 12px; display: inline-block; }
.suite-summary { font-size: 13px; color: #9B9797; }
.footer { padding: 14px clamp(16px, 3.5vw, 40px); border-top: 1px solid #D8D5D1;
  display: flex; flex-wrap: wrap; gap: 8px 24px; justify-content: space-between;
  font-size: 12px; color: #9B9797; }
</style>
</head>
<body>
<div class="page">
<div class="panel">
<div class="head">
<div class="titles">
<span class="brand">lab34/flows</span>
<span class="headline">${headline}</span>
</div>
<span class="corner">${escapeHtml(triggerLabel(summary.trigger))}</span>
</div>
<div class="status">
<div class="word" style="color:${statusColor}">${escapeHtml(status)}</div>
<div class="chart">
<div class="bar">
<div style="width:${percent(passed)}%;background:${COLORS.passed}"></div>
<div style="width:${percent(failed)}%;background:${COLORS.failed}"></div>
</div>
<div class="counts">
${counts}
</div>
</div>
</div>
${failuresSection}
<div class="section">
<div class="section-title">All flows</div>
${suiteRows}
</div>
<div class="footer">
<span>lab34/flows · generated ${utc(Date.now())}</span><span>each square = one flow · tap a failure to expand evidence</span>
</div>
</div>
</div>
</body>
</html>
`;
};

export { buildHtml };

/**
 * Write the report of a run into its folder. Returns the HTML it wrote.
 *
 * @param {string} dir - The run folder
 * @param {TestRunSummary} summary - The run.json document
 * @returns {string}
 */
const write = (dir: string, summary: TestRunSummary) => {
  const html = buildHtml(summary, dir);
  fs.writeFileSync(path.join(dir, REPORT_FILE), html, 'utf8');
  return html;
};

export { write };
