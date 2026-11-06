// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork-only knobs read from the environment. Upstream files call these through one-line `// FORK:`
 * hooks, so a merge from upstream touches a single line instead of the logic (docs/FORK.md).
 */

/** Upstream's share of a context window at which a thread compacts. */
const UPSTREAM_COMPACTION_THRESHOLD = 0.8;

/**
 * The share of a context window at which a thread compacts. Overridable for private setups whose
 * plans meter tokens harder than the window suggests (owner 2026-11-02: OPENBOT_COMPACTION_THRESHOLD=0.5).
 * Only a finite number in (0, 1] is taken; anything else keeps upstream's 0.8.
 */
export function compactionThreshold(raw: string | undefined = process.env.OPENBOT_COMPACTION_THRESHOLD): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : UPSTREAM_COMPACTION_THRESHOLD;
}
