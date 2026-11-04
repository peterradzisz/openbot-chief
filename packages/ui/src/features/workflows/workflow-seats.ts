// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Model seats integration for workflows.
 * Reads seats, bindings, concurrency budgets, and output caps from local storage,
 * and resolves seat rungs to agents, models, reasoning effort, and prompt output caps.
 */

import type { AgentModelId } from "@openbot/contracts/ipc";
import type { AgentProfile } from "../../data";
import type { WorkflowCatalogs } from "./workflow-model";
import type { WfProvider } from "./workflow-node-parts";

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

export type SeatReasoningEffort = "default" | "none" | "low" | "medium" | "high";

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

export const DEFAULT_OUTPUT_CAP = 16000;
export const MAX_SEAT_RUNGS = 7;

const STORAGE_KEY = "openbot:model-seats";

const DEFAULT_SEAT_NAMES: Record<string, string> = {
  builder: "Builder",
  intake: "Intake",
  planners: "Planners",
  judge: "Judge",
  lastResort: "Last resort",
};

export function defaultSeats(): ModelSeat[] {
  return [
    { id: "builder", name: "Builder", kind: "failover", defaultEffort: "high", rungs: [] },
    { id: "intake", name: "Intake", kind: "failover", defaultEffort: "low", rungs: [] },
    { id: "planners", name: "Planners", kind: "failover", defaultEffort: "high", rungs: [] },
    { id: "judge", name: "Judge", kind: "escalation", defaultEffort: "medium", rungs: [] },
    { id: "lastResort", name: "Last resort", kind: "failover", defaultEffort: "low", rungs: [] },
  ];
}

export const LEGACY_AGENT_NAME_MAP: Record<string, string> = {
  "GLM Build 1": "Builder 1",
  "GLM Build 2": "Builder 2",
  "GLM Build 3": "Builder 3",
  "GLM Build 4": "Builder 4",
  "GLM Build 5": "Builder 5",
  "Sonnet Build": "Builder 6",
  "GLM Plan 1": "Planner 1",
  "GLM Plan 2": "Planner 2",
  "GLM Plan 3": "Planner 3",
  "GLM Plan 4": "Planner 4",
  "Opus Planner": "Planner Opus",
  "Opus Planner 2": "Planner Opus 2",
  "Dispatcher": "Intake 1",
  "Plan Clerk": "Intake 2",
  "Sonnet Reviewer": "Judge 1",
  "Opus Reviewer": "Judge 2",
  "GLM Judge": "Judge 3",
  "Fable Advisor": "Judge 4",
};

export function migrateAgentName(name: string): string {
  return LEGACY_AGENT_NAME_MAP[name] ?? name;
}

export function defaultBindings(): Record<string, string[]> {
  return {
    builder: ["Builder 1", "Builder 2", "Builder 3", "Builder 4", "Builder 5"],
    intake: ["Intake 1", "Intake 2"],
    planners: ["Planner 1", "Planner 2", "Planner 3", "Planner 4"],
    judge: ["Judge 1", "Judge 2", "Judge 3", "Judge 4"],
    lastResort: ["Digest Clerk"],
  };
}

