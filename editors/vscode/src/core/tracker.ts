/**
 * What a run's events mean for each flow and each step.
 *
 * The CLI reports a run the way it reports it to the web UI: a
 * 'testrun:update' with the whole run every time it changes -- which flow is
 * running, which ones are over and how -- and a 'flowexecution:update' every
 * time something happens inside the flow that is running: a step started,
 * finished, was skipped, or asked for a value. The steps say nothing about the
 * flow they belong to, which is fine: flows run one at a time, and the run
 * says which one that is before any of its steps starts.
 *
 * Two things the events do not say outright, and the tracker works out:
 *
 *  - A step whose assertions failed is reported twice, 'failed' and then
 *    'error' -- the runner throws the failure, and catches it as any other.
 *    It is one failure, reported once, as a failure and not as an error.
 *  - A step the run never got to is never mentioned at all. When its flow
 *    ends, whoever listens is told which steps were, and can mark the rest.
 */

export type StepStatus = 'passed' | 'failed' | 'errored' | 'skipped';

/** Why a step failed: a message, and what was expected against what came, when it says. */
export interface Failure {
  message: string;
  expected?: string;
  actual?: string;
}

/** The step an event is about. */
export interface StepRef {
  /** Its position among the flow's step blocks */
  index: number;
  /** The runner's id for it */
  id: string;
}

export interface StepResult {
  status: StepStatus;
  /** Milliseconds, when it ran */
  duration?: number;
  failures: Failure[];
}

export interface FlowResult {
  status: 'passed' | 'failed';
  /** Milliseconds */
  duration?: number;
  error?: string;
}

/** What a step asked the person running the flow for. */
export interface InputRequest {
  id: string;
  label: string;
  stepId?: string;
  secret?: boolean;
  defaultValue?: string;
}

/** The run as run.json has it. */
export interface RunSummary {
  id: string;
  status: 'running' | 'passed' | 'failed';
  environment?: string;
  trigger?: string;
  view?: string;
  folder?: string;
  times?: { start?: number; end?: number; duration?: number };
  flows: Array<{
    file: string;
    title?: string;
    status: 'pending' | 'running' | 'passed' | 'failed';
    times?: { start?: number; end?: number; duration?: number };
    steps?: { total: number; passed: number; failed: number };
    error?: string;
  }>;
}

/** Who is told. Every file is relative to the context's flows folder. */
export interface Sink {
  runUpdated?: (run: RunSummary) => void;
  flowStarted: (file: string) => void;
  stepStarted: (file: string, step: StepRef) => void;
  stepFinished: (file: string, step: StepRef, result: StepResult) => void;
  /** `reported` holds the index of every step a result was given for */
  flowFinished: (file: string, result: FlowResult, reported: Set<number>) => void;
  inputRequested?: (file: string | null, request: InputRequest) => void;
  inputResolved?: (id: string) => void;
}

/** A value as text, the way a diff shows it. */
export const show = (value: unknown): string => {
  if (value === undefined) { return 'undefined'; }
  if (typeof value === 'string') { return value; }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  }
  catch {
    return String(value);
  }
};

/**
 * The failures of a step's assertions, out of its test report: one per
 * mismatch, with what was expected and what came, so they can be diffed.
 * @param {Object} report - The step's testReport
 * @returns {Failure[]}
 */
export const failuresOf = (report: any): Failure[] => {
  if (!report || typeof report !== 'object') { return []; }

  const failures: Failure[] = [];

  Object.entries(report).forEach(([aspect, entries]) => {
    if (aspect === 'hasErrors' || !Array.isArray(entries)) { return; }

    entries.forEach((entry: any) => {
      if (!entry || typeof entry !== 'object') { return; }

      // A listener's report: what it was waiting for and never got
      if (aspect === 'latentApplications' && Array.isArray(entry.errors)) {
        entry.errors.forEach((error: any) => failures.push({
          message: `${entry.application}: ${typeof error === 'string' ? error : (error && error.message) || show(error)}`
        }));
        return;
      }

      // A `$expr:` assertion has no expected value, only the expression
      if (entry.expression !== undefined) {
        failures.push({
          message: `${aspect}: ${entry.message || 'Expression failed'} -- $expr: ${entry.expression}`,
          actual: show(entry.actualValue)
        });
        return;
      }

      failures.push({
        message: `${aspect}: ${entry.message || 'Assertion failed'}`,
        expected: show(entry.expected),
        actual: show(entry.actual)
      });
    });
  });

  return failures;
};

/** How long a step took, in milliseconds. The runner keeps seconds as well. */
const durationOf = (execution: any): number | undefined => {
  const times = execution && execution.times;
  if (!times) { return undefined; }
  if (typeof times.start === 'number' && typeof times.end === 'number') { return times.end - times.start; }
  if (typeof times.duration === 'number') { return Math.round(times.duration * 1000); }
  return undefined;
};

