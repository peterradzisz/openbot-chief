// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import type { WorkflowNode, WorkflowScheduling } from "@openbot/contracts/ipc";
import { markdownPreviewText } from "@openbot/contracts/markdown-preview-text";
import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import { toast } from "@openbot/ui";
import { type OverviewWorkflow, WorkflowOverview } from "@openbot/ui/features/workflows/WorkflowOverview";
import { WorkflowOverviewSettings } from "@openbot/ui/features/workflows/WorkflowOverviewSettings";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, onSettled, Show, untrack } from "solid-js";
import { useAgents } from "../agents/agents-context";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { useExternalPlanUsageRows } from "../usage/external-plan-usage";
import { useWindowPage } from "../window/window-page-context";
import { createIssueStats } from "./issue-stats-source";
import { colorFromRules, createOverviewSettingsStore, toneFromRules } from "./overview-settings";
import { WorkflowIssueStats } from "./WorkflowIssueStats";
import { WorkflowReporting } from "./WorkflowReporting";
import { desktopWorkflowHost, type WorkflowHost } from "./workflows-port";

/** How often the page reads again while it shows, for runs that change without an event. */
const POLL_MS = 5000;
/** A run sends several change events in a row; the page reads once after the last of them. */
const EVENT_DELAY_MS = 300;

/** A card as the host has it. The page names the step: an agent step by its agent. */
type CardSource = Omit<OverviewWorkflow, "step" | "model" | "thinking"> & {
  step: { node: WorkflowNode | undefined; agentId: string | null } | null;
  model?: string | null;
  thinking?: string | null;
};

/**
 * Every workflow of one server on a page of its own: what runs now and at what step, when each
 * scheduled one runs next, and Run and Stop on each card. It reads the host on its own, so the
 * Workflows page keeps its canvas. A card's name opens that workflow on the Workflows page.
 */
export function AllWorkflowsPage(props: { serverId: string }) {
  const { t } = useText();
  const { servers } = useServers();
  const server = () => servers().find((entry) => entry.id === props.serverId);
  const supported = () => {
    const entry = server();
    return !entry || entry.kind === "local" || serverSupportsCapability(entry, WORKFLOWS_CAPABILITY);
  };
  return (
    <Show
      when={supported() ? props.serverId : null}
      keyed
      fallback={
        <main class="window-page diagram-view diagram-flows-notice">
          <p>{t("error.workflow.serverTooOld")}</p>
        </main>
      }
    >
      {(serverId) => <AllWorkflows host={desktopWorkflowHost(serverId, server)} serverId={serverId} />}
    </Show>
  );
}

