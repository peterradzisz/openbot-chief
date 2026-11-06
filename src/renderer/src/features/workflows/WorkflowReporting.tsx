// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Workflow reporting component: measures finished and stopped/halted runs,
 * deduplicating, recording duration, tokens (in/out), models used, and cost.
 * Bounded retention guarantees the database footprint stays minimal.
 */

import {
  WORKFLOW_REPORT_DEFAULT_RUNS,
  type WorkflowReportingSummary,
  type WorkflowReportRunLimit,
  type WorkflowRunReport,
} from "@openbot/contracts/ipc";
import { Button, Input } from "@openbot/ui";
import { createCollapsedGroups } from "@openbot/ui/features/workflows/WorkflowOverview";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { WorkflowHost } from "./workflows-port";
import "./workflow-reporting.css";

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin}m`;
}

function formatTokens(count: number): string {
  if (count < 1000) return `${count}`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

/** Rows the run list renders at first, and adds per "Show more": 500 runs read stay cheap to show. */
const RENDER_STEP = 100;
/**
 * A run sends several change events in a row, and a busy host sends them all day. The reporting reads at most once per
 * window, and the window grows with the run limit: a 500-run read cost the host 2.7 s and 1.1 MB (measured 2026-11-06),
 * so re-reading it after every event froze the app. 50 runs = 3 s, 100 = 6 s, 250 = 15 s, 500 = 30 s ("Refresh" reads now).
 */
const CHANGE_DELAY_MS = 1000;
const changeDelay = (limit: number) => Math.max(CHANGE_DELAY_MS, limit * 60);

/** `limit`: how many finished runs it reads, newest first (the page setting). */
export function WorkflowReporting(props: { host: WorkflowHost; limit?: WorkflowReportRunLimit }) {
  const { t, format } = useText();
  const collapsed = createCollapsedGroups();
  const [data, setData] = createSignal<WorkflowReportingSummary | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [expandedRuns, setExpandedRuns] = createSignal<Set<string>>(new Set());
  const [rendered, setRendered] = createSignal(RENDER_STEP);
  // Name filter (owner 2026-11-06): any part of the workflow name, status or source, case-insensitive; only narrows the run list.
  const [filter, setFilter] = createSignal("");
  const filteredRuns = createMemo(() => {
    const runs = data()?.runs ?? [];
    const query = filter().trim().toLowerCase();
    if (query === "") return runs;
    return runs.filter((run) => `${run.workflowTitle} ${run.status} ${run.source}`.toLowerCase().includes(query));
  });

  const load = async () => {
    try {
      setLoading(true);
      const res = await props.host.workflows.reporting({ limit: props.limit ?? WORKFLOW_REPORT_DEFAULT_RUNS });
      setData(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  onSettled(() => {
    void load();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = props.host.onChanged(() => {
      if (pending !== undefined || document.hidden) return; // throttle, not debounce: events that keep coming must not starve the read
      pending = setTimeout(
        () => {
          pending = undefined;
          if (!loading()) void load();
        },
        changeDelay(props.limit ?? WORKFLOW_REPORT_DEFAULT_RUNS),
      );
    });
    return () => {
      clearTimeout(pending);
      unsubscribe();
    };
  });

  const toggleRun = (runId: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const isExpanded = (runId: string) => expandedRuns().has(runId);

  const successRate = createMemo(() => {
    const summary = data();
    if (!summary || summary.totalRuns === 0) return 0;
    return Math.round((summary.successCount / summary.totalRuns) * 100);
  });

  const avgDuration = createMemo(() => {
    const summary = data();
    if (!summary || summary.totalRuns === 0) return 0;
    return Math.round(summary.totalDurationMs / summary.totalRuns);
  });

  const when = (iso: string) =>
    format.date(new Date(iso), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <section class="wfo-group wfor-section" aria-label={t("fork.workflow.overview.reporting.title")}>
      <div class="wfor-header-row">
        <h2 class="wfo-group-title">
          <Button
            variant="ghost"
            size="sm"
            class="wfo-fold"
            aria-expanded={collapsed.isCollapsed("reporting") ? "false" : "true"}
            onClick={() => collapsed.toggle("reporting")}
          >
            <span
              class="wfo-caret"
              aria-hidden="true"
              data-open={collapsed.isCollapsed("reporting") ? undefined : ""}
            />
            {t("fork.workflow.overview.reporting.title")} ·{" "}
            {t("fork.workflow.overview.reporting.summary", { count: data()?.totalRuns ?? 0 })}
          </Button>
        </h2>
        <Button variant="ghost" size="sm" loading={loading()} disabled={loading()} onClick={() => void load()}>
          {t("fork.workflow.overview.reporting.refresh")}
        </Button>
      </div>

      <Show when={!collapsed.isCollapsed("reporting") && data()}>
        {(summary) => (
          <div>
            <div class="wfor-metrics-grid">
              <div class="wfor-metric-card">
                <span class="wfor-metric-label">{t("fork.workflow.overview.reporting.totalRuns")}</span>
                <span class="wfor-metric-value">{summary().totalRuns}</span>
                <span class="wfor-metric-sub">
                  {t("fork.workflow.overview.reporting.runsBreakdown", {
                    done: summary().successCount,
                    failed: summary().failedCount,
                    stopped: summary().stoppedCount,
                  })}
                </span>
              </div>
              <div class="wfor-metric-card">
                <span class="wfor-metric-label">{t("fork.workflow.overview.reporting.successRate")}</span>
                <span class="wfor-metric-value">{successRate()}%</span>
                <span class="wfor-metric-sub">
                  {t("fork.workflow.overview.reporting.avgDuration", { duration: formatDuration(avgDuration()) })}
                </span>
              </div>
              <div class="wfor-metric-card">
                <span class="wfor-metric-label">{t("fork.workflow.overview.reporting.inputTokens")}</span>
                <span class="wfor-metric-value">
                  {formatTokens(summary().totalUncachedInputTokens + summary().totalCachedInputTokens)}
                </span>
                <span class="wfor-metric-sub">
                  {t("fork.workflow.overview.reporting.inputTokensSub", {
                    uncached: formatTokens(summary().totalUncachedInputTokens),
                    cached: formatTokens(summary().totalCachedInputTokens),
                  })}
                </span>
              </div>
              <div class="wfor-metric-card">
                <span class="wfor-metric-label">{t("fork.workflow.overview.reporting.outputTokens")}</span>
                <span class="wfor-metric-value">{formatTokens(summary().totalOutputTokens)}</span>
                <span class="wfor-metric-sub">{t("fork.workflow.overview.reporting.outputTokensSub")}</span>
              </div>
              <div class="wfor-metric-card">
                <span class="wfor-metric-label">{t("fork.workflow.overview.reporting.cost")}</span>
                <span class="wfor-metric-value">{formatCost(summary().totalCostUsd)}</span>
                <span class="wfor-metric-sub">{t("fork.workflow.overview.reporting.costSub")}</span>
              </div>
            </div>

            <Show when={summary().modelsUsed.length > 0}>
              <div class="wfor-models-bar">
                <span class="wfor-models-label">{t("fork.workflow.overview.reporting.modelsUsed")}</span>
                <For each={summary().modelsUsed}>
                  {(m) => (
                    <span
                      class="wfor-model-chip"
                      title={t("fork.workflow.overview.reporting.modelsTooltip", {
                        count: m.count,
                        cost: formatCost(m.totalCostUsd),
                      })}
                    >
                      {m.model}
                      <span class="wfor-model-chip-count">({m.count})</span>
                    </span>
                  )}
                </For>
              </div>
            </Show>

            <Show when={summary().runs.length > 0}>
              <Input
                class="wfor-filter"
                type="search"
                placeholder={t("fork.workflow.overview.reporting.filterPlaceholder")}
                aria-label={t("fork.workflow.overview.reporting.filterPlaceholder")}
                autocomplete="off"
                spellcheck={false}
                value={filter()}
                onValueChange={(value) => {
                  setFilter(value);
                  setRendered(RENDER_STEP);
                }}
              />
            </Show>
            <Show
              when={summary().runs.length > 0}
              fallback={<div class="wfor-empty">{t("fork.workflow.overview.reporting.empty")}</div>}
            >
              <Show when={filteredRuns().length === 0}>
                <div class="wfor-empty">{t("fork.workflow.overview.reporting.filterEmpty")}</div>
              </Show>
              <div class="wfor-runs-list">
                <For each={filteredRuns().slice(0, rendered())}>
                  {(run: WorkflowRunReport) => (
                    <div class="wfor-run-item">
                      <Button variant="ghost" class="wfor-run-summary" onClick={() => toggleRun(run.runId)}>
                        <span class="wfor-badge" data-status={run.status}>
                          {run.status}
                        </span>
                        <div class="wfor-run-title" title={run.workflowTitle}>
                          <span>{run.workflowTitle}</span>
                          <span class="wfor-run-num">#{run.runNumber}</span>
                          <span class="wfor-run-source">({run.source})</span>
                        </div>
                        <span class="wfor-run-time">{when(run.startedAt)}</span>
                        <span class="wfor-run-duration">{formatDuration(run.durationMs)}</span>
                        <div class="wfor-run-models">
                          <For each={run.models.slice(0, 3)}>{(m) => <span class="wfo-model-badge">{m}</span>}</For>
                          <Show when={run.models.length > 3}>
                            <span class="wfo-model-badge">+{run.models.length - 3}</span>
                          </Show>
                        </div>
                        <span class="wfor-run-duration">
                          {formatTokens(run.uncachedInputTokens + run.cachedInputTokens)} /{" "}
                          {formatTokens(run.outputTokens)}
                        </span>
                        <span class="wfor-run-cost">{formatCost(run.estimatedCostUsd)}</span>
                      </Button>

                      <Show when={isExpanded(run.runId)}>
                        <div class="wfor-steps-table">
                          <For each={run.steps}>
                            {(step) => (
                              <div class="wfor-step-row">
                                <span class="wfor-step-name" title={step.agentName ?? step.nodeId}>
                                  {step.agentName ?? step.nodeId}
                                </span>
                                <span class="wfor-step-kind">{step.kind}</span>
                                <span class="wfor-badge" data-status={step.status}>
                                  {step.status}
                                </span>
                                <span class="wfor-step-duration">{formatDuration(step.durationMs)}</span>
                                <span class="wfor-step-models">
                                  {step.models.length > 0 ? step.models.join(", ") : "—"}
                                </span>
                                <span class="wfor-step-tokens">
                                  {formatTokens(step.uncachedInputTokens + step.cachedInputTokens)} /{" "}
                                  {formatTokens(step.outputTokens)}
                                </span>
                                <span class="wfor-step-cost">{formatCost(step.estimatedCostUsd)}</span>
                                <Show when={step.error}>
                                  <div class="wfor-step-error">
                                    {t("fork.workflow.overview.reporting.error", { error: step.error ?? "" })}
                                  </div>
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
              <Show when={filteredRuns().length > rendered()}>
                <Button variant="ghost" size="sm" onClick={() => setRendered((count) => count + RENDER_STEP)}>
                  {t("fork.workflow.overview.reporting.showMore", {
                    count: Math.min(RENDER_STEP, filteredRuns().length - rendered()),
                  })}
                </Button>
              </Show>
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
}
