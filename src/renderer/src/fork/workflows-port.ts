// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the desktop port of the fork's workflow requests (pause, Auto-approve, Reporting), bound
 * to one server. Upstream's `features/workflows/workflows-port.ts` spreads them into its `workflows`
 * methods with one line. See docs/FORK.md.
 */

import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

type WorkflowsApi = OpenBotDesktopApi["workflows"];

/** `api` is read on each call: tests and stories replace `window.openbot` per case. */
export function forkWorkflowsPort(api: () => WorkflowsApi, serverId: string) {
  return {
    setPaused: (input: Parameters<WorkflowsApi["setPaused"]>[0]) => api().setPaused(input, serverId),
    setAllPaused: (paused: boolean) => api().setAllPaused(paused, serverId),
    scheduling: () => api().scheduling(serverId),
    setAutoApprove: (input: Parameters<WorkflowsApi["setAutoApprove"]>[0]) => api().setAutoApprove(input, serverId),
    reporting: (input: Parameters<WorkflowsApi["reporting"]>[0]) => api().reporting(input, serverId),
  };
}
