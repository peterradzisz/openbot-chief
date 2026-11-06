// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the preview's part of the pause, Auto-approve and Reporting, as the host does them.
 * Upstream's `preview/mock-workflows.ts` builds it once and keeps one-line hooks: the summary fields, the
 * approval step that Auto-approve decides, and the methods spread into its workflows group.
 * See docs/FORK.md.
 */

import type {
  OpenBotDesktopApi,
  WorkflowDetail,
  WorkflowScheduling,
  WorkflowStep,
  WorkflowSummary,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";

type WorkflowsApi = OpenBotDesktopApi["workflows"];

export interface ForkMockWorkflowsDependencies {
  /** The preview's workflows by id. */
  records: ReadonlyMap<string, { detail: WorkflowDetail }>;
  emit: (workflowId: string) => void;
  stamp: () => string;
  /** The preview's end of a step. */
  end: (step: WorkflowStep, patch: Partial<WorkflowStep>) => void;
}

export function forkMockWorkflows({ records, emit, stamp, end }: ForkMockWorkflowsDependencies) {
  /** The pause of every workflow at once. A preview starts it clear. */
  const scheduling: WorkflowScheduling = { pausedAt: null, pausedReason: null, upgradeVersion: null };
  const summaryOf = (id: string) => {
    const found = records.get(id);
    if (!found) throw new Error(sourceText("error.workflow.missing"));
    return found.detail.summary;
  };

  const methods: Pick<WorkflowsApi, "setPaused" | "setAutoApprove" | "setAllPaused" | "scheduling" | "reporting"> = {
    setPaused: async (input) => {
      const summary = summaryOf(input.workflowId);
      summary.pausedAt = input.paused ? (summary.pausedAt ?? stamp()) : null;
      emit(input.workflowId);
      return structuredClone(summary);
    },
    // Auto-approve. An approval that already waits stays.
    setAutoApprove: async (input) => {
      const summary = summaryOf(input.workflowId);
      summary.autoApprove = input.enabled;
      emit(input.workflowId);
      return structuredClone(summary);
    },
    setAllPaused: async (paused) => {
      scheduling.pausedReason = paused ? (scheduling.pausedReason ?? "manual") : null;
      scheduling.upgradeVersion = scheduling.pausedReason === "upgrade" ? scheduling.upgradeVersion : null;
      scheduling.pausedAt = paused ? (scheduling.pausedAt ?? stamp()) : null;
      for (const id of records.keys()) emit(id);
      return { ...scheduling };
    },
    scheduling: async () => ({ ...scheduling }),
    reporting: async () => ({
      totalRuns: 0,
      successCount: 0,
      failedCount: 0,
      stoppedCount: 0,
      totalDurationMs: 0,
      totalUncachedInputTokens: 0,
      totalCachedInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      modelsUsed: [],
      runs: [],
    }),
  };

  return {
    methods,
    /** The fork's fields of a summary. A save keeps the pause and Auto-approve, as the host's does. */
    summaryFields: (id: string): Pick<WorkflowSummary, "pausedAt" | "autoApprove"> => ({
      pausedAt: records.get(id)?.detail.summary.pausedAt ?? null,
      autoApprove: records.get(id)?.detail.summary.autoApprove ?? false,
    }),
    /** Auto-approve decides an approval step at once, with a note, as the host does. Answers whether it did. */
    autoApproved(workflowId: string, step: WorkflowStep, input: string): boolean {
      if (!records.get(workflowId)?.detail.summary.autoApprove) return false;
      end(step, { status: "done", output: input, decisionNote: sourceText("error.workflow.autoApproved") });
      return true;
    },
  };
}
