// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: Auto-approve answers an agent's question.
 *
 * An approval step is not the only thing that stalls an unattended run: an agent can also ask the owner
 * a question (its question tool), and then the run waits for a person all night. A workflow with
 * Auto-approve on answers such a question itself, once, with the owner's standing rule. If the same run asks
 * again, the second answer is firm: no more questions, write the problem in a CI comment and stop. A third
 * question is left to the owner. Nothing loops, and every reply is written to `workflow_auto_replies`.
 *
 * Never answered: a prompt with a secret question (a password, a key), a prompt of an agent that is not
 * the one running step of an Auto-approve run, and a question that was answered before.
 */

import type { DatabaseSync } from "node:sqlite";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

/** The owner's standing rule, from #505: decide, find out, or note the problem in the CI and stop. */
export const AUTO_REPLY_FIRST =
  "You know what should be best for the project: decide it yourself and carry on. If you are not sure, take " +
  "action to find out (a short discovery in the code, the docs and the issue). If you are still unsure after " +
  "that, write the problem in a CI comment (up to 500 characters) and stop your work.";

/** The second question of one run: it must not keep asking. */
export const AUTO_REPLY_FIRM =
  "No more questions in this run. Write the open problem in a CI comment (up to 500 characters) and stop your " +
  "work now. Commit what you have; do not push unfinished work.";

export const AUTO_REPLY_LIMIT = 2;

/** The part of a pending prompt the fork reads (`AgentRuntimeSnapshot["pendingPrompts"][number]`). */
export interface PendingPromptLike {
  requestId: string | number;
  agentId: string;
  questions: readonly { id: string; isSecret?: boolean }[];
}

export interface AutoReplyRun {
  runId: string;
  workflowId: string;
}

export interface AutoReplyAction {
  requestId: string | number;
  runId: string;
  kind: "first" | "firm";
  answers: Record<string, string[]>;
}

/**
 * The agent of every open step of an Auto-approve run. An agent with more than one such step is left out:
 * the question could belong to either run.
 */
export function autoApproveRunsByAgent(db: DatabaseSync): Map<string, AutoReplyRun> {
  const rows = db
    .prepare(
      `SELECT s.agent_id AS agent_id, r.run_id AS run_id, r.workflow_id AS workflow_id
       FROM workflow_steps s
       JOIN workflow_runs r ON r.run_id = s.run_id
       JOIN workflows w ON w.workflow_id = r.workflow_id
       WHERE s.status = 'running' AND r.status = 'running' AND w.auto_approve = 1 AND s.agent_id IS NOT NULL`,
    )
    .all();
  const byAgent = new Map<string, AutoReplyRun>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    if (!isDynamicRecord(row) || typeof row.agent_id !== "string") continue;
    if (byAgent.has(row.agent_id)) ambiguous.add(row.agent_id);
    byAgent.set(row.agent_id, { runId: String(row.run_id), workflowId: String(row.workflow_id) });
  }
  for (const agentId of ambiguous) byAgent.delete(agentId);
  return byAgent;
}

/** Whether any workflow has Auto-approve on, a cheap check before the snapshot is read. */
export function anyAutoApprove(db: DatabaseSync): boolean {
  return Boolean(db.prepare("SELECT 1 FROM workflows WHERE auto_approve = 1 LIMIT 1").get());
}

function replyCounts(db: DatabaseSync, runIds: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const query = db.prepare("SELECT COUNT(*) AS n FROM workflow_auto_replies WHERE run_id = ?");
  for (const runId of runIds) {
    const row = query.get(runId);
    counts.set(runId, isDynamicRecord(row) ? Number(row.n) : 0);
  }
  return counts;
}

function alreadyAnswered(db: DatabaseSync, requestId: string | number): boolean {
  return Boolean(db.prepare("SELECT 1 FROM workflow_auto_replies WHERE request_id = ?").get(String(requestId)));
}

/** Every question gets the text (a companion "other" page of the same question gets it too). */
export function replyAnswers(questions: PendingPromptLike["questions"], text: string): Record<string, string[]> {
  return Object.fromEntries(questions.map((question) => [question.id, [text]]));
}

/** What to answer now. Pure over the database reads; the caller sends it and then calls `recordReply`. */
export function planAutoReplies(db: DatabaseSync, prompts: readonly PendingPromptLike[]): AutoReplyAction[] {
  if (prompts.length === 0) return [];
  const runs = autoApproveRunsByAgent(db);
  const mine = prompts.filter((prompt) => runs.has(prompt.agentId));
  if (mine.length === 0) return [];
  const counts = replyCounts(db, [...new Set(mine.map((prompt) => runs.get(prompt.agentId)?.runId ?? ""))]);
  const actions: AutoReplyAction[] = [];
  for (const prompt of mine) {
    const run = runs.get(prompt.agentId);
    if (!run) continue;
    if (prompt.questions.some((question) => question.isSecret)) continue;
    if (alreadyAnswered(db, prompt.requestId)) continue;
    const used = counts.get(run.runId) ?? 0;
    if (used >= AUTO_REPLY_LIMIT) continue; // a third question is the owner's
    const kind = used === 0 ? "first" : "firm";
    counts.set(run.runId, used + 1);
    actions.push({
      requestId: prompt.requestId,
      runId: run.runId,
      kind,
      answers: replyAnswers(prompt.questions, kind === "first" ? AUTO_REPLY_FIRST : AUTO_REPLY_FIRM),
    });
  }
  return actions;
}

export function recordReply(db: DatabaseSync, action: AutoReplyAction, now: Date): void {
  db.prepare(
    "INSERT OR IGNORE INTO workflow_auto_replies (request_id, run_id, kind, replied_at) VALUES (?, ?, ?, ?)",
  ).run(String(action.requestId), action.runId, action.kind, now.toISOString());
}

export interface QuestionAutoReplyOptions {
  database: () => DatabaseSync;
  pendingPrompts: () => readonly PendingPromptLike[];
  respond: (input: { requestId: string | number; answers: Record<string, string[]> }) => Promise<void>;
  log: (message: string) => void;
  now?: () => Date;
  intervalMs?: number;
}

/** Polls for open questions of Auto-approve runs. Returns the stop function. One pass at a time. */
export function startQuestionAutoReply(options: QuestionAutoReplyOptions): () => void {
  const now = options.now ?? (() => new Date());
  let busy = false;
  const pass = async () => {
    if (busy) return;
    busy = true;
    try {
      const db = options.database();
      if (!anyAutoApprove(db)) return;
      for (const action of planAutoReplies(db, options.pendingPrompts())) {
        // Recorded first: if the send fails the question stays open for the owner, and nothing is sent twice.
        recordReply(db, action, now());
        await options.respond({ requestId: action.requestId, answers: action.answers });
        options.log(`Auto-approve answered a question of run ${action.runId} (${action.kind}).`);
      }
    } catch (error) {
      options.log(
        `Auto-approve could not answer a question: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void pass(), options.intervalMs ?? 5000);
  timer.unref?.();
  return () => clearInterval(timer);
}
