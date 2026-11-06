// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: the joined-server decoding of the fork's workflow fields and answers. Upstream's
 * `workflow-decoding.ts` re-exports this module and wraps its summary map with `withForkSummaryDefaults`,
 * one line each. See docs/FORK.md.
 */

import { isWorkflowScheduling, WORKFLOW_PAUSE_REASONS } from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

/**
 * A summary map with the fork's defaults: a host from before the workflow pause sends no `pausedAt`,
 * so its workflows read as not paused; a host from before Auto-approve sends no `autoApprove`: off.
 */
export function withForkSummaryDefaults(map: (value: unknown) => unknown) {
  return (value: unknown): unknown => {
    const record = map(value);
    if (!isDynamicRecord(record)) return record;
    const pausedOnly = record.pausedAt === undefined ? { ...record, pausedAt: null } : record;
    return pausedOnly.autoApprove === undefined ? { ...pausedOnly, autoApprove: false } : pausedOnly;
  };
}

const decodeScheduling = guardedDecoder(isWorkflowScheduling, "remote workflow scheduling");

// A host from before the upgrade pause sends no reason and no version, and a newer host may send a
// reason that this app does not know: each reads as null, so the banner shows the plain pause.
export function decodeRemoteWorkflowScheduling(value: unknown) {
  return decodeScheduling(
    isDynamicRecord(value)
      ? {
          ...value,
          pausedReason: isOneOf(WORKFLOW_PAUSE_REASONS, value.pausedReason) ? value.pausedReason : null,
          upgradeVersion: isString(value.upgradeVersion) ? value.upgradeVersion : null,
        }
      : value,
  );
}
