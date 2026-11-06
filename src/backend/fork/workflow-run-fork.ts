// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the run store's part of Auto-approve (the decision note of a step) and of Reporting (the
 * finished runs, their steps, models, tokens and costs). `WorkflowRunStore` keeps one hook,
 * `readonly fork = workflowRunFork(...)`. See docs/FORK.md.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  WORKFLOW_REPORT_RUN_LIMITS,
  type WorkflowReportingSummary,
  type WorkflowRunReport,
  type WorkflowStepReport,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { databaseRows, optionalNumberColumn, optionalStringColumn } from "../database/database-rows";
import type { StoredWorkflowRun, StoredWorkflowStep } from "../workflows/workflow-run-store";
import { writeStepDecisionNote } from "./workflow-auto-approve";

/** The most finished runs Reporting reads (the largest choice of the All workflows page), and keeps. */
export const REPORT_MAX_RUNS = Math.max(...WORKFLOW_REPORT_RUN_LIMITS);
/** Finished runs older than this many days are pruned before Reporting reads. */
export const REPORT_MAX_DAYS = 30;
/** The run limit Reporting reads when the caller names none. */
const REPORT_DEFAULT_LIMIT = 50;

/**
 * `connection` is the run store's database, `steps` its steps of a run, and `runSelect` with `toRun`
 * its own SELECT of runs and row reader, so a report reads runs exactly as the store does.
 */
