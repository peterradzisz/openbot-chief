// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
// model-seats.ts — the seats store (owner 2026-11-03, the mockup's second slice): named model
// chains that workflows and the harness bind to instead of raw model ids, plus per-model
// concurrency budgets and named presets that flip every seat at once (the "GLM month" roster).
// Desktop storage (localStorage), like the picker favorites; the harness's apply_seats.cjs reads
// this same key from the app window and moves the live agents onto the seats.

import { isAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentModelChoice, AgentProviderId } from "@openbot/contracts/ipc";

export interface SeatRung {
  provider: string;
  model: string;
  effort?: SeatReasoningEffort;
}

export interface ModelSeat {
  id: string;
  name: string;
  /** Failover seats use the first healthy rung; escalation seats run each rung in order. */
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
  /** "provider:id" → how many turns may run on that model at once. */
  budgets: Record<string, number>;
  /** "provider:id" → whether budget is enabled (tickbox on/off). */
  enabledBudgets: Record<string, boolean>;
  /** "provider:id" → output token cap (max_tokens) when enabled, default 16000. */
  outputCaps: Record<string, number>;
  /** "provider:id" → whether the prompt/token Out cap is enabled (tickbox on/off). */
  enabledOutputCaps: Record<string, boolean>;
  /** "provider:id" → default reasoning effort when used in a seat or workflow. */
  modelEfforts: Record<string, SeatReasoningEffort>;
  /** seat id → the agent names bound to it (the harness reads this through apply_seats). */
  bindings: Record<string, string[]>;
  presets: SeatPreset[];
}

export const DEFAULT_OUTPUT_CAP = 16000;
export const MAX_SEAT_RUNGS = 7;

/** Builds the prompt suffix injected for a model when its Out cap is ticked on. */
export function formatOutputCapPrompt(maxTokens: number = DEFAULT_OUTPUT_CAP): string {
  const limit = maxTokens > 0 ? maxTokens : DEFAULT_OUTPUT_CAP;
  const short = limit >= 1000 && limit % 1000 === 0 ? `${limit / 1000}k` : `${limit}`;
  return `[Output cap: max ${short} tokens (${limit} tokens). Condense output to essential findings, diffs, and decisions.]`;
}

const STORAGE_KEY = "openbot:model-seats";

const DEFAULT_SEAT_NAMES: Record<string, string> = {
  builder: "Builder",
  intake: "Intake",
  planners: "Planners",
  judge: "Judge",
  lastResort: "Last resort",
};

