// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: per-workflow Auto-approve.
 *
 * An approval step makes a run wait for a person, so an unattended night run stalls at it. A workflow
 * with Auto-approve on decides each approval step its runs REACH from then on, through the same
 * decision a person's Approve makes, and the step keeps a note that says so: the decision is visible,
 * never silent. Turning it on leaves approvals that already wait; turning it off stops it. It is apart
 * from the pause: a paused workflow's open run still auto-approves.
 *
 * The columns live in the fork schema layer (`fork-schema.ts`): `workflows.auto_approve` and
 * `workflow_steps.decision_note`.
 */

import type { DatabaseSync } from "node:sqlite";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

/** Whether the workflow decides its own approval steps. A missing workflow reads as off. */
export function readWorkflowAutoApprove(db: DatabaseSync, workflowId: string): boolean {
  const row = db.prepare("SELECT auto_approve FROM workflows WHERE workflow_id = ?").get(workflowId);
  return isDynamicRecord(row) && Number(row.auto_approve) === 1;
}

/**
 * Turns Auto-approve on or off. Answers whether the workflow exists. The graph, its revision and its
 * order stay as they are, and an approval that already waits is not touched.
 */
export function writeWorkflowAutoApprove(db: DatabaseSync, workflowId: string, enabled: boolean): boolean {
  // SQLite counts every row the WHERE matches, so setting the value it has still finds the workflow.
  const result = db
    .prepare("UPDATE workflows SET auto_approve = ? WHERE workflow_id = ?")
    .run(enabled ? 1 : 0, workflowId);
  return Number(result.changes) > 0;
}

/** Keeps why a step was decided without a person, shown with the step. */
export function writeStepDecisionNote(db: DatabaseSync, stepId: string, note: string): void {
  db.prepare("UPDATE workflow_steps SET decision_note = ? WHERE step_id = ?").run(note, stepId);
}
