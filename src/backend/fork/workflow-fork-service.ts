// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the workflow service's part of the pause, Auto-approve and Reporting. Upstream's
 * `workflows/workflows.ts` keeps one-line hooks: `WorkflowsShape` extends `ForkWorkflowsShape`, the
 * service builds `forkWorkflows(...)` once, spreads its `methods` into the service, asks `held` where a
 * trigger would start a run, and asks `autoApproved` where a run reaches an approval step.
 * See docs/FORK.md.
 */

import type {
  SetWorkflowAutoApproveInput,
  SetWorkflowPausedInput,
  WorkflowReportingInput,
  WorkflowReportingSummary,
  WorkflowScheduling,
  WorkflowSummary,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, type Semaphore } from "effect";
import type { StoredWorkflowStep, WorkflowRunStore, WorkflowStepEnd } from "../workflows/workflow-run-store";
import type { WorkflowStore } from "../workflows/workflow-store";

/** The service methods the fork adds. `E` is the service's failure. */
export interface ForkWorkflowsShape<E> {
  /**
   * Pauses or resumes one workflow. A paused workflow starts no run from a trigger and skips its due
   * schedule occurrences; its open runs go on and a manual run still starts.
   */
  setPaused(input: SetWorkflowPausedInput): Effect.Effect<WorkflowSummary, E>;
  /** Pauses or resumes every workflow at once. Each workflow's own pause stays as it is. */
  setAllPaused(paused: boolean): Effect.Effect<WorkflowScheduling, E>;
  /** Whether every workflow is paused at once. */
  scheduling(): Effect.Effect<WorkflowScheduling, E>;
  /** Auto-approve. Only approvals that runs reach later; one that already waits stays. */
  setAutoApprove(input: SetWorkflowAutoApproveInput): Effect.Effect<WorkflowSummary, E>;
  reporting(input?: WorkflowReportingInput): Effect.Effect<WorkflowReportingSummary, E>;
}

export interface ForkWorkflowsDependencies<E> {
  store: WorkflowStore;
  runs: WorkflowRunStore;
  /** The service's end of a step; it tells the canvas when the step ended. */
  settle: (step: StoredWorkflowStep, end: WorkflowStepEnd) => boolean;
  /** The service's `attempt`: a store call as an Effect that fails with the service's failure. */
  attempt: <A>(work: () => A) => Effect.Effect<A, E>;
  /** The service's lock of user actions and passes (`locked` takes the same permit). */
  lock: Semaphore.Semaphore;
  changed: (workflowId: string) => void;
  rearm: () => void;
  now: () => Date;
}

export function forkWorkflows<E>({
  store,
  runs,
  settle,
  attempt,
  lock,
  changed,
  rearm,
  now,
}: ForkWorkflowsDependencies<E>) {
  /** A user action, under the same lock as a pass (as the service's `locked`). */
  const locked = <A>(work: Effect.Effect<A, E>) => lock.withPermit(work);

  // Under the lock, so a trigger that reads the pause is done before it changes. An open run is not touched.
  const setPaused = Effect.fn("Workflows.setPaused")(function* (input: SetWorkflowPausedInput) {
    const summary = yield* locked(attempt(() => store.fork.setPaused(input.workflowId, input.paused, now())));
    changed(summary.id);
    rearm();
    return summary;
  });

  const setAllPaused = Effect.fn("Workflows.setAllPaused")(function* (paused: boolean) {
    const state = yield* locked(attempt(() => store.fork.setAllPaused(paused, now())));
    // Every workflow reads as paused or not now, so each list and canvas reads it again.
    for (const summary of yield* attempt(() => store.list())) changed(summary.id);
    rearm();
    return state;
  });

  const scheduling = Effect.fn("Workflows.scheduling")(function* () {
    return yield* attempt(() => store.fork.scheduling());
  });

  // Auto-approve. Under the lock, so a run that reaches an approval reads it before or after.
  const setAutoApprove = Effect.fn("Workflows.setAutoApprove")(function* (input: SetWorkflowAutoApproveInput) {
    const summary = yield* locked(attempt(() => store.fork.setAutoApprove(input.workflowId, input.enabled)));
    changed(summary.id);
    return summary;
  });

  const reporting = Effect.fn("Workflows.reporting")(function* (input?: WorkflowReportingInput) {
    return yield* attempt(() => runs.fork.reportingSummary(input?.limit));
  });

  const methods: ForkWorkflowsShape<E> = { setPaused, setAllPaused, scheduling, setAutoApprove, reporting };

  return {
    methods,
    /** Whether a trigger may not start a run of the workflow now. Call it under the lock. */
    held: (workflowId: string) => attempt(() => store.fork.held(workflowId)),
    /**
     * Auto-approve: when the workflow of an approval step that a run just reached decides its approvals,
     * decides it as a person's Approve does, with a note, and answers true. The caller moves the run on.
     */
    autoApproved(step: StoredWorkflowStep): boolean {
      if (!store.fork.autoApprove(step.workflowId)) return false;
      runs.fork.setDecisionNote(step.id, sourceText("error.workflow.autoApproved"));
      settle(step, { status: "done", output: step.input });
      return true;
    },
  };
}
