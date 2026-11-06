// @vitest-environment node
// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.

// Pausing workflows, on the real SQLite, the real workflow service and the real schedule triggers, with a
// clock the test moves. A pause is never destructive: an open run goes on and a manual run still starts.
// A paused workflow starts no run from a schedule, a webhook or a mention, and a due occurrence is skipped:
// the trigger moves on, so a resume replays nothing. The pause of one workflow and of every workflow are
// separate flags.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoutineSchedule, WorkflowGraph, WorkflowNode } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import type { MessagingDiscordMention } from "../messaging/messaging-threads";
import { OpenBotDatabase } from "../openbot-database";
import { WorkflowGitHubStore } from "./workflow-github-store";
import { WorkflowRunStore } from "./workflow-run-store";
import { WorkflowStore } from "./workflow-store";
import { WorkflowTriggers, workflowScheduleDueAt } from "./workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "./workflows";

const ZONE = "UTC";
const START = "2026-10-24T09:00:00.000Z";
const EVERY_15: RoutineSchedule = { kind: "interval", amount: 15, unit: "minutes", anchorAt: START };

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A trigger and a step after it: a notice ends at once, an approval keeps the run open. */
function graphOf(trigger: WorkflowNode, step: "notify" | "approval"): WorkflowGraph {
  return {
    nodes: [
      trigger,
      step === "notify"
        ? { id: "step", kind: "output", at: { x: 300, y: 0 }, fields: { target: "notify" } }
        : { id: "step", kind: "approval", at: { x: 300, y: 0 }, fields: { question: "Go on?" } },
    ],
    edges: [{ id: "edge", from: "trigger", to: "step", type: "text" }],
    strokes: [],
  };
}

const scheduleTrigger: WorkflowNode = {
  id: "trigger",
  kind: "trigger",
  at: { x: 0, y: 0 },
  fields: { trigger: "schedule" },
  schedule: EVERY_15,
};
const webhookTrigger: WorkflowNode = {
  id: "trigger",
  kind: "trigger",
  at: { x: 0, y: 0 },
  fields: { trigger: "webhook" },
};
const discordTrigger: WorkflowNode = {
  id: "trigger",
  kind: "trigger",
  at: { x: 0, y: 0 },
  fields: { trigger: "discord", event: "mention", connectionId: "discord-1" },
};

