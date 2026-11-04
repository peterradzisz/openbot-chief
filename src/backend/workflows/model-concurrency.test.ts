import type { SeatsState } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";

describe("model concurrency budgets & backup failover", () => {
  const seatsState: SeatsState = {
    seats: [
      {
        id: "builder",
        name: "Builder",
        kind: "failover",
        rungs: [
          { provider: "antigravity", model: "gemini-3.8-flash" },
          { provider: "opencode", model: "zai-coding-plan/glm-5.3" },
          { provider: "claude", model: "claude-sonnet-5-5" },
        ],
      },
    ],
    budgets: {
      "antigravity:gemini-3.8-flash": 2,
      "opencode:zai-coding-plan/glm-5.3": 3,
      "claude:claude-sonnet-5-5": 1,
    },
    enabledBudgets: {
      "antigravity:gemini-3.8-flash": true,
      "opencode:zai-coding-plan/glm-5.3": true,
      "claude:claude-sonnet-5-5": true,
    },
    outputCaps: {},
    enabledOutputCaps: {},
    modelEfforts: {},
    bindings: {
      builder: ["Builder 1", "Builder 2", "Builder 3"],
    },
    presets: [],
  };

  function checkIsModelAtBudget(
    provider: string,
    model: string,
    activeAgents: { provider: string; model: string }[],
    state: SeatsState,
  ): boolean {
    if (!state.budgets) return false;
    const fullKey = `${provider}:${model}`;
    const b1 = state.budgets[fullKey];
    const b2 = state.budgets[model];
    const budget =
      state.enabledBudgets?.[fullKey] !== false && typeof b1 === "number"
        ? b1
        : state.enabledBudgets?.[model] !== false && typeof b2 === "number"
          ? b2
          : null;
    if (budget === null || budget < 0) return false;

    let count = 0;
    for (const agent of activeAgents) {
      if (
        (agent.provider === provider && agent.model === model) ||
        agent.model === model ||
        `${agent.provider}:${agent.model}` === fullKey
      ) {
        count++;
      }
    }
    return count >= budget;
  }

  function findBackup(
    agent: {
      id: string;
      name: string;
      provider: string;
      model: string;
      backupModels?: { order: { provider: string; model: string }[] };
    },
    activeAgents: { provider: string; model: string }[],
    state: SeatsState,
  ) {
    const candidates: { provider: string; model: string }[] = [];
    if (agent.backupModels?.order && agent.backupModels.order.length > 0) {
      candidates.push(...agent.backupModels.order);
    }
    if (candidates.length === 0 && state.bindings) {
      for (const [seatId, agentNames] of Object.entries(state.bindings)) {
        if (agentNames.includes(agent.name) || agentNames.includes(agent.id)) {
          const seat = state.seats.find((s) => s.id === seatId || s.name.toLowerCase() === seatId.toLowerCase());
          if (seat) {
            for (const rung of seat.rungs) {
              candidates.push({ provider: rung.provider, model: rung.model });
            }
          }
        }
      }
    }
    for (const choice of candidates) {
      if (
        (choice.provider === agent.provider && choice.model === agent.model) ||
        (choice.model === agent.model && !choice.provider)
      ) {
        continue;
      }
      if (!checkIsModelAtBudget(choice.provider, choice.model, activeAgents, state)) {
        return choice;
      }
    }
    return null;
  }

  it("detects when a model is below its concurrency budget", () => {
    const active = [{ provider: "antigravity", model: "gemini-3.8-flash" }];
    const atBudget = checkIsModelAtBudget("antigravity", "gemini-3.8-flash", active, seatsState);
    expect(atBudget).toBe(false);
  });

  it("detects when a model reaches or exceeds its concurrency budget", () => {
    const active = [
      { provider: "antigravity", model: "gemini-3.8-flash" },
      { provider: "antigravity", model: "gemini-3.8-flash" },
    ];
    const atBudget = checkIsModelAtBudget("antigravity", "gemini-3.8-flash", active, seatsState);
    expect(atBudget).toBe(true);
  });

  it("finds next available backup when primary model is at concurrency budget", () => {
    const active = [
      { provider: "antigravity", model: "gemini-3.8-flash" },
      { provider: "antigravity", model: "gemini-3.8-flash" },
    ];
    const agent = {
      id: "builder-1",
      name: "Builder 1",
      provider: "antigravity",
      model: "gemini-3.8-flash",
      backupModels: {
        order: [
          { provider: "antigravity", model: "gemini-3.8-flash" },
          { provider: "opencode", model: "zai-coding-plan/glm-5.3" },
          { provider: "claude", model: "claude-sonnet-5-5" },
        ],
      },
    };

    const backup = findBackup(agent, active, seatsState);
    expect(backup).toEqual({ provider: "opencode", model: "zai-coding-plan/glm-5.3" });
  });

  it("skips backup models that are also at their concurrency budget", () => {
    const active = [
      { provider: "antigravity", model: "gemini-3.8-flash" },
      { provider: "antigravity", model: "gemini-3.8-flash" },
      { provider: "opencode", model: "zai-coding-plan/glm-5.3" },
      { provider: "opencode", model: "zai-coding-plan/glm-5.3" },
      { provider: "opencode", model: "zai-coding-plan/glm-5.3" },
    ];
    const agent = {
      id: "builder-1",
      name: "Builder 1",
      provider: "antigravity",
      model: "gemini-3.8-flash",
      backupModels: {
        order: [
          { provider: "opencode", model: "zai-coding-plan/glm-5.3" },
          { provider: "claude", model: "claude-sonnet-5-5" },
        ],
      },
    };

    const backup = findBackup(agent, active, seatsState);
    expect(backup).toEqual({ provider: "claude", model: "claude-sonnet-5-5" });
  });

  it("falls back to seat rungs if backupModels.order is missing", () => {
    const active = [
      { provider: "antigravity", model: "gemini-3.8-flash" },
      { provider: "antigravity", model: "gemini-3.8-flash" },
    ];
    const agent = {
      id: "builder-2",
      name: "Builder 2",
      provider: "antigravity",
      model: "gemini-3.8-flash",
    };

    const backup = findBackup(agent, active, seatsState);
    expect(backup).toEqual({ provider: "opencode", model: "zai-coding-plan/glm-5.3" });
  });

  it("returns null when all candidate backups are full", () => {
    const active = [
      { provider: "antigravity", model: "gemini-3.8-flash" },
      { provider: "antigravity", model: "gemini-3.8-flash" },
      { provider: "opencode", model: "zai-coding-plan/glm-5.3" },
      { provider: "opencode", model: "zai-coding-plan/glm-5.3" },
      { provider: "opencode", model: "zai-coding-plan/glm-5.3" },
      { provider: "claude", model: "claude-sonnet-5-5" },
    ];
    const agent = {
      id: "builder-1",
      name: "Builder 1",
      provider: "antigravity",
      model: "gemini-3.8-flash",
      backupModels: {
        order: [
          { provider: "opencode", model: "zai-coding-plan/glm-5.3" },
          { provider: "claude", model: "claude-sonnet-5-5" },
        ],
      },
    };

    const backup = findBackup(agent, active, seatsState);
    expect(backup).toBeNull();
  });
});