/** The seats a fresh install starts with: standard pipeline seats, empty until bound. */
export function defaultSeats(): ModelSeat[] {
  return [
    { id: "builder", name: "Builder", kind: "failover", defaultEffort: "high", rungs: [] },
    { id: "intake", name: "Intake", kind: "failover", defaultEffort: "low", rungs: [] },
    { id: "planners", name: "Planners", kind: "failover", defaultEffort: "high", rungs: [] },
    {
      id: "judge",
      name: "Judge",
      kind: "escalation",
      defaultEffort: "medium",
      rungs: [
        { provider: "claude", model: "claude-sonnet-5-5", effort: "high" },
        { provider: "claude", model: "claude-opus-4-6", effort: "medium" },
        { provider: "claude", model: "claude-fable-5-1", effort: "medium" },
        { provider: "opencode", model: "zai-coding-plan/glm-5.3", effort: "default" },
        { provider: "antigravity", model: "gemini-3.8-flash", effort: "high" },
      ],
    },
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
  Dispatcher: "Intake 1",
  "Plan Clerk": "Intake 2",
  "Sonnet Reviewer": "Judge 1",
  "Opus Reviewer": "Judge 2",
  "GLM Judge": "Judge 3",
  "Fable Advisor": "Judge 4",
};

export function migrateAgentName(name: string): string {
  return LEGACY_AGENT_NAME_MAP[name] ?? name;
}

/** The agents each seat starts with; the tab edits these and apply_seats.cjs reads them. */
export function defaultBindings(): Record<string, string[]> {
  return {
    builder: ["Builder 1", "Builder 2", "Builder 3", "Builder 4", "Builder 5", "Builder 6"],
    intake: ["Intake 1", "Intake 2"],
    planners: ["Planner 1", "Planner 2", "Planner 3", "Planner 4", "Planner Opus", "Planner Opus 2"],
    judge: ["Judge 1", "Judge 2", "Judge 3", "Judge 4"],
    lastResort: ["Digest Clerk"],
  };
}

export function readSeats(): SeatsState {
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
      bindings.planners = ["Planner 1", "Planner 2", "Planner 3", "Planner 4", "Planner Opus", "Planner Opus 2"];
    } else {
      if (!bindings.planners.includes("Planner Opus")) bindings.planners.push("Planner Opus");
      if (!bindings.planners.includes("Planner Opus 2")) bindings.planners.push("Planner Opus 2");
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

export function writeSeats(state: SeatsState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A blocked store keeps the seats for this window only.
  }
  try {
    void window.openbot?.setModelSeats?.(state);
  } catch {
    // Optional IPC sync
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

/** The "provider:id" key a rung or budget is known by, the same shape the picker favorites use. */
export function seatModelKey(rung: SeatRung): string {
  return `${rung.provider}:${rung.model}`;
}

export interface AgentSeatPlan {
  agentId: string;
  name: string;
  provider: AgentProviderId;
  model: string;
  backups: AgentModelChoice[];
}

/** Computes the live model and backup chain for each agent bound to a seat. */
export function computeSeatMoves(state: SeatsState, agents: readonly { id: string; name: string }[]): AgentSeatPlan[] {
  const moves: AgentSeatPlan[] = [];
  for (const seat of state.seats) {
    if (seat.rungs.length === 0) continue;
    const boundNames =
      state.bindings[seat.id] ??
      (seat.name.toLowerCase() === "planners" ? state.bindings.planners : undefined) ??
      defaultBindings()[seat.id] ??
      [];
    for (let index = 0; index < boundNames.length; index++) {
      const name = boundNames[index];
      if (!name) continue;
      const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (!agent) continue;

      let primaryRung = seat.rungs[0];
      let backupRungs: SeatRung[] = [];

      if (seat.kind === "failover") {
        if (seat.id === "builder") {
          const lower = name.toLowerCase();
          if ((lower.includes("2") || lower.includes("4")) && seat.rungs.length > 1) {
            primaryRung = seat.rungs[1] ?? seat.rungs[0];
            backupRungs = [seat.rungs[0], ...seat.rungs.slice(2)].filter((r): r is SeatRung => Boolean(r));
          } else if (lower.includes("6") && seat.rungs.length >= 4) {
            primaryRung = seat.rungs[3] ?? seat.rungs[0];
            backupRungs = [seat.rungs[2], seat.rungs[0], seat.rungs[1], ...seat.rungs.slice(4)].filter(
              (r): r is SeatRung => Boolean(r),
            );
          } else {
            primaryRung = seat.rungs[0];
            backupRungs = seat.rungs.slice(1);
          }
        } else {
          primaryRung = seat.rungs[0];
          backupRungs = seat.rungs.slice(1);
        }
      } else {
        const lower = name.toLowerCase();
        let targetIdx = Math.min(index, seat.rungs.length - 1);
        if (lower.includes("opus") || lower.includes("judge 2")) {
          const idx = seat.rungs.findIndex((r) => r.model.toLowerCase().includes("opus"));
          if (idx !== -1) targetIdx = idx;
        } else if (lower.includes("fable") || lower.includes("judge 4")) {
          const idx = seat.rungs.findIndex((r) => r.model.toLowerCase().includes("fable"));
          if (idx !== -1) targetIdx = idx;
        } else if (lower.includes("glm") || lower.includes("judge 3")) {
          const idx = seat.rungs.findIndex((r) => r.model.toLowerCase().includes("glm"));
          if (idx !== -1) targetIdx = idx;
        } else if (lower.includes("sonnet") || lower.includes("judge 1")) {
          const idx = seat.rungs.findIndex((r) => r.model.toLowerCase().includes("sonnet"));
          if (idx !== -1) targetIdx = idx;
        }
        primaryRung = seat.rungs[targetIdx] ?? seat.rungs[0];
        // Fail-forward order: subsequent rungs first, then earlier rungs as last resort
        backupRungs = [...seat.rungs.slice(targetIdx + 1), ...seat.rungs.slice(0, targetIdx)];
      }

      if (primaryRung && isAgentProvider(primaryRung.provider)) {
        const safeBackups: AgentModelChoice[] = [];
        for (const r of backupRungs) {
          if (isAgentProvider(r.provider)) {
            safeBackups.push({ provider: r.provider, model: r.model });
          }
        }
        moves.push({
          agentId: agent.id,
          name: agent.name,
          provider: primaryRung.provider,
          model: primaryRung.model,
          backups: safeBackups,
        });
      }
    }
  }
  return moves;
}
