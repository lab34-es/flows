/**
 * Asking the person running a flow for a value, from wherever they are
 * running it.
 *
 * A step may need something only a human can supply -- the barcode of the
 * parcel , a code shown on a system. Reading it straight from
 * process.stdin`, which is what applications used to do, only
 * works on the CLI: started from the UI the prompt is printed on the terminal
 * the server happens to be attached to (nobody is looking at it) and the run
 * hangs for good.
 *
 * So the request is routed through the reporter, exactly like every other
 * thing a run has to say:
 *
 *  - on the CLI the reporter reads the answer from stdin, as before;
 *  - from the UI it emits the request over the socket and the answer comes
 *    back through `POST /api/flows/input`, which lands in `answer()` here.
 *
 * Requests wait forever by design -- `cancel()` is how a run gets out
 * of one: the UI offers it as a button, and the runner calls
 * `cancelAll()` when a flow ends so nothing is left waiting on a run
 * that is over.
 */
// Imported for its side effect: colors patches String.prototype, which the
// terminal prompt below relies on
import 'colors';
import { randomUUID } from 'crypto';

import type { Reporter } from './reporter';

/** What the person is being asked for. Sent as-is to the UI. */
export interface InputRequest {
  id: string;
  /** Only 'text' for now; the UI switches on it. */
  kind: 'text';
  /** The question, e.g. "Introduce the barcode to be reserved". */
  label: string;
  /** Step the run is stopped on, so the UI can put the field under it. */
  stepId?: string;
  /** Mask the field, for a value that should not be shown as it is typed. */
  secret?: boolean;
  /** Offered as the initial value of the field. */
  defaultValue?: string;
}

interface PendingInput {
  request: InputRequest;
  reporter: Reporter;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

/** Requests waiting for an answer, by id. At most one in practice. */
const pending = new Map<string, PendingInput>();

/** Options an application passes to `text()`. */
export interface TextOptions {
  label?: string;
  secret?: boolean;
  defaultValue?: string;
  /** Overrides the step the request is attached to. Rarely needed. */
  stepId?: string;
}

/**
 * Ask for a line of text and wait for it.
 *
 * @param {Context} ctx - The context the method was called with. Its
 *   `reporter` is what decides where the question is asked, and its `stepId`
 *   is where the UI shows it.
 * @param {TextOptions} [options]
 * @returns {Promise<string>} What was typed, trimmed. Rejects when the
 *   request is cancelled.
 */
export const text = (ctx: any, options: TextOptions = {}): Promise<string> => {
  const reporter: Reporter | undefined = ctx && ctx.reporter;

  const request: InputRequest = {
    id: randomUUID(),
    kind: 'text',
    label: options.label || 'Enter a value and press enter to continue',
    stepId: options.stepId || (ctx && ctx.stepId) || undefined,
    secret: Boolean(options.secret),
    defaultValue: options.defaultValue
  };

  // No reporter at all (an application called directly, from a test) or a CLI
  // run: the terminal is where the person is, so read from it
  if (!reporter || reporter.cli || typeof reporter.inputRequest !== 'function') {
    return readFromStdin(request);
  }

  return new Promise<string>((resolve, reject) => {
    pending.set(request.id, { request, reporter, resolve, reject });
    reporter.inputRequest(request);
  });
};

/** Read one line from the terminal the CLI is attached to. */
const readFromStdin = (request: InputRequest): Promise<string> =>
  new Promise<string>(resolve => {
    process.stdout.write(`      ${request.label}: `.yellow);
    process.stdin.once('data', key => {
      resolve(key.toString().replace(/\r?\n/g, '').trim());
    });
  });

/** Take a request out of the map and tell the UI to stop showing it. */
const settle = (id: string, finish: (entry: PendingInput) => void): boolean => {
  const entry = pending.get(id);

  if (!entry) {
    return false;
  }

  pending.delete(id);

  if (typeof entry.reporter.inputResolved === 'function') {
    entry.reporter.inputResolved(entry.request);
  }

  finish(entry);

  return true;
};

/**
 * Answer a pending request, resuming the step that asked for it.
 * @param {string} id
 * @param {string} value
 * @returns {boolean} false when nothing is waiting under that id
 */
export const answer = (id: string, value: string): boolean =>
  settle(id, entry => entry.resolve(String(value ?? '').trim()));

/**
 * Give up on a pending request. The step that asked for it fails, which is
 * what ends the run and frees it for the next one.
 * @param {string} id
 * @param {string} [reason]
 * @returns {boolean} false when nothing is waiting under that id
 */
export const cancel = (id: string, reason?: string): boolean =>
  settle(id, entry => entry.reject(new Error(reason || 'Input was cancelled')));

/**
 * Cancel everything still waiting. Called when a flow ends, so a request
 * nobody answered cannot outlive the run that made it.
 * @param {string} [reason]
 */
export const cancelAll = (reason?: string): void => {
  Array.from(pending.keys()).forEach(id => cancel(id, reason));
};

/** The requests currently waiting for an answer. */
export const list = (): InputRequest[] =>
  Array.from(pending.values()).map(entry => entry.request);
