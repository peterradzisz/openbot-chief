// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the preload decoders of the fork's workflow requests (pause, Auto-approve, Reporting).
 * Upstream's `preload/index.ts` spreads them into its `workflows` decoders with one line. See docs/FORK.md.
 */

import { isWorkflowReportingSummary, isWorkflowScheduling } from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";
import { decodeWorkflowSummary } from "../workflow-decoding";

export const decodeWorkflowScheduling = guardedDecoder(isWorkflowScheduling, "workflow scheduling response");
export const decodeWorkflowReportingSummary = guardedDecoder(isWorkflowReportingSummary, "workflow reporting response");

export const FORK_WORKFLOW_DECODERS = {
  setPaused: decodeWorkflowSummary,
  setAllPaused: decodeWorkflowScheduling,
  scheduling: decodeWorkflowScheduling,
  setAutoApprove: decodeWorkflowSummary,
  reporting: decodeWorkflowReportingSummary,
};
