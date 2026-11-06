// @vitest-environment node
// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.

// Fork: Auto-approve and the Reporting run limit, on the real SQLite and
// the real workflow service. A workflow with Auto-approve on decides each approval step its runs reach,
// through the same decision as a person's Approve, and the step keeps a note that says so. An approval
// that already waits when it is turned on stays; turning it off stops it; the pause does not change it.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkflowGraph, WorkflowNode, WorkflowStep } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { parseWorkflowReporting } from "../fork/workflow-fork-inputs";
import { OpenBotDatabase } from "../openbot-database";
import { WorkflowGitHubStore } from "./workflow-github-store";
import { WorkflowRunStore } from "./workflow-run-store";
import { WorkflowStore } from "./workflow-store";
import { workflowScheduleDueAt } from "./workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "./workflows";

const ZONE = "UTC";
// Yesterday: Reporting drops finished runs older than 30 days by the real clock.
const START = new Date(Math.floor(Date.now() / 1000) * 1000 - 86_400_000).toISOString();
const NOTE = sourceText("error.workflow.autoApproved");

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const trigger: WorkflowNode = { id: "trigger", kind: "trigger", at: { x: 0, y: 0 }, fields: { trigger: "manual" } };

/** A trigger, an approval and a notice after it: the run ends only once the approval is decided. */
const approvalGraph: WorkflowGraph = {
  nodes: [
    trigger,
    { id: "gate", kind: "approval", at: { x: 300, y: 0 }, fields: { question: "Go on?" } },
    { id: "after", kind: "output", at: { x: 600, y: 0 }, fields: { target: "notify" } },
  ],
  edges: [
    { id: "edge-1", from: "trigger", to: "gate", type: "text" },
    { id: "edge-2", from: "gate", to: "after", type: "text" },
  ],
  strokes: [],
};

/** A trigger and a notice: a run that ends at once. */
const quickGraph: WorkflowGraph = {
  nodes: [trigger, { id: "after", kind: "output", at: { x: 300, y: 0 }, fields: { target: "notify" } }],
  edges: [{ id: "edge-1", from: "trigger", to: "after", type: "text" }],
  strokes: [],
};

async function openApp() {
  const directory = await mkdtemp(join(tmpdir(), "openbot-workflow-auto-approve-"));
  const database = new OpenBotDatabase(directory);
  await Effect.runPromise(database.initialize());
  const notices: string[] = [];
  /** Each run starts a second after the one before, so newest first is a clear order. */
  let clock = new Date(START);
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
      notify: (notice) => notices.push(notice.kind),
      connectionOn: () => false,
      post: () => Effect.die(new Error("No output posts in this test.")),
      changed: () => {},
      rearm: () => {},
      timezone: () => ZONE,
      now: () => clock,
    }),
  );
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
  let request = 0;
  /** Starts a manual run and lets the host move it as far as it goes. */
  const start = async (workflowId: string) => {
    const started = await runCauseEffect(workflows.startRun({ workflowId, requestId: `manual-${++request}` }));
    await runCauseEffect(workflows.sweep());
    clock = new Date(clock.getTime() + 1000);
    return runCauseEffect(workflows.run(started.run.id));
  };
  const gateOf = (steps: readonly WorkflowStep[]) => steps.find((step) => step.nodeId === "gate");
  return { workflows, notices, create, start, gateOf };
}

