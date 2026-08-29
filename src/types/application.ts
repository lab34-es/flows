/**
 * The types an application is written against.
 *
 * An application is user code living in the context directory, not in this
 * package, so these are the contract between the two: what the runner hands a
 * method, and what it expects back.
 *
 *   import { applications, httpClient } from '@lab34/flows';
 *   import type { Context, Parameters, Flow, MethodResult } from '@lab34/flows';
 *
 *   export const search = applications.handler([
 *     (ctx: Context, parameters: Parameters, flow: Flow): MethodResult =>
 *       httpClient.get(ctx, `/search/${parameters.query?.barcode}`)
 *   ], 'search');
 *
 * They are intentionally loose. Applications are transpiled, never type
 * checked, at run time (see helpers/appLoader), so the types exist to make the
 * editor useful rather than to police what a flow may do -- hence the index
 * signatures on the bags of data a flow carries around.
 */

/** A JSON-ish value, as it travels through flow parameters, bodies and memory. */
export type Json =
  | string
  | number
  | boolean
  | null
  | undefined
  | Json[]
  | { [key: string]: Json };

/** The environment of an application, i.e. its `env/<environment>.env` file. */
export interface Environment {
  [key: string]: string;
}

/**
 * What a method is told about the application it belongs to, rebuilt for every
 * step from the selected environment.
 */
export interface Context {
  /** Application name, i.e. its folder. */
  name: string;
  /** Absolute path of the application folder. */
  path: string;
  /** Parsed contents of the environment file the flow runs against. */
  env: Environment;
  /** Where a helper reports what it did, so the run log and the UI show it. */
  reporter?: Reporter;
  /** Id of the step being run, so what a helper reports is attached to it. */
  stepId?: string;
  /** Optional case, used to pick `<KEY>_<case>` overrides out of the env. */
  case?: string;
  /**
   * The browser session the step asked for, i.e. the `session` of the flow
   * step. `playwright.run` reads it: a method only has to hand it its
   * context for the step to browse in the session the flow named. `false`
   * asks for a throw-away browser even when the yaml file names a session.
   */
  session?: string | false;
  /** Whether this step is the last one that needs the browser session. */
  closeSession?: boolean;
  [key: string]: unknown;
}

/**
 * The `parameters` of a step, as written in the flow file. The named bags are
 * the conventional ones, but a flow may pass anything, and what is inside them
 * is whatever the flow author wrote -- hence `any` rather than a shape this
 * package cannot know.
 */
export interface Parameters {
  body?: any;
  query?: any;
  params?: any;
  path?: any;
  headers?: any;
  [key: string]: any;
}

/** One step of a flow, after the runner has given it an id. */
export interface Step {
  id: string;
  application?: string;
  method?: string;
  parameters?: Parameters;
  test?: Record<string, any>;
  retry?: { times: number; delay?: number };
  mimic?: Array<Record<string, any>>;
  /**
   * What this step keeps in the flow memory, as `key: "{{ template }}"`.
   * Resolved once the step has run, against its own response (`body`,
   * `status`, `headers`), the steps so far and the memory as it stands.
   */
  memory?: Record<string, any>;
  /** The browser session the step browses in, kept open between steps. */
  session?: string | false;
  /** Close that session once this step is done with it. */
  closeSession?: boolean;
  [key: string]: any;
}

/**
 * The flow being run. A method reads `memory` to reuse what earlier steps
 * produced, and writes to it through the fourth element of its result.
 */
export interface Flow {
  name?: string;
  steps: Step[];
  memory: Record<string, any>;
  reporter: Reporter;
  environment?: string;
  [key: string]: any;
}

/** Whatever is currently reporting the run: the CLI, the UI, or both. */
export interface Reporter {
  [key: string]: any;
}

/**
 * What a method returns: response headers, HTTP status, body, and the values
 * to merge into the flow memory. The helpers (`httpClient`, `pgClient`,
 * `playwright`) already return this shape.
 */
export type MethodResult =
  | [Record<string, any>, number, any, Record<string, any>?]
  | Promise<[Record<string, any>, number, any, Record<string, any>?]>;

/** One entry of the array passed to `applications.handler`. */
export type MethodStep = (ctx: Context, parameters: Parameters, flow: Flow) => any;

/** A method, as `applications.handler` returns it. */
export type Method = (ctx: Context | 'describe', parameters?: Parameters, flow?: Flow) => any;

/**
 * The configuration of a mimic'd application, i.e. one entry of a step's
 * `mimic` list, plus the flow it belongs to.
 */
export interface MimicConfig {
  application: string;
  url?: string;
  port?: number;
  conditions?: Record<string, any>;
  flow: Flow;
  [key: string]: any;
}
