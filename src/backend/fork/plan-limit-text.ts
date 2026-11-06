// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork-only plan-limit wordings that upstream's `isPlanLimitDiagnostic`
 * (src/backend/agent/provider-diagnostics.ts) does not know yet. Upstream calls these through two
 * `// FORK:` hooks. This file imports nothing, so provider-diagnostics can import it without a cycle.
 */

/**
 * MiniMax coding plan (via OpenCode): "Token Plan usage limit reached: Upgrade your Token Plan or
 * purchase Credits for more usage. (2056)" - names Credits like a balance would, but it is the plan
 * window: it clears when the interval resets (owner 2026-11-02, seen draining the 4-hour interval
 * while backup chains stayed untouched because this read as a spent balance).
 */
const MINIMAX_TOKEN_PLAN = /\bToken Plan usage limit reached\b/iu;

/**
 * Whether a text that names credits or a quota still names a reset, so it is a plan window and not a
 * spent balance. Google / Gemini ACP reports: "You have reached your current quota for this period.
 * Your limit will reset in 2 hours, 52 minutes." Upstream already exempts Codex's "try again at".
 */
export function forkBalanceNamesReset(message: string): boolean {
  return MINIMAX_TOKEN_PLAN.test(message) || /\b(?:limit will reset in|resets? in \d+)\b/iu.test(message);
}

/** Whether a provider's text is a plan window in one of the fork's extra wordings. */
export function isForkPlanLimitText(message: string): boolean {
  return (
    MINIMAX_TOKEN_PLAN.test(message) ||
    /\breached your current quota for this period\b/iu.test(message) ||
    /\blimit will reset in \d+\b/iu.test(message)
  );
}
