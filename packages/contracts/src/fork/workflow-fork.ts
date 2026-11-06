// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the workflow contracts the fork adds to upstream's `ipc-workflows.ts` — the pause of one
 * workflow and of every workflow (`WorkflowScheduling`), per-workflow Auto-approve, the decision note
 * of a step, and Reporting with its run limit. `ipc-workflows.ts` re-exports this module and extends
 * `WorkflowSummary` and `WorkflowStep` with the field sets below, so callers keep importing from
 * `@openbot/contracts/ipc`. See docs/FORK.md.
 */

import { isFiniteNumber, isIdentifier } from "../ipc-bounded-values";
import type { WorkflowNodeKind, WorkflowRunSource, WorkflowRunStatus, WorkflowStepStatus } from "../ipc-workflows";
import { type DynamicRecord, isBoolean, isDynamicRecord, isOneOf, isString } from "../runtime-values";

/** The fork's fields of `WorkflowSummary`. */
export interface WorkflowForkSummaryFields {
  /**
   * When the user paused the workflow, or null. A paused workflow starts no run from a trigger; open
   * runs go on and a manual run still starts. The pause of every workflow is `WorkflowScheduling`.
   */
  pausedAt: string | null;
  /**
   * FORK: Auto-approve. Whether the workflow decides the approval steps its runs reach from now on, as
   * a person's Approve does, with a note on the step. A host from before it sends none: false.
   */
  autoApprove: boolean;
}

/** The fork's fields of `WorkflowStep`. */
export interface WorkflowForkStepFields {
  /** FORK: why the step was decided without a person, such as an Auto-approve. Absent for most steps. */
  decisionNote?: string | null;
}

/** FORK: Auto-approve. */
export interface SetWorkflowAutoApproveInput {
  workflowId: string;
  enabled: boolean;
}

/** FORK: how many finished runs the reporting reads, newest first. The All workflows page offers these. */
export const WORKFLOW_REPORT_RUN_LIMITS = [50, 100, 250, 500] as const;
export type WorkflowReportRunLimit = (typeof WORKFLOW_REPORT_RUN_LIMITS)[number];
export const WORKFLOW_REPORT_DEFAULT_RUNS: WorkflowReportRunLimit = 50;

export interface WorkflowReportingInput {
  limit: WorkflowReportRunLimit;
}

/** The pause of every workflow at once. A workflow is held when this or its own `pausedAt` is set. */
export interface WorkflowScheduling {
  pausedAt: string | null;
  /**
   * Why every workflow is paused: `upgrade` when the host held them at the first start of a new
   * version, `manual` when a user paused them, null when not paused. A host from before this field
   * sends none, which a client reads as null.
   */
  pausedReason: WorkflowPauseReason | null;
  /** The version the host was upgraded to, when `pausedReason` is `upgrade`; otherwise null. */
  upgradeVersion: string | null;
}

export const WORKFLOW_PAUSE_REASONS = ["upgrade", "manual"] as const;
export type WorkflowPauseReason = (typeof WORKFLOW_PAUSE_REASONS)[number];

export interface SetWorkflowPausedInput {
  workflowId: string;
  paused: boolean;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

/** The fork's part of `isWorkflowSummary`. */
export function isWorkflowForkSummaryFields(value: DynamicRecord): boolean {
  return isNullableString(value.pausedAt) && isBoolean(value.autoApprove);
}

/** The fork's part of `isWorkflowStep`. */
export function isWorkflowForkStepFields(value: DynamicRecord): boolean {
  return value.decisionNote === undefined || isNullableString(value.decisionNote);
}

export function isSetWorkflowAutoApproveInput(value: unknown): value is SetWorkflowAutoApproveInput {
  return isDynamicRecord(value) && isIdentifier(value.workflowId) && isBoolean(value.enabled);
}

export function isWorkflowReportingInput(value: unknown): value is WorkflowReportingInput {
  return isDynamicRecord(value) && isOneOf(WORKFLOW_REPORT_RUN_LIMITS, value.limit);
}

export function isWorkflowScheduling(value: unknown): value is WorkflowScheduling {
  return (
    isDynamicRecord(value) &&
    isNullableString(value.pausedAt) &&
    (value.pausedReason === null || isOneOf(WORKFLOW_PAUSE_REASONS, value.pausedReason)) &&
    isNullableString(value.upgradeVersion)
  );
}

export function isSetWorkflowPausedInput(value: unknown): value is SetWorkflowPausedInput {
  return isDynamicRecord(value) && isIdentifier(value.workflowId) && isBoolean(value.paused);
}

export interface WorkflowStepReport {
  stepId: string;
  nodeId: string;
  kind: WorkflowNodeKind;
  agentId: string | null;
  agentName: string | null;
  status: WorkflowStepStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  models: readonly string[];
  uncachedInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  error: string | null;
}

export interface WorkflowRunReport {
  runId: string;
  workflowId: string;
  workflowTitle: string;
  runNumber: number;
  source: WorkflowRunSource;
  status: WorkflowRunStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  models: readonly string[];
  uncachedInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  error: string | null;
  steps: readonly WorkflowStepReport[];
}

export interface WorkflowReportingSummary {
  totalRuns: number;
  successCount: number;
  failedCount: number;
  stoppedCount: number;
  totalDurationMs: number;
  totalUncachedInputTokens: number;
  totalCachedInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  modelsUsed: readonly { model: string; count: number; totalCostUsd: number }[];
  runs: readonly WorkflowRunReport[];
}

export function isWorkflowReportingSummary(value: unknown): value is WorkflowReportingSummary {
  return (
    isDynamicRecord(value) &&
    isFiniteNumber(value.totalRuns) &&
    isFiniteNumber(value.successCount) &&
    isFiniteNumber(value.failedCount) &&
    isFiniteNumber(value.stoppedCount) &&
    isFiniteNumber(value.totalDurationMs) &&
    isFiniteNumber(value.totalUncachedInputTokens) &&
    isFiniteNumber(value.totalCachedInputTokens) &&
    isFiniteNumber(value.totalOutputTokens) &&
    isFiniteNumber(value.totalCostUsd) &&
    Array.isArray(value.modelsUsed) &&
    Array.isArray(value.runs)
  );
}
