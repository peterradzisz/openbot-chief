// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Every workflow of the server on one page of its own: which ones run now and at what step,
 * when each scheduled one runs next, how the last run ended, and Run and Stop on each card. A card's
 * name opens that workflow on the canvas. The page shows what the host reports; it starts and stops
 * runs through the same calls as the canvas.
 *
 * Groups: running now, then scheduled, then manual and webhook workflows, each by name. Each group
 * folds, and the page remembers which ones. `top` holds extra groups above them (the issue numbers).
 */

import type { WorkflowRunStatus, WorkflowTriggerType } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  ArrowLeft,
  Badge,
  Button,
  IconButton,
  Input,
  Pause,
  Play,
  Settings,
  Square,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { createCollapsedGroups } from "./collapsed-groups";
import { AutoApproveBadge, AutoApproveToggle } from "./WorkflowAutoApprove";
import "./collapsed-groups.css";

export { createCollapsedGroups } from "./collapsed-groups";

export interface OverviewWorkflow {
  id: string;
  title: string;
  steps: number;
  /** The first trigger of the graph: what starts the workflow. */
  trigger: WorkflowTriggerType;
  /** When a schedule fires next, or null. */
  nextDueAt: string | null;
  /** The newest run, or null when the workflow never ran. */
  run: { id: string; number: number; status: WorkflowRunStatus; startedAt: string; endedAt: string | null } | null;
  /** The step that runs now or waits for a decision, named for people, or null. */
  step: string | null;
  /** The model currently doing the work, or null. */
  model?: string | null | undefined;
  /** The latest thinking or activity commentary of the running step, or null. */
  thinking?: string | null | undefined;
  /** A colour group for the strip behind the name, or undefined for none. */
  tone?: OverviewTone | undefined;
  /** A free colour "#rrggbb" for the strip, from a colour rule; it replaces the tone's colour. */
  toneColor?: string | undefined;
  /** When the workflow itself was paused, or null. A paused workflow starts no run from a trigger. */
  pausedAt?: string | null | undefined;
  /** Whether the workflow approves the approval steps its runs reach by itself (Auto-approve). */
  autoApprove?: boolean | undefined;
}

/** The colour groups of the name strip. The page that lists the workflows picks one per card. */
export type OverviewTone = "plan" | "build" | "judge" | "conflict" | "violet";

/** Every tone, in the order a picker lists them. */
export const OVERVIEW_TONES = [
  "plan",
  "build",
  "judge",
  "conflict",
  "violet",
] as const satisfies readonly OverviewTone[];

import type { AppTextKey } from "@openbot/i18n";

/** The run states a card names, as keys of their labels. */
const STATUS_LABEL = {
  running: "fork.workflow.overview.status.running",
  approval: "fork.workflow.overview.status.approval",
  stopping: "fork.workflow.overview.status.stopping",
  done: "fork.workflow.overview.status.done",
  failed: "fork.workflow.overview.status.failed",
  stopped: "fork.workflow.overview.status.stopped",
  idle: "fork.workflow.overview.status.idle",
} as const satisfies Record<WorkflowRunStatus | "idle", AppTextKey>;

const ACTIVE: readonly WorkflowRunStatus[] = ["running", "approval", "stopping"];
const isActive = (workflow: OverviewWorkflow) => workflow.run !== null && ACTIVE.includes(workflow.run.status);

