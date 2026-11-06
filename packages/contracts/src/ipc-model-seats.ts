// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import type { ProviderTimeOff } from "./fork/provider-time-off"; // FORK: provider time-off
import { isDynamicRecord } from "./runtime-values";

export * from "./fork/provider-time-off"; // FORK: shared with main and renderer through `@openbot/contracts/ipc`

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
  /** FORK: windows of the local day in which a provider takes no request (`fork/provider-time-off.ts`). */
  providerTimeOff?: ProviderTimeOff;
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