function AllWorkflows(props: { host: WorkflowHost; serverId: string }) {
  const { t, errorMessage } = useText();
  const { agentList } = useAgents();
  const windowPage = useWindowPage();
  const settings = createOverviewSettingsStore();
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const usageRows = useExternalPlanUsageRows();
  const issues = createIssueStats(() => settings.settings().project);
  // The keyed parent mounts a new page for each server, so the host does not change.
  const host = untrack(() => props.host);
  const report = (error: unknown) => {
    toast.error(errorMessage(error, t("workflow.page.failed")));
  };

  /** Undefined until the first read returns. */
  const [cards, setCards] = createSignal<readonly CardSource[] | undefined>();
  /** When every workflow was paused at once, null when not, undefined when the host has no pause. */
  const [allPausedAt, setAllPausedAt] = createSignal<string | null | undefined>();
  /** The version the host was upgraded to when the pause of every workflow came from that upgrade. */
  const [allPausedUpgrade, setAllPausedUpgrade] = createSignal<string | null>(null);
  const showScheduling = (state: WorkflowScheduling | null) => {
    setAllPausedAt(state ? state.pausedAt : undefined);
    setAllPausedUpgrade(state?.pausedReason === "upgrade" ? (state.upgradeVersion ?? "") : null);
  };
  /** Workflows whose Run was pressed and whose call has not returned yet. */
  const [starting, setStarting] = createSignal<ReadonlySet<string>>(new Set<string>());
  /** The latest thinking or activity commentary reported per agent. */
  const [thinkingByAgent, setThinkingByAgent] = createSignal<Record<string, string>>({});
  let disposed = false;
  /** Counts the reads, so that an older read does not replace a newer one. */
  let request = 0;
  /** When the last read started, so the poll skips a read that an event just made. */
  let lastRead = 0;

  /** Reads every workflow with its trigger state and newest run. */
  const read = async () => {
    const mine = ++request;
    lastRead = Date.now();
    const [list, scheduling] = await Promise.all([
      host.workflows.list(),
      // A joined server from before the pause has no such route: the page then shows no pause controls.
      host.workflows.scheduling().catch(() => null),
    ]);
    const rows = await Promise.all(
      list.map(async (summary): Promise<CardSource> => {
        const [detail, page] = await Promise.all([
          host.workflows.get(summary.id),
          host.workflows.runs({ workflowId: summary.id, limit: 1 }),
        ]);
        const triggerNode = detail.graph.nodes.find((node) => node.kind === "trigger");
        const trigger = detail.triggers.find((state) => state.nodeId === triggerNode?.id) ?? detail.triggers[0];
        const latest = page.runs[0];
        const active = latest?.steps.find((step) => step.status === "running" || step.status === "approval");
        const activeNode = active ? detail.graph.nodes.find((node) => node.id === active.nodeId) : undefined;
        const fieldAgentId =
          activeNode?.kind === "agent" && typeof activeNode.fields.agentId === "string"
            ? activeNode.fields.agentId
            : undefined;
        const activeAgentId = active?.agentId ?? fieldAgentId;

        if (active && activeAgentId && window.openbot?.agent?.readConversationPage) {
          window.openbot.agent
            .readConversationPage({ agentId: activeAgentId, limit: 10 }, props.serverId)
            .then((convPage) => {
              const latestCommentary = [...convPage.messages]
                .reverse()
                .find((m) => (m.itemType === "commentary" || m.author === "assistant") && m.text?.trim());
              if (latestCommentary?.text) {
                const text = markdownPreviewText(latestCommentary.text).slice(0, 160);
                setThinkingByAgent((prev) => ({ ...prev, [activeAgentId]: text }));
              }
            })
            .catch(() => undefined);
        }

        return {
          id: summary.id,
          title: summary.title,
          steps: summary.steps,
          trigger: trigger?.type ?? "manual",
          nextDueAt: trigger?.nextDueAt ?? null,
          run: latest
            ? {
                id: latest.run.id,
                number: latest.run.number,
                status: latest.run.status,
                startedAt: latest.run.startedAt,
                endedAt: latest.run.endedAt,
              }
            : null,
          step: active ? { node: activeNode, agentId: active.agentId } : null,
          pausedAt: summary.pausedAt,
          autoApprove: summary.autoApprove,
        };
      }),
    );
    if (!disposed && mine === request) {
      setCards(rows);
      showScheduling(scheduling);
    }
  };

  onSettled(() => {
    read().catch(report);
    let pending: ReturnType<typeof setTimeout> | undefined;
    const stop = host.onChanged(() => {
      clearTimeout(pending);
      pending = setTimeout(() => read().catch(report), EVENT_DELAY_MS);
    });
    const unsubscribeEvents = window.openbot.agent.onScopedEvent((scoped) => {
      if (scoped.serverId !== props.serverId) return;
      const event = scoped.event;
      if (event.type === "turn-progress" && event.detail) {
        const clean = markdownPreviewText(event.detail).slice(0, 160);
        setThinkingByAgent((prev) => ({ ...prev, [event.agentId]: clean }));
      } else if (event.type === "conversation") {
        const latest = [...event.snapshot.messages]
          .reverse()
          .find((m) => (m.itemType === "commentary" || m.author === "assistant") && m.text?.trim());
        if (latest?.text) {
          const clean = markdownPreviewText(latest.text).slice(0, 160);
          setThinkingByAgent((prev) => ({ ...prev, [event.snapshot.agentId]: clean }));
        }
      } else if (event.type === "conversation-delta") {
        setThinkingByAgent((prev) => {
          const current = prev[event.agentId] ?? "";
          const next = (current + event.delta).slice(-160);
          return { ...prev, [event.agentId]: markdownPreviewText(next) };
        });
      } else if (event.type === "agent-task-conversation-delta") {
        setThinkingByAgent((prev) => {
          const current = prev[event.agentId] ?? "";
          const next = (current + event.delta).slice(-160);
          return { ...prev, [event.agentId]: markdownPreviewText(next) };
        });
      } else if (event.type === "agent-task-conversation") {
        const latest = [...event.snapshot.messages]
          .reverse()
          .find((m) => (m.itemType === "commentary" || m.author === "assistant") && m.text?.trim());
        if (latest?.text) {
          const clean = markdownPreviewText(latest.text).slice(0, 160);
          setThinkingByAgent((prev) => ({ ...prev, [event.snapshot.agentId]: clean }));
        }
      } else if (event.type === "turn-started") {
        setThinkingByAgent((prev) => ({ ...prev, [event.agentId]: "Thinking..." }));
      }
    });
    // A failed poll stays quiet: the next one reads again, and an event read shows its error.
    const timer = setInterval(() => {
      if (!document.hidden && Date.now() - lastRead >= POLL_MS / 2) read().catch(() => undefined);
    }, POLL_MS);
    return () => {
      disposed = true;
      stop();
      unsubscribeEvents();
      clearTimeout(pending);
      clearInterval(timer);
    };
  });

  /** An agent step by its agent's name, another step by its kind. */
  const stepName = (step: CardSource["step"]): string | null => {
    if (!step) return null;
    const agentId = step.agentId ?? (step.node?.kind === "agent" ? step.node.fields.agentId : undefined);
    const agent = typeof agentId === "string" ? agentList().find((entry) => entry.id === agentId) : undefined;
    if (agent) return agent.name;
    switch (step.node?.kind) {
      case "agent":
        return t("workflow.agent.title");
      case "approval":
        return t("workflow.approval.title");
      case "condition":
        return t("workflow.condition.title");
      case "llm":
        return t("workflow.llm.title");
      case "output":
        return t("workflow.output.title");
      default:
        return step.node?.kind ?? null;
    }
  };
  const shown = createMemo<readonly OverviewWorkflow[]>(() =>
    (cards() ?? []).map((card) => {
      const step = stepName(card.step);
      const fieldAgentId =
        card.step?.node?.kind === "agent" && typeof card.step.node.fields.agentId === "string"
          ? card.step.node.fields.agentId
          : undefined;
      const agentId = card.step?.agentId ?? fieldAgentId;
      const agent = agentId ? agentList().find((entry) => entry.id === agentId) : undefined;
      const nodeModel = typeof card.step?.node?.fields?.model === "string" ? card.step.node.fields.model : null;
      const rawModel = agent?.model ?? nodeModel;
      const model = rawModel ? (rawModel.includes("/") ? (rawModel.split("/").pop() ?? rawModel) : rawModel) : null;
      const thinking = agentId ? (thinkingByAgent()[agentId] ?? null) : null;
      return {
        ...card,
        step,
        model,
        thinking,
        tone: toneFromRules(settings.settings().colorRules, card.title, step ?? ""),
        toneColor: colorFromRules(settings.settings().colorRules, card.title, step ?? ""),
      };
    }),
  );

  const run = (workflowId: string) => {
    setStarting((ids) => new Set(ids).add(workflowId));
    host.workflows
      .startRun({ workflowId, requestId: crypto.randomUUID() })
      .catch(report)
      .finally(() => {
        setStarting((ids) => {
          const next = new Set(ids);
          next.delete(workflowId);
          return next;
        });
        read().catch(report);
      });
  };
  const stop = (runId: string) => {
    host.workflows
      .stopRun(runId)
      .catch(report)
      .finally(() => read().catch(report));
  };

  /** Pausing never stops a run that is open; it only keeps triggers from starting new ones. */
  const pause = (workflowId: string, paused: boolean) => {
    host.workflows
      .setPaused({ workflowId, paused })
      .catch(report)
      .finally(() => read().catch(report));
  };
  /** Auto-approve decides the approvals that runs reach later; one that already waits stays. */
  const autoApprove = (workflowId: string, enabled: boolean) => {
    host.workflows
      .setAutoApprove({ workflowId, enabled })
      .catch(report)
      .finally(() => read().catch(report));
  };
  const pauseAll = (paused: boolean) => {
    host.workflows
      .setAllPaused(paused)
      .then(showScheduling)
      .catch(report)
      .finally(() => read().catch(report));
  };

  const usageRowsForSettings = () =>
    usageRows().map((row) => ({
      id: row.accountId ?? row.name,
      name: row.name,
      summary: row.windows.map((window) => `${window.label} ${Math.round(window.remainingPercent)}%`).join(", "),
    }));

  return (
    <>
      <WorkflowOverview
        workflows={shown()}
        starting={starting()}
        loading={cards() === undefined}
        readOnly={false}
        onOpen={(workflowId) => windowPage.openWorkflows(null, workflowId)}
        onRun={run}
        onStop={stop}
        allPausedAt={allPausedAt()}
        allPausedUpgrade={allPausedUpgrade()}
        onPause={allPausedAt() === undefined ? undefined : pause}
        onPauseAll={pauseAll}
        onAutoApprove={autoApprove}
        onSettings={() => setSettingsOpen(true)}
        top={
          <>
            <WorkflowIssueStats stats={issues.stats()} error={issues.error()} loading={issues.loading()} />
            {/* A new run limit reads the reporting again. */}
            <Show when={settings.settings().reportRuns} keyed>
              {(limit) => <WorkflowReporting host={host} limit={limit} />}
            </Show>
          </>
        }
      />
      <WorkflowOverviewSettings
        open={settingsOpen()}
        onOpenChange={setSettingsOpen}
        project={settings.settings().project}
        onProjectChange={settings.setProject}
        reportedProject={issues.stats()?.repo ?? null}
        colorRules={settings.settings().colorRules}
        onColorRulesChange={settings.setColorRules}
        usageRows={usageRowsForSettings()}
        hiddenUsageRows={settings.settings().hiddenUsageRows}
        onHiddenUsageRowsChange={settings.setHiddenUsageRows}
        reportRuns={settings.settings().reportRuns}
        onReportRunsChange={settings.setReportRuns}
      />
    </>
  );
}
