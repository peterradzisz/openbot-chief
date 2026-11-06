// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the Team API routes of the fork's workflow requests (pause, Auto-approve). Upstream's
 * `team-api/route-workflows.ts` asks this module first, before its own routes, and hands over its
 * checks: `usableDetail` (the member's access to a workflow), `run` and `parse`. See docs/FORK.md.
 */

import type { AgentAccessLevel } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import type { Effect } from "effect";
import {
  parseSetWorkflowAutoApprove,
  parseSetWorkflowPaused,
  parseWorkflowsPaused,
} from "../../backend/fork/workflow-fork-inputs";
import type { TeamApiWorkflows } from "../team-api/dependencies";
import type { RouteOutcome, TeamApiRequestContext } from "../team-api/request-context";
import { requireAdmin } from "../team-api/request-helpers";

/** The workflow methods the Team API takes for the fork's routes (`TeamApiWorkflows` adds them). */
export type ForkTeamApiWorkflowMethods = "setPaused" | "setAllPaused" | "scheduling" | "setAutoApprove";

export interface ForkWorkflowRouteContext {
  member: TeamApiRequestContext["member"];
  json: TeamApiRequestContext["json"];
  workflows: Pick<TeamApiWorkflows, ForkTeamApiWorkflowMethods>;
  /** The workflow, when the member can read it and use it at `level`; otherwise it throws as missing. */
  usableDetail: (workflowId: string, level: Exclude<AgentAccessLevel, "none">) => Promise<unknown>;
  run: <A>(operation: Effect.Effect<A, { readonly cause: unknown }>) => Promise<A>;
  parse: <A>(decode: (value: unknown) => A, body: unknown) => A;
}

/** The answer of a fork route, or undefined when `path` is not one. */
export async function routeForkWorkflows(
  path: string,
  body: unknown,
  { member, json, workflows, usableDetail, run, parse }: ForkWorkflowRouteContext,
): Promise<RouteOutcome | undefined> {
  switch (path) {
    case WORKFLOWS_ROUTES.setPaused: {
      // A pause changes when the workflow runs, as a change of its triggers does.
      const input = parse(parseSetWorkflowPaused, body);
      await usableDetail(input.workflowId, "manage");
      return json(200, await run(workflows.setPaused(input)));
    }
    case WORKFLOWS_ROUTES.setAllPaused: {
      // Every workflow of the host, also ones the member cannot read, so only an owner or admin.
      requireAdmin(member);
      const paused = parse(parseWorkflowsPaused, isDynamicRecord(body) ? body.paused : undefined);
      return json(200, await run(workflows.setAllPaused(paused)));
    }
    case WORKFLOWS_ROUTES.scheduling:
      return json(200, await run(workflows.scheduling()));
    case WORKFLOWS_ROUTES.setAutoApprove: {
      // Auto-approve decides the workflow's approvals, so it takes the rights to manage it.
      const input = parse(parseSetWorkflowAutoApprove, body);
      await usableDetail(input.workflowId, "manage");
      return json(200, await run(workflows.setAutoApprove(input)));
    }
  }
  return undefined;
}
