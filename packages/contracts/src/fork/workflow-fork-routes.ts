// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the `workflows-v1` routes and wire codecs of the fork's workflow features. Upstream's
 * `team-protocol/workflows-v1.ts` spreads the routes and codecs in, and builds its summary and step
 * codecs through `forkSummaryFields` and `forkStepFields`, one line each. See docs/FORK.md.
 *
 * A host without these routes answers them as unknown, and its summaries carry no `pausedAt` or
 * `autoApprove`, which a client reads as not paused and off.
 */

import { isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  nullable,
  type OptionalRouteCodec,
  string,
} from "../team-protocol/admin-wire";

export const FORK_WORKFLOWS_ROUTES = {
  // Pausing workflows.
  setPaused: "/v1/workflows/set-paused",
  setAllPaused: "/v1/workflows/set-all-paused",
  scheduling: "/v1/workflows/scheduling",
  // Auto-approve.
  setAutoApprove: "/v1/workflows/set-auto-approve",
} as const;

type Fields = Parameters<typeof fields>[0];

// The same decoders as `timestamp` and `token` in `workflows-v1.ts`, which it keeps private.
const timestamp = string(64);
const token: AdminDecoder = (value) => {
  if (!isString(value) || !/^[a-z][a-z0-9-]{0,31}$/u.test(value)) throw new Error("Invalid workflow value.");
  return value;
};

/** The summary codec: upstream's fields, and the pause and Auto-approve as optional fields. */
export function forkSummaryFields(required: Fields): AdminDecoder {
  return fields(required, { pausedAt: nullable(timestamp), autoApprove: boolean });
}

/** The step codec: upstream's fields, and the decision note of Auto-approve as an optional field. */
export function forkStepFields(required: Fields): AdminDecoder {
  return fields(required, { decisionNote: nullable(string(500)) });
}

// A host from before the upgrade pause sends no reason and no version; the client reads both as null.
const scheduling = fields(
  { pausedAt: nullable(timestamp) },
  { pausedReason: nullable(token), upgradeVersion: nullable(string(64)) },
);

/** The codecs of the fork's routes. `summary` is the workflows-v1 summary codec. */
export function forkWorkflowsCodecs(summary: AdminDecoder): [string, OptionalRouteCodec][] {
  return [
    [FORK_WORKFLOWS_ROUTES.setPaused, adminRoute(fields({ workflowId: identifier, paused: boolean }), summary)],
    [FORK_WORKFLOWS_ROUTES.setAllPaused, adminRoute(fields({ paused: boolean }), scheduling)],
    [FORK_WORKFLOWS_ROUTES.scheduling, adminRoute(empty, scheduling)],
    [FORK_WORKFLOWS_ROUTES.setAutoApprove, adminRoute(fields({ workflowId: identifier, enabled: boolean }), summary)],
  ];
}