describe("workflow Auto-approve", () => {
  it("approves an approval step that a run reaches, with a note, and the run goes on", async () => {
    const app = await openApp();
    const id = await app.create("Night run", approvalGraph);
    const summary = await runCauseEffect(app.workflows.setAutoApprove({ workflowId: id, enabled: true }));
    expect(summary.autoApprove).toBe(true);

    const detail = await app.start(id);
    expect(detail.run.status).toBe("done");
    const gate = app.gateOf(detail.steps);
    expect(gate?.status).toBe("done");
    expect(gate?.decisionNote).toBe(NOTE);
    expect(NOTE).toBe("Auto-approved by workflow setting.");
    // The approval hands its input on, as Approve does: the note is not the output.
    const after = detail.steps.find((step) => step.nodeId === "after");
    expect(after?.status).toBe("done");
    expect(gate?.output).not.toContain(NOTE);
    // Nobody is asked to decide.
    expect(app.notices).not.toContain("approval");
  });

  it("waits for a person as before when it is off", async () => {
    const app = await openApp();
    const id = await app.create("Day run", approvalGraph);
    expect((await runCauseEffect(app.workflows.get(id))).summary.autoApprove).toBe(false);

    const detail = await app.start(id);
    expect(detail.run.status).toBe("approval");
    const gate = app.gateOf(detail.steps);
    expect(gate?.status).toBe("approval");
    expect(gate?.decisionNote).toBeUndefined();
    expect(app.notices).toContain("approval");

    if (gate) await runCauseEffect(app.workflows.decide({ stepId: gate.id, approved: true }));
    const decided = await runCauseEffect(app.workflows.run(detail.run.id));
    expect(decided.run.status).toBe("done");
    expect(app.gateOf(decided.steps)?.decisionNote).toBeUndefined();
  });

  it("leaves an approval that already waits when it is turned on, and decides the next one", async () => {
    const app = await openApp();
    const id = await app.create("Waiting", approvalGraph);
    const waiting = await app.start(id);
    expect(waiting.run.status).toBe("approval");

    await runCauseEffect(app.workflows.setAutoApprove({ workflowId: id, enabled: true }));
    await runCauseEffect(app.workflows.sweep());
    const still = await runCauseEffect(app.workflows.run(waiting.run.id));
    expect(still.run.status).toBe("approval");
    expect(app.gateOf(still.steps)?.status).toBe("approval");
    expect(app.gateOf(still.steps)?.decisionNote).toBeUndefined();

    // The open run makes the workflow busy; a person ends it, then the next run is decided by itself.
    const gate = app.gateOf(still.steps);
    if (gate) await runCauseEffect(app.workflows.decide({ stepId: gate.id, approved: true }));
    const next = await app.start(id);
    expect(next.run.status).toBe("done");
    expect(app.gateOf(next.steps)?.decisionNote).toBe(NOTE);
  });

  it("stops when it is turned off", async () => {
    const app = await openApp();
    const id = await app.create("Toggled", approvalGraph);
    await runCauseEffect(app.workflows.setAutoApprove({ workflowId: id, enabled: true }));
    expect((await app.start(id)).run.status).toBe("done");

    const off = await runCauseEffect(app.workflows.setAutoApprove({ workflowId: id, enabled: false }));
    expect(off.autoApprove).toBe(false);
    const detail = await app.start(id);
    expect(detail.run.status).toBe("approval");
    expect(app.gateOf(detail.steps)?.decisionNote).toBeUndefined();
  });

  it("still approves in the open run of a paused workflow", async () => {
    const app = await openApp();
    const id = await app.create("Paused", approvalGraph);
    await runCauseEffect(app.workflows.setAutoApprove({ workflowId: id, enabled: true }));
    await runCauseEffect(app.workflows.setPaused({ workflowId: id, paused: true }));
    await runCauseEffect(app.workflows.setAllPaused(true));
    const detail = await app.start(id);
    expect(detail.run.status).toBe("done");
    expect(app.gateOf(detail.steps)?.decisionNote).toBe(NOTE);
    // The pause and Auto-approve are separate flags.
    const summary = (await runCauseEffect(app.workflows.get(id))).summary;
    expect(summary.pausedAt).toBe(START);
    expect(summary.autoApprove).toBe(true);
  });

  it("keeps Auto-approve across graph saves and version restores, and starts a new workflow off", async () => {
    const app = await openApp();
    const id = await app.create("Kept", approvalGraph);
    await runCauseEffect(app.workflows.setAutoApprove({ workflowId: id, enabled: true }));
    const before = await runCauseEffect(app.workflows.get(id));
    const saved = await runCauseEffect(
      app.workflows.saveGraph({ workflowId: id, baseRevision: before.revision, graph: quickGraph }),
    );
    expect(saved.ok).toBe(true);
    expect((await runCauseEffect(app.workflows.get(id))).summary.autoApprove).toBe(true);

    const versions = await runCauseEffect(app.workflows.versions(id));
    const oldest = versions.at(-1);
    expect(oldest).toBeDefined();
    if (oldest) {
      const restored = await runCauseEffect(app.workflows.restoreVersion({ workflowId: id, versionId: oldest.id }));
      expect(restored.summary.autoApprove).toBe(true);
    }
    expect((await runCauseEffect(app.workflows.list())).find((entry) => entry.id === id)?.autoApprove).toBe(true);

    const other = await app.create("New", approvalGraph);
    expect((await runCauseEffect(app.workflows.get(other))).summary.autoApprove).toBe(false);
  });

  it("refuses a workflow that does not exist", async () => {
    const app = await openApp();
    await expect(
      runCauseEffect(app.workflows.setAutoApprove({ workflowId: "missing", enabled: true })),
    ).rejects.toThrow();
  });
});

describe("workflow Reporting run limit", () => {
  it("reads up to the chosen number of finished runs, newest first, beyond the old 50", async () => {
    const app = await openApp();
    const id = await app.create("Often", quickGraph);
    for (let index = 0; index < 120; index++) expect((await app.start(id)).run.status).toBe("done");

    expect((await runCauseEffect(app.workflows.reporting())).runs).toHaveLength(50);
    expect((await runCauseEffect(app.workflows.reporting({ limit: 50 }))).runs).toHaveLength(50);
    const hundred = await runCauseEffect(app.workflows.reporting({ limit: 100 }));
    expect(hundred.runs).toHaveLength(100);
    expect(hundred.totalRuns).toBe(100);
    const all = await runCauseEffect(app.workflows.reporting({ limit: 250 }));
    expect(all.runs).toHaveLength(120);
    expect(all.runs[0]?.runNumber).toBe(120);
  });

  it("takes only the offered limits over IPC, and the default when none is sent", () => {
    expect(parseWorkflowReporting(null)).toEqual({ limit: 50 });
    expect(parseWorkflowReporting(undefined)).toEqual({ limit: 50 });
    expect(parseWorkflowReporting({ limit: 500 })).toEqual({ limit: 500 });
    expect(() => parseWorkflowReporting({ limit: 75 })).toThrow();
    expect(() => parseWorkflowReporting({ limit: 5000 })).toThrow();
  });
});
