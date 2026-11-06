// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the IPC endpoints of the fork's workflow features (pause, Auto-approve, Reporting). The
 * `workflows` group of upstream's `IPC_ENDPOINTS` spreads them in with one line. See docs/FORK.md.
 */

import type { ScopedRequestEndpoint, ServerArgument } from "../ipc-endpoints";
import type { WorkflowSummary } from "../ipc-workflows";
import type {
  SetWorkflowAutoApproveInput,
  SetWorkflowPausedInput,
  WorkflowReportingInput,
  WorkflowReportingSummary,
  WorkflowScheduling,
} from "./workflow-fork";

// The same shapes as `scopedRequest` and `scopedQuery` in `ipc-endpoints.ts`, which it keeps private.
function scopedRequest<Inner, Result, Server extends ServerArgument = "optional">(): <Channel extends string>(
  channel: Channel,
) => ScopedRequestEndpoint<Channel, Inner, Result, Server> {
  return (channel) => ({ kind: "request", channel, scope: "payload" });
}

function scopedQuery<Result, Server extends ServerArgument = "optional">(): <Channel extends string>(
  channel: Channel,
) => ScopedRequestEndpoint<Channel, null, Result, Server> {
  return (channel) => ({ kind: "request", channel, scope: "empty" });
}

export const FORK_WORKFLOW_ENDPOINTS = {
  /** Pauses or resumes one workflow. It never stops an open run; a manual run still starts. */
  setPaused: scopedRequest<SetWorkflowPausedInput, WorkflowSummary>()("workflows:set-paused"),
  /** Pauses or resumes every workflow at once. Each workflow's own pause stays as it is. */
  setAllPaused: scopedRequest<boolean, WorkflowScheduling>()("workflows:set-all-paused"),
  scheduling: scopedQuery<WorkflowScheduling>()("workflows:scheduling"),
  /** Auto-approve. Only approvals that runs reach later; one that already waits stays. */
  setAutoApprove: scopedRequest<SetWorkflowAutoApproveInput, WorkflowSummary>()("workflows:set-auto-approve"),
  /** Reporting over the newest finished runs, up to the run limit. */
  reporting: scopedRequest<WorkflowReportingInput, WorkflowReportingSummary>()("workflows:reporting"),
} as const;
