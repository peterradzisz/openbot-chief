// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { providerResetDelayMs } from "../agent/provider-diagnostics";

/**
 * When a plan window resets, read from the provider's own text ("Your limit will reset at
 * 2026-11-03 00:02:53"), in Unix seconds, or null. z.ai names no zone, so the stamp is read as UTC -
 * its windows are wide enough that the minutes this can miss do not matter (owner 2026-11-02).
 * Upstream's `providerResetDelayMs` reads the relative forms ("resets in 2 hours"); this adds the
 * absolute one and falls back to the relative one. Called from turn-lifecycle.ts through a `// FORK:` hook.
 */
export function planLimitResetsAt(message: string): number | null {
  const match = /\blimit will reset at (\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\b/iu.exec(message);
  if (match) {
    const at = Date.parse(`${match[1]}T${match[2]}Z`);
    return Number.isFinite(at) ? Math.floor(at / 1000) : null;
  }
  const delay = providerResetDelayMs(message);
  return delay === null ? null : Math.floor((Date.now() + delay) / 1000);
}
