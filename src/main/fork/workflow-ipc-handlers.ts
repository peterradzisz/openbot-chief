// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the IPC handlers of the fork's workflow requests (pause, Auto-approve, Reporting).
 * Upstream's `ipc/workflow-handlers.ts` spreads them into its `workflows` group with one line, and
 * hands over its `remote` call to a joined server. See docs/FORK.md.
 */

import { WORKFLOWS_ROUTES } from "@openbot/contracts/team-protocol/workflows-v1";
import { decodeRemoteWorkflowScheduling, decodeRemoteWorkflowSummary } from "@openbot/team-client/workflow-decoding";
import { runCauseEffect } from "../../backend/effect-boundary";
import {
  parseSetWorkflowAutoApprove,
  parseSetWorkflowPaused,
  parseWorkflowReporting,
  parseWorkflowsPaused,
} from "../../backend/fork/workflow-fork-inputs";
import type { WorkflowsHandle } from "../../backend/workflows/workflows";
import { scopedHandler, scopedQueryHandler } from "../ipc/scoped-handler";
import type { ResponseDecoder } from "../remote-host-decoding";

/** `remote` of `workflowIpcHandlers`: a `workflows-v1` route of a joined server. */
type RemoteWorkflowCall = <T>(serverId: string, path: string, decoder: ResponseDecoder<T>, body: unknown) => Promise<T>;

export function forkWorkflowIpcHandlers(workflows: WorkflowsHandle, remote: RemoteWorkflowCall) {
  return {
    setPaused: scopedHandler(parseSetWorkflowPaused, {
      local: (input) => runCauseEffect(workflows.setPaused(input)),
      remote: (input, serverId) => remote(serverId, WORKFLOWS_ROUTES.setPaused, decodeRemoteWorkflowSummary, input),
    }),
    setAllPaused: scopedHandler(parseWorkflowsPaused, {
      local: (paused) => runCauseEffect(workflows.setAllPaused(paused)),
      remote: (paused, serverId) =>
        remote(serverId, WORKFLOWS_ROUTES.setAllPaused, decodeRemoteWorkflowScheduling, { paused }),
    }),
    scheduling: scopedQueryHandler({
      local: () => runCauseEffect(workflows.scheduling()),
      remote: (serverId) => remote(serverId, WORKFLOWS_ROUTES.scheduling, decodeRemoteWorkflowScheduling, {}),
    }),
    // Auto-approve.
    setAutoApprove: scopedHandler(parseSetWorkflowAutoApprove, {
      local: (input) => runCauseEffect(workflows.setAutoApprove(input)),
      remote: (input, serverId) =>
        remote(serverId, WORKFLOWS_ROUTES.setAutoApprove, decodeRemoteWorkflowSummary, input),
    }),
    // Reporting reads this computer only; a joined server answers an empty report.
    reporting: scopedHandler(parseWorkflowReporting, {
      local: (input) => runCauseEffect(workflows.reporting(input)),
      remote: () =>
        Promise.resolve({
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
    }),
  };
}
