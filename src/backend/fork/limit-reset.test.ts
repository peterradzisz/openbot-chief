// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { describe, expect, it } from "vitest";
import { isPlanLimitDiagnostic } from "../agent/provider-diagnostics";
import { planLimitResetsAt } from "./limit-reset";
import { forkBalanceNamesReset, isForkPlanLimitText } from "./plan-limit-text";

describe("planLimitResetsAt", () => {
  it("reads z.ai's absolute reset as UTC", () => {
    const message = "Usage limit reached for 5 hour. Your limit will reset at 2026-11-03 00:02:53";
    expect(planLimitResetsAt(message)).toBe(Date.parse("2026-11-03T00:02:53Z") / 1000);
  });

  it("falls back to a relative reset", () => {
    const before = Math.floor(Date.now() / 1000);
    const at = planLimitResetsAt("Your limit will reset in 2 hours.");
    expect(at).not.toBeNull();
    expect(at ?? 0).toBeGreaterThanOrEqual(before + 7200);
    expect(at ?? 0).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 7200);
  });

  it("is null when no reset is named", () => {
    expect(planLimitResetsAt("Go usage limit exceeded")).toBeNull();
  });
});

describe("fork plan-limit wordings", () => {
  const tokenPlan =
    "Token Plan usage limit reached: Upgrade your Token Plan or purchase Credits for more usage. (2056)";
  const gemini = "You have reached your current quota for this period. Your limit will reset in 2 hours, 52 minutes.";

  it("reads MiniMax's Token Plan limit as a plan window although it names Credits", () => {
    expect(forkBalanceNamesReset(tokenPlan)).toBe(true);
    expect(isForkPlanLimitText(tokenPlan)).toBe(true);
    expect(isPlanLimitDiagnostic(tokenPlan)).toBe(true);
  });

  it("reads Gemini's spent period quota with a reset as a plan window", () => {
    expect(forkBalanceNamesReset(gemini)).toBe(true);
    expect(isPlanLimitDiagnostic(gemini)).toBe(true);
  });

  it("keeps a spent balance that names no reset out", () => {
    expect(isPlanLimitDiagnostic("Insufficient credits. Add credits to continue.")).toBe(false);
    expect(isPlanLimitDiagnostic("You exceeded your current quota, please check your billing details.")).toBe(false);
  });
});