async function openApp() {
  const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-pause-"));
  const database = new OpenBotDatabase(directory);
  await Effect.runPromise(database.initialize());
  let clock = new Date(START);
  const changed: string[] = [];
  const store = new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => ZONE) });
  const workflows: WorkflowsHandle = await Effect.runPromise(
    createWorkflows({
      store,
      runs: new WorkflowRunStore({ database }),
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.fail({ cause: new Error("No agent step runs in this test.") }),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model step runs in this test." }),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("No output posts in this test.")),
      changed: (workflowId) => changed.push(workflowId),
      rearm: () => {},
      timezone: () => ZONE,
      now: () => clock,
    }),
  );
  const triggers = new WorkflowTriggers({
    store,
    timezone: () => ZONE,
    start: (start) => workflows.startScheduled(start),
    changed: () => {},
    held: (workflowId) => store.fork.held(workflowId),
  });
  cleanups.push(async () => {
    await Effect.runPromise(workflows.close());
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  const create = async (title: string, graph: WorkflowGraph) => {
    const created = await runCauseEffect(workflows.create({ title }));
    const saved = await runCauseEffect(
      workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
    );
    expect(saved.ok).toBe(true);
    return created.summary.id;
  };
  const runsOf = async (workflowId: string) => {
    const occurrence = database.connection.prepare("SELECT scheduled_for FROM workflow_runs WHERE run_id = ?");
    return (await runCauseEffect(workflows.runs({ workflowId, limit: 50 }))).runs.map(({ run }) => {
      const row = occurrence.get(run.id);
      return { ...run, scheduledFor: row && typeof row.scheduled_for === "string" ? row.scheduled_for : null };
    });
  };
  const nextDueAt = async (workflowId: string) =>
    (await runCauseEffect(workflows.get(workflowId))).triggers.find((entry) => entry.nodeId === "trigger")?.nextDueAt ??
    null;
  return {
    workflows,
    store,
    changed,
    create,
    runsOf,
    nextDueAt,
    setClock: (at: string) => {
      clock = new Date(at);
    },
    fire: () => runCauseEffect(triggers.processDue(clock, () => true)),
  };
}

const mention = (messageId: string): MessagingDiscordMention => ({
  connectionId: "discord-1",
  serverName: "Server",
  channelId: "channel-1",
  channelName: "general",
  messageId,
  authorId: "author-1",
  authorName: "Someone",
  authorRoleIds: [],
  text: "@OpenBot hello",
  files: [],
  receivedAt: START,
});

describe("workflow pause", () => {
  it("skips a due occurrence of a paused workflow and moves the trigger on", async () => {
    const app = await openApp();
    const id = await app.create("Every quarter hour", graphOf(scheduleTrigger, "notify"));
    const paused = await runCauseEffect(app.workflows.setPaused({ workflowId: id, paused: true }));
    expect(paused.pausedAt).toBe(START);
    expect(app.changed).toContain(id);

    app.setClock("2026-10-24T09:15:01.000Z");
    await app.fire();
    expect(await app.runsOf(id)).toHaveLength(0);
    expect(await app.nextDueAt(id)).toBe("2026-10-24T09:30:00.000Z");
  });

  it("starts the next occurrence after a resume and replays no skipped one", async () => {
    const app = await openApp();
    const id = await app.create("Every quarter hour", graphOf(scheduleTrigger, "notify"));
    await runCauseEffect(app.workflows.setPaused({ workflowId: id, paused: true }));
    app.setClock("2026-10-24T09:15:01.000Z");
    await app.fire();
    app.setClock("2026-10-24T09:30:01.000Z");
    await app.fire();
    expect(await app.runsOf(id)).toHaveLength(0);

    const resumed = await runCauseEffect(app.workflows.setPaused({ workflowId: id, paused: false }));
    expect(resumed.pausedAt).toBeNull();
    await app.fire();
    expect(await app.runsOf(id)).toHaveLength(0);

    app.setClock("2026-10-24T09:45:01.000Z");
    await app.fire();
    const runs = await app.runsOf(id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.scheduledFor).toBe("2026-10-24T09:45:00.000Z");
  });

  it("holds every workflow while all are paused, separately from each workflow's own pause", async () => {
    const app = await openApp();
    const first = await app.create("First", graphOf(scheduleTrigger, "notify"));
    const second = await app.create("Second", graphOf(scheduleTrigger, "notify"));
    expect((await runCauseEffect(app.workflows.scheduling())).pausedAt).toBeNull();

    const all = await runCauseEffect(app.workflows.setAllPaused(true));
    expect(all).toEqual({ pausedAt: START, pausedReason: "manual", upgradeVersion: null });
    await runCauseEffect(app.workflows.setPaused({ workflowId: second, paused: true }));
    app.setClock("2026-10-24T09:15:01.000Z");
    await app.fire();
    expect(await app.runsOf(first)).toHaveLength(0);
    expect(await app.runsOf(second)).toHaveLength(0);
    // The global pause does not show as each workflow's own pause.
    expect((await runCauseEffect(app.workflows.get(first))).summary.pausedAt).toBeNull();

    // Resuming one workflow leaves the global pause.
    await runCauseEffect(app.workflows.setPaused({ workflowId: second, paused: false }));
    app.setClock("2026-10-24T09:30:01.000Z");
    await app.fire();
    expect(await app.runsOf(second)).toHaveLength(0);

    // Resuming all leaves each workflow's own pause.
    await runCauseEffect(app.workflows.setPaused({ workflowId: second, paused: true }));
    expect(await runCauseEffect(app.workflows.setAllPaused(false))).toEqual({
      pausedAt: null,
      pausedReason: null,
      upgradeVersion: null,
    });
    app.setClock("2026-10-24T09:45:01.000Z");
    await app.fire();
    expect(await app.runsOf(first)).toHaveLength(1);
    expect(await app.runsOf(second)).toHaveLength(0);
  });

  it("still starts a manual run of a paused workflow", async () => {
    const app = await openApp();
    const id = await app.create("Manual", graphOf(scheduleTrigger, "notify"));
    await runCauseEffect(app.workflows.setPaused({ workflowId: id, paused: true }));
    await runCauseEffect(app.workflows.setAllPaused(true));
    const started = await runCauseEffect(app.workflows.startRun({ workflowId: id, requestId: "manual-1" }));
    expect(started.run.source).toBe("manual");
    expect(await app.runsOf(id)).toHaveLength(1);
  });

  it("leaves an open run as it is", async () => {
    const app = await openApp();
    const id = await app.create("Waits", graphOf(scheduleTrigger, "approval"));
    const started = await runCauseEffect(app.workflows.startRun({ workflowId: id, requestId: "manual-1" }));
    await runCauseEffect(app.workflows.sweep());
    expect((await runCauseEffect(app.workflows.run(started.run.id))).run.status).toBe("approval");

    await runCauseEffect(app.workflows.setPaused({ workflowId: id, paused: true }));
    await runCauseEffect(app.workflows.setAllPaused(true));
    const detail = await runCauseEffect(app.workflows.run(started.run.id));
    expect(detail.run.status).toBe("approval");
    const waiting = detail.steps.find((step) => step.status === "approval");
    expect(waiting).toBeDefined();
    if (waiting) await runCauseEffect(app.workflows.decide({ stepId: waiting.id, approved: true }));
    expect((await runCauseEffect(app.workflows.run(started.run.id))).run.status).toBe("done");
  });

  it("ignores a webhook request and a mention of a paused workflow", async () => {
    const app = await openApp();
    const hook = await app.create("Webhook", graphOf(webhookTrigger, "notify"));
    const chat = await app.create("Discord", graphOf(discordTrigger, "notify"));
    await runCauseEffect(app.workflows.setPaused({ workflowId: hook, paused: true }));
    await runCauseEffect(app.workflows.setPaused({ workflowId: chat, paused: true }));

    const event = { deliveryId: "delivery-1", eventType: "push", data: {}, occurredAt: START, receivedAt: START };
    const result = await runCauseEffect(app.workflows.receiveWebhook({ workflowId: hook, nodeId: "trigger", event }));
    expect(result).toEqual({ kind: "ignored", reason: "busy" });
    expect(await runCauseEffect(app.workflows.receiveWebhook({ workflowId: hook, nodeId: "trigger", event }))).toEqual({
      kind: "duplicate",
    });
    expect(await app.runsOf(hook)).toHaveLength(0);

    expect(await runCauseEffect(app.workflows.receiveDiscord(mention("message-1")))).toBe("skipped");
    expect(await app.runsOf(chat)).toHaveLength(0);

    await runCauseEffect(app.workflows.setPaused({ workflowId: chat, paused: false }));
    expect(await runCauseEffect(app.workflows.receiveDiscord(mention("message-2")))).toBe("started");
    expect(await app.runsOf(chat)).toHaveLength(1);
  });

  it("keeps the pause across graph saves and starts a new workflow not paused", async () => {
    const app = await openApp();
    const id = await app.create("Kept", graphOf(scheduleTrigger, "notify"));
    await runCauseEffect(app.workflows.setPaused({ workflowId: id, paused: true }));
    const before = await runCauseEffect(app.workflows.get(id));
    const saved = await runCauseEffect(
      app.workflows.saveGraph({
        workflowId: id,
        baseRevision: before.revision,
        graph: graphOf(webhookTrigger, "notify"),
      }),
    );
    expect(saved.ok).toBe(true);
    expect((await runCauseEffect(app.workflows.get(id))).summary.pausedAt).toBe(START);
    const other = await app.create("New", graphOf(scheduleTrigger, "notify"));
    expect((await runCauseEffect(app.workflows.get(other))).summary.pausedAt).toBeNull();
  });
});
// The schema of the pause and the pause at an upgrade: src/backend/fork/fork-schema.test.ts.
