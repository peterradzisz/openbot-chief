import { describe, expect, it } from "vitest";
import {
  computeSeatMoves,
  defaultBindings,
  defaultSeats,
  formatOutputCapPrompt,
  getModelEffort,
  type SeatsState,
  seatModelKey,
} from "./model-seats";

describe("model-seats", () => {
  it("initializes with default seats and bindings", () => {
    const seats = defaultSeats();
    expect(seats.length).toBe(5);
    expect(seats.map((s) => s.id)).toEqual(["builder", "intake", "planners", "judge", "lastResort"]);
    expect(seats.find((s) => s.id === "builder")?.defaultEffort).toBe("high");
    expect(seats.find((s) => s.id === "intake")?.defaultEffort).toBe("low");
    expect(seats.find((s) => s.id === "planners")?.defaultEffort).toBe("high");
    expect(seats.find((s) => s.id === "judge")?.defaultEffort).toBe("medium");
    expect(seats.find((s) => s.id === "lastResort")?.defaultEffort).toBe("low");

    const bindings = defaultBindings();
    expect(bindings.builder?.length ?? 0).toBeGreaterThan(0);
    expect(bindings.builder).toContain("Builder 2");
    expect(bindings.planners).toContain("Planner 1");
  });

  it("formats output cap prompts correctly", () => {
    expect(formatOutputCapPrompt(16000)).toContain("max 16k tokens");
    expect(formatOutputCapPrompt(8000)).toContain("max 8k tokens");
    expect(formatOutputCapPrompt(0)).toContain("max 16k tokens"); // default
  });

  it("builds consistent seatModelKey", () => {
    expect(seatModelKey({ provider: "opencode", model: "glm-5.3" })).toBe("opencode:glm-5.3");
    expect(seatModelKey({ provider: "anthropic", model: "claude-3-7-sonnet" })).toBe("anthropic:claude-3-7-sonnet");
  });

  it("resolves model sweet-spot defaults via getModelEffort", () => {
    const emptyState: SeatsState = {
      seats: defaultSeats(),
      budgets: {},
      enabledBudgets: {},
      outputCaps: {},
      enabledOutputCaps: {},
      modelEfforts: {},
      bindings: defaultBindings(),
      presets: [],
    };

    // Auto sweet-spot inference
    expect(getModelEffort(emptyState, "anthropic:claude-3-7-sonnet")).toBe("high");
    expect(getModelEffort(emptyState, "google:gemini-3.8-flash")).toBe("high");
    expect(getModelEffort(emptyState, "anthropic:claude-3-opus")).toBe("medium");
    expect(getModelEffort(emptyState, "codex:argon-coder")).toBe("low");
    expect(getModelEffort(emptyState, "opencode:glm-5.3")).toBe("default");

    // Explicit user override in modelEfforts
    const stateWithOverrides: SeatsState = {
      ...emptyState,
      modelEfforts: {
        "opencode:glm-5.3": "low",
        "anthropic:claude-3-7-sonnet": "medium",
      },
    };
    expect(getModelEffort(stateWithOverrides, "opencode:glm-5.3")).toBe("low");
    expect(getModelEffort(stateWithOverrides, "anthropic:claude-3-7-sonnet")).toBe("medium");
  });

  it("computes fail-forward backup order for judge escalation seat", () => {
    const seats = defaultSeats();
    const agents = [
      { id: "a1", name: "Judge 1" },
      { id: "a2", name: "Judge 2" },
      { id: "a3", name: "Judge 3" },
      { id: "a4", name: "Judge 4" },
    ];
    const moves = computeSeatMoves(
      {
        seats,
        budgets: {},
        enabledBudgets: {},
        outputCaps: {},
        enabledOutputCaps: {},
        modelEfforts: {},
        bindings: defaultBindings(),
        presets: [],
      },
      agents,
    );

    const judge1 = moves.find((m) => m.name === "Judge 1");
    expect(judge1?.model).toBe("claude-sonnet-5-5");
    expect(judge1?.backups.map((b) => b.model)).toEqual([
      "claude-opus-4-6",
      "claude-fable-5-1",
      "zai-coding-plan/glm-5.3",
      "gemini-3.8-flash",
    ]);

    const judge3 = moves.find((m) => m.name === "Judge 3");
    expect(judge3?.model).toBe("zai-coding-plan/glm-5.3");
    expect(judge3?.backups[0]?.model).toBe("gemini-3.8-flash");
  });
});