export function readModelSeats(): SeatsState {
  if (typeof window === "undefined" || !window.localStorage) {
    return {
      seats: defaultSeats(),
      budgets: {},
      enabledBudgets: {},
      outputCaps: {},
      enabledOutputCaps: {},
      modelEfforts: {},
      bindings: defaultBindings(),
      presets: [],
    };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const rawSeats: ModelSeat[] =
      Array.isArray(parsed.seats) && parsed.seats.length > 0 ? parsed.seats : defaultSeats();
    const seats = rawSeats.map((seat) => ({
      ...seat,
      name:
        typeof seat.name === "string" && seat.name.trim().length > 0
          ? seat.name
          : (DEFAULT_SEAT_NAMES[seat.id] ?? seat.id ?? "Seat"),
      defaultEffort: seat.defaultEffort ?? (seat.id === "builder" ? "high" : seat.id === "judge" ? "medium" : "low"),
      rungs: Array.isArray(seat.rungs)
        ? seat.rungs.map((r) => ({
            ...r,
            effort: r.effort ?? "default",
          }))
        : [],
    }));

    // Ensure standard pipeline seats exist without duplicates
    for (const def of defaultSeats()) {
      const exists = seats.some(
        (s) =>
          s.id.toLowerCase() === def.id.toLowerCase() || s.name.trim().toLowerCase() === def.name.trim().toLowerCase(),
      );
      if (!exists) {
        seats.push({
          ...def,
          defaultEffort: def.defaultEffort ?? "default",
          rungs: def.rungs.map((r) => ({ ...r, effort: r.effort ?? "default" })),
        });
      }
    }

    // De-duplicate seats by both ID and Name to ensure no duplicates in the UI
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const uniqueSeats: typeof seats = [];
    for (const seat of seats) {
      const normId = seat.id.trim().toLowerCase();
      const normName = seat.name.trim().toLowerCase();
      if (seenIds.has(normId) || seenNames.has(normName)) {
        continue;
      }
      seenIds.add(normId);
      seenNames.add(normName);
      uniqueSeats.push(seat);
    }

    const outputCaps: Record<string, number> =
      typeof parsed.outputCaps === "object" && parsed.outputCaps !== null ? parsed.outputCaps : {};
    const enabledOutputCaps: Record<string, boolean> =
      typeof parsed.enabledOutputCaps === "object" && parsed.enabledOutputCaps !== null
        ? parsed.enabledOutputCaps
        : Object.fromEntries(Object.entries(outputCaps).map(([k, v]) => [k, typeof v === "number" && v > 0]));
    const modelEfforts: Record<string, SeatReasoningEffort> =
      typeof parsed.modelEfforts === "object" && parsed.modelEfforts !== null ? parsed.modelEfforts : {};

    const rawBindings: Record<string, string[]> =
      typeof parsed.bindings === "object" && parsed.bindings !== null && Object.keys(parsed.bindings).length > 0
        ? parsed.bindings
        : defaultBindings();
    const bindings: Record<string, string[]> = {};
    for (const [k, names] of Object.entries(rawBindings)) {
      bindings[k] = Array.isArray(names) ? names.map(migrateAgentName) : [];
    }
    if (!bindings.planners || bindings.planners.length === 0) {
      bindings.planners = ["Planner 1", "Planner 2", "Planner 3", "Planner 4"];
    }

    return {
      seats: uniqueSeats,
      budgets: typeof parsed.budgets === "object" && parsed.budgets !== null ? parsed.budgets : {},
      enabledBudgets:
        typeof parsed.enabledBudgets === "object" && parsed.enabledBudgets !== null ? parsed.enabledBudgets : {},
      bindings,
      outputCaps,
      enabledOutputCaps,
      modelEfforts,
      presets: Array.isArray(parsed.presets) ? parsed.presets : [],
    };
  } catch {
    return {
      seats: defaultSeats(),
      budgets: {},
      enabledBudgets: {},
      outputCaps: {},
      enabledOutputCaps: {},
      modelEfforts: {},
      bindings: defaultBindings(),
      presets: [],
    };
  }
}

/** Resolves default effort for a model: configured effort if present, else model profile sweet-spot. */
export function getModelEffort(state: SeatsState, key: string): SeatReasoningEffort {
  if (state.modelEfforts?.[key]) return state.modelEfforts[key];
  const lower = key.toLowerCase();
  if (lower.includes("sonnet")) return "high";
  if (lower.includes("flash")) return "high";
  if (lower.includes("opus")) return "medium";
  if (lower.includes("argon")) return "low";
  return "default";
}

export interface SeatAgentOption {
  id: string;
  name: string;
  model: string;
  provider: string;
}

export interface SeatModelOption {
  id: string;
  name?: string;
  provider?: string;
}

export interface SeatCatalogs {
  agents: readonly (AgentProfile | SeatAgentOption)[];
  models: readonly SeatModelOption[];
}

