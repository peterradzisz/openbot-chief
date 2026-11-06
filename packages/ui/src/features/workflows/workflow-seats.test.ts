// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { describe, expect, it } from "vitest";
import { type ModelSeat, resolveSeatChoice, type SeatCatalogs, type SeatsState } from "./workflow-seats";

describe("workflow-seats resolution", () => {
  const dummyCatalogs: SeatCatalogs = {
    agents: [
      { id: "agent-1", name: "GLM Build 1", model: "glm-5.3", provider: "opencode" },
      { id: "agent-2", name: "Gemini Intake", model: "gemini-3.8-flash", provider: "google" },
      { id: "agent-3", name: "Sonnet Reviewer", model: "claude-3-7-sonnet", provider: "anthropic" },
    ],
    models: [
      { id: "glm-5.3", name: "GLM 5.3", provider: "opencode" },
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", provider: "google" },
    ],
  };

  it("prioritizes rung-level effort over seat-level default and model budget", () => {
    const builderSeat: ModelSeat = {
      id: "builder",
      name: "Builder",
      kind: "failover",
      defaultEffort: "high",
      rungs: [{ provider: "google", model: "gemini-3.8-flash", effort: "low" }],
    };
    const state: SeatsState = {
      seats: [builderSeat],
      budgets: {},
      enabledBudgets: {},
      outputCaps: {},
      enabledOutputCaps: {},
      modelEfforts: { "google:gemini-3.8-flash": "high" },
      bindings: { builder: ["Gemini Intake"] },
      presets: [],
    };

    const choice = resolveSeatChoice({
      seatId: "builder",
      seatRung: "auto",
      catalogs: dummyCatalogs,
      state,
    });

    // Rung explicitly specifies "low", which overrides seat "high" and model budget "high"
    expect(choice.defaultEffort).toBe("low");
  });

  it("uses seat-level default when rung has default or no effort specified", () => {
    const intakeSeat: ModelSeat = {
      id: "intake",
      name: "Intake",
      kind: "failover",
      defaultEffort: "low",
      rungs: [{ provider: "google", model: "gemini-3.8-flash", effort: "default" }],
    };
    const state: SeatsState = {
      seats: [intakeSeat],
      budgets: {},
      enabledBudgets: {},
      outputCaps: {},
      enabledOutputCaps: {},
      modelEfforts: {}, // Gemini sweet spot would otherwise be "high"
      bindings: { intake: ["Gemini Intake"] },
      presets: [],
    };

    const choice = resolveSeatChoice({
      seatId: "intake",
      seatRung: "auto",
      catalogs: dummyCatalogs,
      state,
    });

    // Seat default is "low", which overrides Gemini 3.8 Flash sweet spot ("high")
    expect(choice.defaultEffort).toBe("low");
  });

  it("falls back to model budget and sweet-spot when seat default is 'default'", () => {
    const neutralSeat: ModelSeat = {
      id: "neutral",
      name: "Neutral",
      kind: "failover",
      defaultEffort: "default",
      rungs: [{ provider: "google", model: "gemini-3.8-flash" }],
    };
    const state: SeatsState = {
      seats: [neutralSeat],
      budgets: {},
      enabledBudgets: {},
      outputCaps: {},
      enabledOutputCaps: {},
      modelEfforts: {},
      bindings: { neutral: ["Gemini Intake"] },
      presets: [],
    };

    const choice = resolveSeatChoice({
      seatId: "neutral",
      seatRung: "auto",
      catalogs: dummyCatalogs,
      state,
    });

    // Flash sweet spot is "high"
    expect(choice.defaultEffort).toBe("high");
  });
});