export function WorkflowOverview(props: {
  workflows: readonly OverviewWorkflow[];
  /** Workflows whose Run was pressed and whose run the host has not reported yet. */
  starting: ReadonlySet<string>;
  readOnly: boolean;
  onOpen: (workflowId: string) => void;
  onRun: (workflowId: string) => void;
  onStop: (runId: string) => void;
  /** True until the first read, so the page does not flash its empty notice. */
  loading?: boolean | undefined;
  /** Absent on a page of its own, which the rail leaves. */
  onBack?: (() => void) | undefined;
  /** Opens the settings of the page, when it has any. */
  onSettings?: (() => void) | undefined;
  /** Groups above the workflow groups, such as the issue numbers. They keep their own state. */
  top?: JSX.Element | undefined;
  /**
   * When every workflow was paused at once, or null. Undefined hides the pause controls, for a host
   * that has no pause.
   */
  allPausedAt?: string | null | undefined;
  /**
   * When the pause of every workflow came from an upgrade, the version the host was upgraded to (an
   * empty text when the host did not say which); null for a pause a user set.
   */
  allPausedUpgrade?: string | null | undefined;
  /** Pauses or resumes one workflow. Its open run goes on. */
  onPause?: ((workflowId: string, paused: boolean) => void) | undefined;
  /** Pauses or resumes every workflow at once. */
  onPauseAll?: ((paused: boolean) => void) | undefined;
  /** Turns Auto-approve of one workflow on or off. Undefined hides the switch. */
  onAutoApprove?: ((workflowId: string, enabled: boolean) => void) | undefined;
}) {
  const { t, format } = useText();
  const [filter, setFilter] = createSignal("");
  const collapsed = createCollapsedGroups();
  const when = (iso: string) =>
    format.date(new Date(iso), { weekday: "short", hour: "numeric", minute: "2-digit", hour12: format.hour12 });

  const groups = createMemo(() => {
    const needle = filter().trim().toLocaleLowerCase();
    const shown = props.workflows
      .filter((workflow) => !needle || workflow.title.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title));
    const running = shown.filter(isActive);
    const scheduled = shown.filter((workflow) => !isActive(workflow) && workflow.trigger === "schedule");
    const other = shown.filter((workflow) => !isActive(workflow) && workflow.trigger !== "schedule");
    return [
      { key: "running", label: t("fork.workflow.overview.groupRunning"), items: running },
      { key: "scheduled", label: t("fork.workflow.overview.groupScheduled"), items: scheduled },
      { key: "other", label: t("fork.workflow.overview.groupOther"), items: other },
    ].filter((group) => group.items.length > 0);
  });

  const triggerText = (workflow: OverviewWorkflow) => {
    if (workflow.trigger === "schedule")
      return workflow.nextDueAt
        ? t("fork.workflow.overview.next", { time: when(workflow.nextDueAt) })
        : t("fork.workflow.overview.noNext");
    return t(workflow.trigger === "webhook" ? "fork.workflow.overview.webhook" : "fork.workflow.overview.manual");
  };

  const runText = (workflow: OverviewWorkflow) => {
    const run = workflow.run;
    if (!run) return t("fork.workflow.overview.never");
    if (isActive(workflow))
      return t("fork.workflow.overview.started", { number: run.number, time: when(run.startedAt) });
    return t("fork.workflow.overview.ended", {
      number: run.number,
      outcome: t(STATUS_LABEL[run.status]),
      time: when(run.endedAt ?? run.startedAt),
    });
  };

  const status = (workflow: OverviewWorkflow): WorkflowRunStatus | "idle" => workflow.run?.status ?? "idle";
  const paused = (workflow: OverviewWorkflow) => Boolean(workflow.pausedAt);
  const pauseControls = () => props.allPausedAt !== undefined;
  /** The banner title: after an upgrade (to the version, when the host named it), or since a time. */
  const allPausedTitle = (at: string) => {
    const upgrade = props.allPausedUpgrade;
    if (upgrade) return t("fork.workflow.overview.allPausedUpgradeTitle", { version: upgrade });
    if (upgrade === "") return t("fork.workflow.overview.allPausedUpgradeUnknownTitle");
    return t("fork.workflow.overview.allPausedTitle", { time: when(at) });
  };

  /** Pause on a card that runs from its triggers, Resume on a paused one. A run that is open goes on. */
  const pauseButton = (workflow: () => OverviewWorkflow) => (
    <Show when={props.onPause}>
      {(onPause) => (
        <IconButton
          label={t(paused(workflow()) ? "fork.workflow.overview.resume" : "fork.workflow.overview.pause")}
          variant="ghost"
          class="wfo-pause-btn"
          aria-pressed={paused(workflow()) ? "true" : "false"}
          disabled={props.readOnly}
          onClick={() => onPause()(workflow().id, !paused(workflow()))}
        >
          <Show when={paused(workflow())} fallback={<Pause aria-hidden="true" />}>
            <Play aria-hidden="true" />
          </Show>
        </IconButton>
      )}
    </Show>
  );

  const pausedBadge = (workflow: () => OverviewWorkflow) => (
    <Show when={workflow().pausedAt}>
      {(at) => (
        <Badge
          variant="info-outline"
          class="wfo-paused"
          title={t("fork.workflow.overview.pausedSince", { time: when(at()) })}
        >
          {t("fork.workflow.overview.paused")}
        </Badge>
      )}
    </Show>
  );

  /**
   * An idle card is one row plus its trigger. Its status shows how the last run ended, so the run line
   * shows only after a failed or stopped run. A running card shows when its run started.
   */
  const showsRun = (workflow: OverviewWorkflow) =>
    isActive(workflow) || workflow.run?.status === "failed" || workflow.run?.status === "stopped";

  /** Run on an idle card, Stop on a running one. */
  const actions = (workflow: () => OverviewWorkflow) => (
    <Show
      when={isActive(workflow()) && workflow().run?.status !== "stopping" ? workflow().run : null}
      fallback={
        <Button
          variant="outline"
          size="sm"
          class="wfo-action-btn wfo-run-btn"
          disabled={props.readOnly || isActive(workflow()) || props.starting.has(workflow().id)}
          onClick={() => props.onRun(workflow().id)}
        >
          <Play aria-hidden="true" />
          {t("fork.workflow.overview.run")}
        </Button>
      }
    >
      {(run) => (
        <Button
          variant="destructive-ghost"
          size="sm"
          class="wfo-action-btn wfo-stop-btn"
          disabled={props.readOnly}
          onClick={() => props.onStop(run().id)}
        >
          <Square aria-hidden="true" />
          {t("fork.workflow.overview.stop")}
        </Button>
      )}
    </Show>
  );

  return (
    <main class="window-page wfo-page" aria-label={t("fork.workflow.overview.title")}>
      <header class="wfo-header">
        <Show when={props.onBack}>
          {(back) => (
            <Button variant="ghost" size="sm" onClick={() => back()()}>
              <ArrowLeft aria-hidden="true" />
              {t("fork.workflow.overview.back")}
            </Button>
          )}
        </Show>
        <h1 class="wfo-title">{t("fork.workflow.overview.title")}</h1>
        <span class="wfo-meta">
          {t("fork.workflow.overview.summary", {
            count: props.workflows.length,
            running: props.workflows.filter(isActive).length,
          })}
        </span>
        <Input
          class="wfo-filter"
          type="search"
          placeholder={t("fork.workflow.overview.filter")}
          aria-label={t("fork.workflow.overview.filter")}
          value={filter()}
          onValueChange={setFilter}
        />
        <Show when={pauseControls() ? props.onPauseAll : undefined}>
          {(onPauseAll) => (
            <Button
              variant={props.allPausedAt ? "default" : "outline"}
              size="sm"
              class="wfo-pause-all"
              aria-pressed={props.allPausedAt ? "true" : "false"}
              disabled={props.readOnly}
              onClick={() => onPauseAll()(!props.allPausedAt)}
            >
              <Show when={props.allPausedAt} fallback={<Pause aria-hidden="true" />}>
                <Play aria-hidden="true" />
              </Show>
              {t(props.allPausedAt ? "fork.workflow.overview.resumeAll" : "fork.workflow.overview.pauseAll")}
            </Button>
          )}
        </Show>
        <Show when={props.onSettings}>
          {(onSettings) => (
            <IconButton
              label={t("fork.workflow.overview.settings.open")}
              variant="ghost"
              class="wfo-settings-open"
              onClick={() => onSettings()()}
            >
              <Settings aria-hidden="true" />
            </IconButton>
          )}
        </Show>
      </header>
      <div class="wfo-body">
        <Show when={props.allPausedAt}>
          {(at) => (
            <Alert tone="warning" report={false} role="status" class="wfo-paused-banner">
              <AlertIcon>
                <Pause />
              </AlertIcon>
              <AlertContent>
                <AlertTitle>{allPausedTitle(at())}</AlertTitle>
                <AlertDescription>
                  {typeof props.allPausedUpgrade === "string"
                    ? t("fork.workflow.overview.allPausedUpgradeBody", { time: when(at()) })
                    : t("fork.workflow.overview.allPausedBody")}
                </AlertDescription>
              </AlertContent>
              <Show when={props.onPauseAll}>
                {(onPauseAll) => (
                  <AlertActions>
                    <Button variant="outline" size="sm" disabled={props.readOnly} onClick={() => onPauseAll()(false)}>
                      <Play aria-hidden="true" />
                      {t("fork.workflow.overview.resumeAll")}
                    </Button>
                  </AlertActions>
                )}
              </Show>
            </Alert>
          )}
        </Show>
        {props.top}
        <Show
          when={groups().length > 0}
          fallback={
            <Show when={!props.loading}>
              <p class="wfo-empty">{t("fork.workflow.overview.empty")}</p>
            </Show>
          }
        >
          <For each={groups()} keyed={(group) => group.key}>
            {(group) => (
              <section class="wfo-group" aria-label={group().label}>
                <h2 class="wfo-group-title">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="wfo-fold"
                    aria-expanded={collapsed.isCollapsed(group().key) ? "false" : "true"}
                    onClick={() => collapsed.toggle(group().key)}
                  >
                    <span
                      class="wfo-caret"
                      aria-hidden="true"
                      data-open={collapsed.isCollapsed(group().key) ? undefined : ""}
                    />
                    {group().label} · {group().items.length}
                  </Button>
                </h2>
                <Show when={!collapsed.isCollapsed(group().key)}>
                  <div class="wfo-grid">
                    <For each={group().items} keyed={(item) => item.id}>
                      {(workflow) => (
                        <article
                          class="wfo-card"
                          data-active={isActive(workflow()) ? "" : undefined}
                          data-compact={isActive(workflow()) ? undefined : ""}
                          data-tone={workflow().tone}
                          style={
                            workflow().toneColor
                              ? {
                                  "--wfo-tone": workflow().toneColor,
                                  "--wfo-tone-soft": `color-mix(in srgb, ${workflow().toneColor} 18%, transparent)`,
                                }
                              : undefined
                          }
                          data-paused={paused(workflow()) ? "" : undefined}
                        >
                          <div class="wfo-card-top">
                            <Button
                              variant="ghost"
                              size="sm"
                              class="wfo-name"
                              aria-label={t("fork.workflow.overview.openCanvas", { name: workflow().title })}
                              title={workflow().title}
                              onClick={() => props.onOpen(workflow().id)}
                            >
                              <span class="wfo-name-text">{workflow().title}</span>
                            </Button>
                            <span class="wfo-card-state">
                              {pausedBadge(workflow)}
                              <AutoApproveBadge on={workflow().autoApprove} />
                              <span class="wfo-status" data-status={status(workflow())}>
                                {t(STATUS_LABEL[status(workflow())])}
                              </span>
                              {pauseButton(workflow)}
                            </span>
                            <Show when={!isActive(workflow())}>{actions(workflow)}</Show>
                          </div>
                          <p class="wfo-line">{triggerText(workflow())}</p>
                          <Show when={showsRun(workflow())}>
                            <p class="wfo-line">{runText(workflow())}</p>
                          </Show>
                          <Show when={props.onAutoApprove}>
                            {(onAutoApprove) => (
                              <AutoApproveToggle
                                on={workflow().autoApprove}
                                disabled={props.readOnly}
                                onChange={(enabled) => onAutoApprove()(workflow().id, enabled)}
                              />
                            )}
                          </Show>
                          <Show when={isActive(workflow()) ? workflow().step : null}>
                            {(step) => (
                              <p class="wfo-line wfo-step">
                                {workflow().run?.status === "approval"
                                  ? t("fork.workflow.overview.waiting", { step: step() })
                                  : t("fork.workflow.overview.now", { step: step() })}
                              </p>
                            )}
                          </Show>
                          <Show when={isActive(workflow()) && workflow().model}>
                            {(model) => (
                              <p class="wfo-line wfo-model">
                                <span class="wfo-model-badge">{model()}</span>
                              </p>
                            )}
                          </Show>
                          <Show when={isActive(workflow())}>
                            <div
                              class="wfo-thinking"
                              title={workflow().thinking ?? t("fork.workflow.overview.status.running")}
                            >
                              <span class="wfo-thinking-dots" aria-hidden="true">
                                <i />
                                <i />
                                <i />
                              </span>
                              <span class="wfo-thinking-text">{workflow().thinking || "Working..."}</span>
                            </div>
                          </Show>
                          <Show when={isActive(workflow())}>
                            <div class="wfo-actions">{actions(workflow)}</div>
                          </Show>
                        </article>
                      )}
                    </For>
                  </div>
                </Show>
              </section>
            )}
          </For>
        </Show>
      </div>
    </main>
  );
}
