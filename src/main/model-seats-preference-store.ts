// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { isSeatsState, type SeatsState } from "@openbot/contracts/ipc";
import { PreferenceStore } from "./preference-file";

export const MODEL_SEATS_PREFERENCE_FILE = "openbot-model-seats-v1.json";

export function defaultSeatsState(): SeatsState {
  return {
    seats: [
      { id: "builder", name: "Builder", kind: "failover", defaultEffort: "high", rungs: [] },
      { id: "intake", name: "Intake", kind: "failover", defaultEffort: "low", rungs: [] },
      { id: "planners", name: "Planners", kind: "failover", defaultEffort: "high", rungs: [] },
      { id: "judge", name: "Judge", kind: "escalation", defaultEffort: "medium", rungs: [] },
      { id: "lastResort", name: "Last resort", kind: "failover", defaultEffort: "low", rungs: [] },
    ],
    budgets: {},
    enabledBudgets: {},
    outputCaps: {},
    enabledOutputCaps: {},
    modelEfforts: {},
    bindings: {
      builder: ["Builder 1", "Builder 2", "Builder 3", "Builder 4", "Builder 5", "Builder 6"],
      intake: ["Intake 1", "Intake 2"],
      planners: ["Planner 1", "Planner 2", "Planner 3", "Planner 4", "Planner Opus", "Planner Opus 2"],
      judge: ["Judge 1", "Judge 2", "Judge 3", "Judge 4"],
      lastResort: ["Digest Clerk"],
    },
    presets: [],
  };
}

export type ModelSeatsPreferenceStore = PreferenceStore<SeatsState>;

export function createModelSeatsPreferenceStore(path: string): ModelSeatsPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: defaultSeatsState(),
    decode: (parsed) => {
      if (!isSeatsState(parsed)) return null;
      return parsed;
    },
  });
}
