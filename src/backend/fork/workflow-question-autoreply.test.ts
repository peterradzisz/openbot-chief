// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
// @vitest-environment node

// Auto-approve answers an agent's question: once with the owner's rule, a second time firmly, never a
// third time, never a secret, never an agent that is not the one running step of an Auto-approve run.

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateOpenBotDatabase } from "../openbot-database-schema";
import { applyForkSchema } from "./fork-schema";
import {
  AUTO_REPLY_FIRM,
  AUTO_REPLY_FIRST,
  type AutoReplyAction,
  planAutoReplies,
  recordReply,
} from "./workflow-question-autoreply";

const NOW = new Date("2026-11-06T22:00:00.000Z");
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  migrateOpenBotDatabase(db, { appliedAt: "2026-11-01T00:00:00.000Z" });
  applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: true });
  return db;
}

let counter = 0;
function addRun(
  db: DatabaseSync,
  options: { workflowId: string; autoApprove: boolean; agentIds: string[]; runStatus?: string },
): string {
  const stamp = "2026-11-06T21:00:00.000Z";
  db.prepare("INSERT OR IGNORE INTO workflows (workflow_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    options.workflowId,
    options.workflowId,
    stamp,
    stamp,
  );
  db.prepare("UPDATE workflows SET auto_approve = ? WHERE workflow_id = ?").run(
    options.autoApprove ? 1 : 0,
    options.workflowId,
  );
  const runId = `run-${++counter}`;
  db.prepare(
    `INSERT INTO workflow_runs (run_id, workflow_id, number, source, idempotency_key, graph_revision, graph_json, status, started_at, updated_at)
     VALUES (?, ?, ?, 'manual', ?, 0, '{}', ?, ?, ?)`,
  ).run(runId, options.workflowId, counter, `key-${counter}`, options.runStatus ?? "running", stamp, stamp);
  for (const agentId of options.agentIds) {
    db.prepare(
      `INSERT INTO workflow_steps (step_id, workflow_id, run_id, node_id, attempt, request_id, kind, agent_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, 'agent', ?, 'running', ?, ?)`,
    ).run(`step-${++counter}`, options.workflowId, runId, `node-${counter}`, `req-${counter}`, agentId, stamp, stamp);
  }
  return runId;
}

const prompt = (requestId: string, agentId: string, secret = false) => ({
  requestId,
  agentId,
  questions: [
    { id: "q0", isSecret: false },
    { id: "q0_custom", isSecret: secret },
  ],
});

function send(db: DatabaseSync, actions: AutoReplyAction[]): void {
  for (const action of actions) recordReply(db, action, NOW);
}

describe("planAutoReplies", () => {
  it("answers nothing for a workflow without Auto-approve", () => {
    const db = database();
    addRun(db, { workflowId: "w", autoApprove: false, agentIds: ["a"] });
    expect(planAutoReplies(db, [prompt("r1", "a")])).toEqual([]);
  });

  it("answers the first question with the owner's rule, for every question page", () => {
    const db = database();
    const runId = addRun(db, { workflowId: "w", autoApprove: true, agentIds: ["a"] });
    const [action] = planAutoReplies(db, [prompt("r1", "a")]);
    expect(action).toMatchObject({ requestId: "r1", runId, kind: "first" });
    expect(action?.answers).toEqual({ q0: [AUTO_REPLY_FIRST], q0_custom: [AUTO_REPLY_FIRST] });
  });

  it("answers the second question of the run firmly, and the third not at all", () => {
    const db = database();
    addRun(db, { workflowId: "w", autoApprove: true, agentIds: ["a"] });
    send(db, planAutoReplies(db, [prompt("r1", "a")]));
    const second = planAutoReplies(db, [prompt("r2", "a")]);
    expect(second.map((action) => action.kind)).toEqual(["firm"]);
    expect(second[0]?.answers.q0).toEqual([AUTO_REPLY_FIRM]);
    send(db, second);
    expect(planAutoReplies(db, [prompt("r3", "a")])).toEqual([]);
  });

  it("never answers a question twice, even after a restart", () => {
    const db = database();
    addRun(db, { workflowId: "w", autoApprove: true, agentIds: ["a"] });
    send(db, planAutoReplies(db, [prompt("r1", "a")]));
    expect(planAutoReplies(db, [prompt("r1", "a")])).toEqual([]);
  });

  it("leaves a prompt with a secret question to the owner", () => {
    const db = database();
    addRun(db, { workflowId: "w", autoApprove: true, agentIds: ["a"] });
    expect(planAutoReplies(db, [prompt("r1", "a", true)])).toEqual([]);
  });

  it("skips an agent that is not a running step of the run, or of two runs", () => {
    const db = database();
    addRun(db, { workflowId: "w", autoApprove: true, agentIds: ["a"] });
    addRun(db, { workflowId: "x", autoApprove: true, agentIds: ["b"] });
    addRun(db, { workflowId: "y", autoApprove: true, agentIds: ["b"] });
    expect(planAutoReplies(db, [prompt("r1", "stranger")])).toEqual([]);
    expect(planAutoReplies(db, [prompt("r2", "b")])).toEqual([]);
  });

  it("ignores a finished run", () => {
    const db = database();
    addRun(db, { workflowId: "w", autoApprove: true, agentIds: ["a"], runStatus: "done" });
    expect(planAutoReplies(db, [prompt("r1", "a")])).toEqual([]);
  });

  it("counts each run on its own", () => {
    const db = database();
    addRun(db, { workflowId: "w", autoApprove: true, agentIds: ["a"] });
    addRun(db, { workflowId: "x", autoApprove: true, agentIds: ["b"] });
    send(db, planAutoReplies(db, [prompt("r1", "a")]));
    const actions = planAutoReplies(db, [prompt("r2", "a"), prompt("r3", "b")]);
    expect(actions.map((action) => [action.requestId, action.kind])).toEqual([
      ["r2", "firm"],
      ["r3", "first"],
    ]);
  });
});