export function workflowRunFork(
  connection: () => DatabaseSync,
  steps: (runId: string) => StoredWorkflowStep[],
  runSelect: string,
  toRun: (row: DynamicRecord) => StoredWorkflowRun,
) {
  const pruneRuns = (maxCompletedToKeep = REPORT_MAX_RUNS, maxDays = REPORT_MAX_DAYS): void => {
    const db = connection();
    const cutoffDate = new Date(Date.now() - maxDays * 86_400_000).toISOString();
    try {
      db.prepare(
        `DELETE FROM workflow_runs
         WHERE status IN ('done', 'failed', 'stopped')
           AND (
             started_at < ?
             OR run_id NOT IN (
               SELECT run_id FROM workflow_runs
               WHERE status IN ('done', 'failed', 'stopped')
               ORDER BY started_at DESC
               LIMIT ?
             )
           )`,
      ).run(cutoffDate, maxCompletedToKeep);
    } catch {
      // ignore
    }
  };

  return {
    /** Auto-approve: why a step was decided without a person. */
    setDecisionNote(stepId: string, note: string): void {
      writeStepDecisionNote(connection(), stepId, note);
    },

    pruneRuns,

    reportingSummary(limit = REPORT_DEFAULT_LIMIT): WorkflowReportingSummary {
      pruneRuns();
      const db = connection();

      const agentNameMap = new Map<string, string>();
      try {
        const agentRows = databaseRows(db.prepare("SELECT agent_id, agent_json FROM projection_agents").all());
        for (const row of agentRows) {
          const id = optionalStringColumn(row, "agent_id");
          const json = optionalStringColumn(row, "agent_json");
          if (id && json) {
            try {
              const parsed = JSON.parse(json);
              if (typeof parsed.name === "string") agentNameMap.set(id, parsed.name);
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }

      const workflowTitleMap = new Map<string, string>();
      try {
        const wfRows = databaseRows(db.prepare("SELECT workflow_id, title FROM workflows").all());
        for (const row of wfRows) {
          const id = optionalStringColumn(row, "workflow_id");
          const title = optionalStringColumn(row, "title");
          if (id && title) workflowTitleMap.set(id, title);
        }
      } catch {
        // ignore
      }

      const runRows = databaseRows(
        db
          .prepare(
            `${runSelect} WHERE status IN ('done', 'failed', 'stopped')
           ORDER BY started_at DESC, run_id DESC LIMIT ?`,
          )
          .all(Math.min(limit, REPORT_MAX_RUNS)),
      ).map(toRun);

      const modelUsageMap = new Map<string, { count: number; totalCostUsd: number }>();
      let totalRuns = 0;
      let successCount = 0;
      let failedCount = 0;
      let stoppedCount = 0;
      let totalDurationMs = 0;
      let totalUncachedInputTokens = 0;
      let totalCachedInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;

      const runsReport: WorkflowRunReport[] = [];

      for (const r of runRows) {
        totalRuns++;
        if (r.status === "done") successCount++;
        else if (r.status === "failed") failedCount++;
        else if (r.status === "stopped") stoppedCount++;

        const startMs = Date.parse(r.startedAt);
        const endMs = r.endedAt ? Date.parse(r.endedAt) : null;
        const runDurationMs =
          endMs !== null && !Number.isNaN(endMs) && !Number.isNaN(startMs) ? Math.max(0, endMs - startMs) : null;
        if (runDurationMs !== null) totalDurationMs += runDurationMs;

        const runSteps = steps(r.id);
        const stepsReport: WorkflowStepReport[] = [];
        const runModelsSet = new Set<string>();
        let runUncachedIn = 0;
        let runCachedIn = 0;
        let runOutput = 0;
        let runCost = 0;

        for (const s of runSteps) {
          const sStartMs = s.startedAt ? Date.parse(s.startedAt) : null;
          const sEndMs = s.endedAt ? Date.parse(s.endedAt) : null;
          const stepDurationMs =
            sStartMs !== null && sEndMs !== null && !Number.isNaN(sStartMs) && !Number.isNaN(sEndMs)
              ? Math.max(0, sEndMs - sStartMs)
              : null;

          const stepModelsSet = new Set<string>();
          let stepUncached = 0;
          let stepCached = 0;
          let stepOut = 0;
          let stepCost = 0;

          if (s.turnId) {
            try {
              const usageRows = databaseRows(
                db
                  .prepare("SELECT model, tokens_json, estimated_cost_usd FROM agent_usage_records WHERE turn_id = ?")
                  .all(s.turnId),
              );
              for (const u of usageRows) {
                const rawModel = optionalStringColumn(u, "model");
                if (rawModel) {
                  const cleanModel = rawModel.includes("/") ? (rawModel.split("/").pop() ?? rawModel) : rawModel;
                  stepModelsSet.add(cleanModel);
                  runModelsSet.add(cleanModel);
                }
                const tokensJson = optionalStringColumn(u, "tokens_json");
                if (tokensJson) {
                  try {
                    const t = JSON.parse(tokensJson);
                    if (typeof t.uncachedInput === "number") stepUncached += t.uncachedInput;
                    if (typeof t.cachedInput === "number") stepCached += t.cachedInput;
                    if (typeof t.output === "number") stepOut += t.output;
                  } catch {
                    // ignore
                  }
                }
                const cost = optionalNumberColumn(u, "estimated_cost_usd");
                if (typeof cost === "number" && !Number.isNaN(cost)) {
                  stepCost += cost;
                }
              }
            } catch {
              // ignore
            }
          }

          runUncachedIn += stepUncached;
          runCachedIn += stepCached;
          runOutput += stepOut;
          runCost += stepCost;

          stepsReport.push({
            stepId: s.id,
            nodeId: s.nodeId,
            kind: s.kind,
            agentId: s.agentId,
            agentName: s.agentId ? (agentNameMap.get(s.agentId) ?? null) : null,
            status: s.status,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            durationMs: stepDurationMs,
            models: [...stepModelsSet],
            uncachedInputTokens: stepUncached,
            cachedInputTokens: stepCached,
            outputTokens: stepOut,
            estimatedCostUsd: Number(stepCost.toFixed(6)),
            error: s.error,
          });
        }

        totalUncachedInputTokens += runUncachedIn;
        totalCachedInputTokens += runCachedIn;
        totalOutputTokens += runOutput;
        totalCostUsd += runCost;

        for (const m of runModelsSet) {
          const existing = modelUsageMap.get(m) ?? { count: 0, totalCostUsd: 0 };
          modelUsageMap.set(m, {
            count: existing.count + 1,
            totalCostUsd: existing.totalCostUsd + runCost,
          });
        }

        runsReport.push({
          runId: r.id,
          workflowId: r.workflowId,
          workflowTitle: workflowTitleMap.get(r.workflowId) ?? r.workflowId,
          runNumber: r.number,
          source: r.source,
          status: r.status,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          durationMs: runDurationMs,
          models: [...runModelsSet],
          uncachedInputTokens: runUncachedIn,
          cachedInputTokens: runCachedIn,
          outputTokens: runOutput,
          estimatedCostUsd: Number(runCost.toFixed(6)),
          error: r.error,
          steps: stepsReport,
        });
      }

      const modelsUsed = [...modelUsageMap.entries()]
        .map(([model, data]) => ({
          model,
          count: data.count,
          totalCostUsd: Number(data.totalCostUsd.toFixed(6)),
        }))
        .sort((a, b) => b.count - a.count);

      return {
        totalRuns,
        successCount,
        failedCount,
        stoppedCount,
        totalDurationMs,
        totalUncachedInputTokens,
        totalCachedInputTokens,
        totalOutputTokens,
        totalCostUsd: Number(totalCostUsd.toFixed(6)),
        modelsUsed,
        runs: runsReport,
      };
    },
  };
}

export type WorkflowRunFork = ReturnType<typeof workflowRunFork>;
