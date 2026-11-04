import { isDynamicRecord } from "./runtime-values";

export type SeatReasoningEffort = "default" | "none" | "low" | "medium" | "high";

export interface SeatRung {
  provider: string;
  model: string;
  effort?: SeatReasoningEffort;
}

export interface ModelSeat {
  id: string;
  name: string;
  kind: "failover" | "escalation";
  defaultEffort?: SeatReasoningEffort;
  rungs: SeatRung[];
}

export interface SeatPreset {
  name: string;
  seats: ModelSeat[];
}

export interface SeatsState {
  seats: ModelSeat[];
  budgets: Record<string, number>;
  enabledBudgets: Record<string, boolean>;
  outputCaps: Record<string, number>;
  enabledOutputCaps: Record<string, boolean>;
  modelEfforts: Record<string, SeatReasoningEffort>;
  bindings: Record<string, string[]>;
  presets: SeatPreset[];
}

export function isSeatsState(value: unknown): value is SeatsState {
  if (!isDynamicRecord(value)) return false;
  return (
    Array.isArray(value.seats) &&
    typeof value.budgets === "object" &&
    value.budgets !== null &&
    typeof value.bindings === "object" &&
    value.bindings !== null
  );
}
