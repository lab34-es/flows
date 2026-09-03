import 'colors';

import type { InputRequest } from '../inputs';

/**
 * A remote run, on the terminal.
 *
 * The agent's events are the ones the UI draws from; here they become one
 * line each, enough to follow a run from a shell or a pipeline log. A step
 * that asks for a value asks on this terminal, the way a local CLI run does.
 */

/**
 * One line for an event, or null for an event that says nothing new here.
 * @param {string} event
 * @param {*} payload
 * @returns {string|null}
 */
const describe = (event: string, payload: any): string | null => {
  if (event === 'remote:job') {
    const { status, message } = payload || {};
    switch (status) {
      case 'accepted': return '  agent: job accepted'.gray;
      case 'preparing': return `  agent: ${message || 'preparing'}`.gray;
      case 'running': return '  agent: running'.gray;
      case 'finished': return `  agent: finished (${payload.testRun})`.gray;
      case 'rejected':
      case 'failed': return `  agent: ${status}: ${message || ''}`.red;
      default: return null;
    }
  }

  if (event === 'testrun:update') {
    const run = payload && payload.run;
    if (!run || !Array.isArray(run.flows)) { return null; }

    return run.flows
      .filter(flow => flow.status !== 'pending')
      .map(flow => {
        const label = `${flow.status}`.padEnd(8);
        const line = `  ${label} ${flow.file}${flow.error ? ` — ${flow.error}` : ''}`;
        return flow.status === 'failed' ? line.red : (flow.status === 'passed' ? line.green : line.gray);
      })
      .join('\n') || null;
  }

  if (event === 'flowexecution:update') {
    const { topic, data } = payload || {};

    if (topic === 'step' && data && data.data) {
      const step = data.data;
      const status = (step.execution && step.execution.status) || 'running';
      const error = step.execution && step.execution.error && step.execution.error.message;
      const line = `    ${status.padEnd(8)} ${step.id}${error ? ` — ${error}` : ''}`;
      return status === 'failed' ? line.red : (status === 'passed' ? line.green : line.gray);
    }

    if (topic === 'execution' && data && data.status && data.status !== 'running') {
      return `  execution ${data.status}`[data.status === 'error' ? 'red' : 'green'];
    }
  }

  return null;
};

/**
 * Ask on the terminal for the value a remote step is waiting on.
 * @param {InputRequest} request
 * @returns {Promise<string|null>}
 */
const prompt = (request: InputRequest): Promise<string | null> =>
  new Promise(resolve => {
    process.stdout.write(`      ${request.label}: `.yellow);
    process.stdin.once('data', key => {
      resolve(key.toString().replace(/\r?\n/g, '').trim());
    });
  });

export { describe, prompt };
