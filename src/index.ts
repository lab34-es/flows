/**
 * Public entry point for `require('@lab34/flows')`.
 *
 * Re-exports the helpers that make up the programmable surface of the tool,
 * plus express itself so consumers can mount the mimic servers without taking
 * their own dependency on a possibly-different express version.
 */
import express from 'express';

import * as applications from './helpers/applications';
import * as errors from './helpers/errors';
import * as flows from './helpers/flows';
import * as httpClient from './helpers/httpClient';
import * as httpServer from './helpers/httpServer';
import * as inputs from './helpers/inputs';
import * as mimicFiles from './helpers/mimicFiles';
import * as mqttClient from './helpers/mqttClient';
import * as pgClient from './helpers/pgClient';
import * as playwright from './helpers/playwright';
import * as replacer from './helpers/replacer';
import * as validate from './helpers/validate';

/**
 * The types an application is written against. They are types only: nothing
 * of this is emitted, so importing them costs an application nothing at run
 * time.
 */
export type { DescribedError } from './helpers/errors';
export type { InputRequest, TextOptions } from './helpers/inputs';
export type { PublishOptions } from './helpers/mqttClient';

export type {
  Context,
  Environment,
  Flow,
  Json,
  Method,
  MethodResult,
  MethodStep,
  MimicConfig,
  Parameters,
  Reporter,
  Step
} from './types/application';

export {
  applications,
  errors,
  express,
  flows,
  httpClient,
  httpServer,
  inputs,
  mimicFiles,
  mqttClient,
  pgClient,
  playwright,
  replacer,
  validate
};