/**
 * What a step's final update says about it.
 * @param {Object} step - The step, as the run reports it
 * @returns {StepResult}
 */
export const resultOf = (step: any): StepResult => {
  const execution = step.execution || {};
  const duration = durationOf(execution);
  const report = step.testReport;
  const asserted = Boolean(report && report.hasErrors);

  if (execution.status === 'passed') {
    return { status: 'passed', duration, failures: [] };
  }

  if (execution.status === 'skipped') {
    return { status: 'skipped', failures: [] };
  }

  // An assertion that did not hold is a failure -- whatever the runner
  // ended up calling it -- and a step that threw is an error
  if (execution.status === 'failed' || asserted || (execution.error && execution.error.name === 'TestFailed')) {
    const failures = failuresOf(report);
    return {
      status: 'failed',
      duration,
      failures: failures.length ? failures : [{ message: (execution.error && execution.error.message) || 'The step failed' }]
    };
  }

  return {
    status: 'errored',
    duration,
    failures: [{ message: (execution.error && execution.error.message) || 'The step failed' }]
  };
};

/** Turns events into what they mean, for a sink. */
export class Tracker {
  /** The file of the flow running now */
  private current: string | null = null;
  /** The last status seen of every flow of the run */
  private flows = new Map<string, string>();
  /** Steps of the current flow given a final result */
  private reported = new Set<number>();
  /** Steps of the current flow that started and have not ended */
  private open = new Map<number, any>();

  constructor(private readonly sink: Sink) {}

  /** The flow running now, if any. */
  get running(): string | null {
    return this.current;
  }

  /** Feed an event of the run. */
  handle(event: string, payload: any): void {
    if (event === 'testrun:update') {
      this.run(payload && payload.run);
    }
    else if (event === 'flowexecution:update') {
      this.execution(payload || {});
    }
  }

  /**
   * The run is over, however it ended: a flow still open is the caller's to
   * explain, but a step that had failed already is said now.
   */
  close(): void {
    this.settleOpenSteps();
  }

  private run(run: RunSummary | undefined) {
    if (!run || !Array.isArray(run.flows)) { return; }

    if (this.sink.runUpdated) { this.sink.runUpdated(run); }

    run.flows.forEach(flow => {
      const before = this.flows.get(flow.file);
      if (before === flow.status) { return; }
      this.flows.set(flow.file, flow.status);

      if (flow.status === 'running') {
        this.current = flow.file;
        this.reported = new Set();
        this.open = new Map();
        this.sink.flowStarted(flow.file);
        return;
      }

      if (flow.status === 'passed' || flow.status === 'failed') {
        if (this.current === flow.file) {
          this.settleOpenSteps();
        }

        const duration = flow.times && typeof flow.times.duration === 'number' ? flow.times.duration : undefined;
        this.sink.flowFinished(flow.file, {
          status: flow.status,
          ...(duration !== undefined ? { duration } : {}),
          ...(flow.error ? { error: flow.error } : {})
        }, this.current === flow.file ? this.reported : new Set());

        if (this.current === flow.file) {
          this.current = null;
        }
      }
    });
  }

  private execution({ topic, data }: { topic?: string; data?: any }) {
    if (topic === 'input' && data) {
      if (data.status === 'pending' && this.sink.inputRequested) {
        this.sink.inputRequested(this.current, {
          id: data.id,
          label: data.label,
          stepId: data.stepId,
          secret: Boolean(data.secret),
          defaultValue: data.defaultValue
        });
      }
      else if (data.status === 'resolved' && this.sink.inputResolved) {
        this.sink.inputResolved(data.id);
      }
      return;
    }

    if (topic !== 'step' || !data || !data.data || this.current === null) { return; }

    const step = data.data;
    const ref: StepRef = {
      index: typeof step.stepIndex === 'number' ? step.stepIndex : -1,
      id: String(step.id || data.id || '')
    };
    const status = step.execution && step.execution.status;

    if (status === 'running') {
      // Said again on every attempt: only the first says anything new
      if (!this.open.has(ref.index)) {
        this.open.set(ref.index, step);
        this.reported.delete(ref.index);
        this.sink.stepStarted(this.current, ref);
      }
      return;
    }

    // A failed assertion is followed by the same step as an error: wait for it
    if (status === 'failed') {
      this.open.set(ref.index, step);
      return;
    }

    if (status === 'passed' || status === 'error' || status === 'skipped') {
      this.open.delete(ref.index);
      this.reported.add(ref.index);
      this.sink.stepFinished(this.current, ref, resultOf(step));
    }
  }

  /** Steps left open that had already said how they ended. */
  private settleOpenSteps() {
    if (this.current === null) { return; }

    this.open.forEach((step, index) => {
      if (!step.execution || step.execution.status !== 'failed') { return; }
      this.reported.add(index);
      this.sink.stepFinished(this.current as string, { index, id: String(step.id || '') }, resultOf(step));
    });
    this.open.clear();
  }
}
