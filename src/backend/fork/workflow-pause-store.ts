// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the workflow store's part of the pause and of Auto-approve. `WorkflowStore` keeps one
 * hook, `readonly fork = workflowForkStore(...)`, and reads the summary columns below; the rows live in
 * the fork schema layer (`fork-schema.ts`: `workflows.paused_at`, `workflows.auto_approve` and the
 * `fork_state` row of the pause of every workflow). See docs/FORK.md.
 */

import type { DatabaseSync } from "node:sqlite";
import type { WorkflowScheduling, WorkflowSummary } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { databaseRow, optionalStringColumn } from "../database/database-rows";
import { readWorkflowScheduling, writeWorkflowScheduling } from "./fork-schema";
import { readWorkflowAutoApprove, writeWorkflowAutoApprove } from "./workflow-auto-approve";

/** The summary columns the fork adds to `SUMMARY_SELECT` (the workflows table is `w`). */
export const FORK_SUMMARY_COLUMNS = "w.paused_at, w.auto_approve";

/** The fork's fields of a summary row, read from `FORK_SUMMARY_COLUMNS`. */
export function forkSummaryFields(row: DynamicRecord): Pick<WorkflowSummary, "pausedAt" | "autoApprove"> {
  return {
    pausedAt: optionalStringColumn(row, "paused_at"),
    autoApprove: Number(row.auto_approve) === 1, // Auto-approve
  };
}

/**
 * The pause and Auto-approve of the workflows in one database. `requireSummary` is the store's summary
 * of a workflow, which throws the store's "missing" error when there is none.
 */
export function workflowForkStore(
  connection: () => DatabaseSync,
  requireSummary: (workflowId: string) => WorkflowSummary,
) {
  const scheduling = (): WorkflowScheduling => readWorkflowScheduling(connection());
  /** When the workflow was paused by itself, or null. A missing workflow reads as not paused. */
  const pausedAt = (workflowId: string): string | null => {
    const row = databaseRow(
      connection().prepare("SELECT paused_at FROM workflows WHERE workflow_id = ?").get(workflowId),
    );
    return row ? optionalStringColumn(row, "paused_at") : null;
  };
  return {
    /**
     * Pauses or resumes one workflow. A paused workflow starts no run from a trigger; its open runs go
     * on. It keeps the time it was first paused, and the graph, its revision and its order stay as they are.
     */
    setPaused(workflowId: string, paused: boolean, now = new Date()): WorkflowSummary {
      // SQLite counts every row the WHERE matches, so pausing a paused workflow still finds it.
      connection()
        .prepare("UPDATE workflows SET paused_at = CASE WHEN ? THEN COALESCE(paused_at, ?) END WHERE workflow_id = ?")
        .run(paused ? 1 : 0, now.toISOString(), workflowId);
      // No row changed: the workflow is missing, and the summary throws as the store does.
      return requireSummary(workflowId);
    },

    pausedAt,

    /**
     * Whether the workflow is paused, by itself or by the pause of every workflow: then no trigger starts
     * a run of it. A manual run still starts, and open runs go on.
     */
    held(workflowId: string): boolean {
      return scheduling().pausedAt !== null || pausedAt(workflowId) !== null;
    },

    /**
     * The pause of every workflow at once, with why (`manual`, or `upgrade` from the fork schema layer at
     * the first start of a new version). It is separate from each workflow's own pause.
     */
    scheduling,

    /** Pauses (reason `manual`) or resumes every workflow at once. Each workflow's own pause stays as it is. */
    setAllPaused(paused: boolean, now = new Date()): WorkflowScheduling {
      return writeWorkflowScheduling(connection(), paused, now);
    },

    /** Auto-approve (`workflow-auto-approve.ts`). */
    autoApprove(workflowId: string): boolean {
      return readWorkflowAutoApprove(connection(), workflowId);
    },

    setAutoApprove(workflowId: string, enabled: boolean): WorkflowSummary {
      writeWorkflowAutoApprove(connection(), workflowId, enabled);
      // A missing workflow changed no row, and the summary throws as the store does.
      return requireSummary(workflowId);
    },
  };
}

export type WorkflowForkStore = ReturnType<typeof workflowForkStore>;

// The log line of `workflow-triggers.ts`, under its logger name.
const triggersLogger = createOpenBotLogger("workflow-triggers");

/**
 * Whether a due schedule occurrence starts no run because the workflow is paused, by itself or by the
 * pause of every workflow. The trigger already moved on, so a resume replays nothing.
 */
export function pausedSkipsOccurrence(
  held: (workflowId: string) => boolean,
  trigger: { workflowId: string; nodeId: string },
  scheduledFor: string,
): boolean {
  if (!held(trigger.workflowId)) return false;
  triggersLogger.info("A paused workflow skipped a schedule occurrence.", {
    workflowId: trigger.workflowId,
    nodeId: trigger.nodeId,
    scheduledFor,
  });
  return true;
}