export interface ResolvedSeatChoice {
  seat: ModelSeat;
  seatId: string;
  seatName: string;
  seatKind: "failover" | "escalation";
  agent: AgentProfile | SeatAgentOption | undefined;
  agentId: string;
  model: AgentModelId;
  provider: WfProvider;
  outCapTokens: number;
  hasCap: boolean;
  defaultEffort: SeatReasoningEffort;
  boundNames: readonly string[];
}

export function resolveSeatChoice(input: {
  seatId: string;
  seatRung: string;
  catalogs: WorkflowCatalogs | SeatCatalogs;
  state?: SeatsState;
}): ResolvedSeatChoice {
  const state = input.state ?? readModelSeats();
  const fallback: ModelSeat = defaultSeats()[0] ?? {
    id: "builder",
    name: "Builder",
    kind: "failover",
    rungs: [],
  };
  const seat: ModelSeat =
    state.seats.find(
      (s) =>
        s.id.toLowerCase() === input.seatId.toLowerCase() ||
        s.name.trim().toLowerCase() === input.seatId.trim().toLowerCase(),
    ) ??
    state.seats[0] ??
    fallback;
  const boundNames =
    state.bindings[seat.id] ?? state.bindings[seat.name.toLowerCase()] ?? state.bindings.planners ?? [];

  let agent: AgentProfile | SeatAgentOption | undefined;

  if (input.seatRung === "auto") {
    // Pick the first agent matching the bound agent list
    for (const name of boundNames) {
      const match = input.catalogs.agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (match) {
        agent = match;
        break;
      }
    }
    // If not found by name, try matching rung 0 model
    if (!agent && seat.rungs.length > 0) {
      const rung0 = seat.rungs[0];
      if (rung0) {
        agent = input.catalogs.agents.find(
          (a) => a.model === rung0.model && (!rung0.provider || a.provider === rung0.provider),
        );
      }
    }
  } else {
    // Specific rung index (1-based: "1", "2", "3", etc.)
    const index = Math.max(0, parseInt(input.seatRung, 10) - 1);
    const targetName = boundNames[index];
    if (targetName) {
      agent = input.catalogs.agents.find((a) => a.name.toLowerCase() === targetName.toLowerCase());
    }
    if (!agent && seat.rungs[index]) {
      const rung = seat.rungs[index];
      if (rung) {
        agent = input.catalogs.agents.find(
          (a) => a.model === rung.model && (!rung.provider || a.provider === rung.provider),
        );
      }
    }
  }

  // Fallback if still not found
  if (!agent) {
    agent = input.catalogs.agents[0];
  }

  // biome-ignore lint/nursery/noUnsafeTypeAssertion: catalog model and provider types
  const model = (agent?.model ?? seat.rungs[0]?.model ?? input.catalogs.models[0]?.id ?? "") as AgentModelId;
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: catalog model and provider types
  const provider = (agent?.provider ?? seat.rungs[0]?.provider ?? "codex") as WfProvider;

  const modelKey = `${provider}:${model}`;
  const hasCap = Boolean(state.enabledOutputCaps[modelKey]);
  const outCapTokens = hasCap ? (state.outputCaps[modelKey] ?? DEFAULT_OUTPUT_CAP) : 0;

  const rungIndex = input.seatRung === "auto" ? 0 : Math.max(0, parseInt(input.seatRung, 10) - 1);
  const matchedRung =
    seat.rungs.find((r) => r.model === model && (!r.provider || r.provider === provider)) ?? seat.rungs[rungIndex];

  let defaultEffort: SeatReasoningEffort;
  if (matchedRung?.effort && matchedRung.effort !== "default") {
    defaultEffort = matchedRung.effort;
  } else if (seat.defaultEffort && seat.defaultEffort !== "default") {
    defaultEffort = seat.defaultEffort;
  } else {
    defaultEffort = getModelEffort(state, modelKey);
  }

  return {
    seat,
    seatId: seat.id,
    seatName: seat.name,
    seatKind: seat.kind,
    agent,
    agentId: agent?.id ?? "",
    model,
    provider,
    outCapTokens,
    hasCap,
    defaultEffort,
    boundNames,
  };
}
