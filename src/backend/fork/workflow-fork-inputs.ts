// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the checked inputs of the fork's workflow requests, for IPC and the Team API. Kept here so
 * upstream's `workflow-inputs.ts` stays as it ships.
 */

import {
  isSetWorkflowAutoApproveInput,
  isSetWorkflowPausedInput,
  isWorkflowReportingInput,
  type SetWorkflowAutoApproveInput,
  type SetWorkflowPausedInput,
  WORKFLOW_REPORT_DEFAULT_RUNS,
  type WorkflowReportingInput,
} from "@openbot/contracts/ipc";

export function parseSetWorkflowPaused(value: unknown): SetWorkflowPausedInput {
  if (!isSetWorkflowPausedInput(value)) throw new Error("Invalid workflow pause.");
  return { workflowId: value.workflowId, paused: value.paused };
}

export function parseWorkflowsPaused(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid workflow pause.");
  return value;
}

export function parseSetWorkflowAutoApprove(value: unknown): SetWorkflowAutoApproveInput {
  if (!isSetWorkflowAutoApproveInput(value)) throw new Error("Invalid workflow auto-approve.");
  return { workflowId: value.workflowId, enabled: value.enabled };
}

/** The run limit of Reporting. A renderer from before the limit sends nothing: the default. */
export function parseWorkflowReporting(value: unknown): WorkflowReportingInput {
  if (value === null || value === undefined) return { limit: WORKFLOW_REPORT_DEFAULT_RUNS };
  if (!isWorkflowReportingInput(value)) throw new Error("Invalid workflow reporting limit.");
  return { limit: value.limit };
}
