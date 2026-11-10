// Fork-owned (see docs/FORK.md): failover that comes back, longer holds for models that keep failing, and a spent
// per-model quota in the usage reading. The upstream files carry only `// FORK:` hooks that call into this file:
//   agent/usage-limit-gate.ts  — `UsageLimitFork` (holds, probe waits), `spentModelsOf`
//   agent-service.ts           — `returnSweep`, `agentsToReturn`, `withSpentModels`

import {
  type AccountUsage,
  type AccountUsageLimit,
  type AccountUsageWindow,
  usageGroupForModel,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";

/**
 * A model that fails again within this time after its last failure is held for twice as long as the
 * time before, up to `FAILURE_HOLD_MAX_MS`: agents no longer go back to a model that keeps failing
 * every ten minutes. A completed turn on the model forgets the failures. A reset that the error names
 * still wins when it is later.
 */
const FAILURE_STRIKE_WINDOW_MS = 60 * 60_000;
const FAILURE_HOLD_MAX_MS = 40 * 60_000;

/**
 * A limit with no known reset lets one turn try every `recheckMs`. When that turn is refused again, the next wait
 * doubles (30, then 60 minutes at a 15-minute base), so a limit that stays spent does not send its agents home and
 * back to the backup model every 15 minutes. A real reset, a completed turn or `PROBE_WINDOW_MS` without a probe
 * forgets it.
 */
const PROBE_MAX_MS = 60 * 60_000;
const PROBE_WINDOW_MS = 6 * 60 * 60_000;

/** How often an idle agent on a backup model is looked at again. */
const RETURN_SWEEP_EVERY = "2 minutes";

interface Run {
  count: number;
  at: number;
}

/** The memory of the usage-limit gate that grows waits: consecutive failures and probes per model key. */
export class UsageLimitFork {
  readonly #strikes = new Map<string, Run>();
  readonly #probes = new Map<string, Run>();

  /**
   * The hold, in ms, of a model that failed a turn with a provider error. `held`: the model is already held, so agents
   * that fail on it together count once; a failure after the hold ended counts again.
   */
  failureHold(key: string, held: boolean, baseMs: number): number {
    const now = Date.now();
    const strike = this.#strikes.get(key);
    const count = held
      ? (strike?.count ?? 1)
      : strike && now - strike.at < FAILURE_STRIKE_WINDOW_MS
        ? strike.count + 1
        : 1;
    this.#strikes.set(key, { count, at: now });
    return Math.min(baseMs * 2 ** (count - 1), FAILURE_HOLD_MAX_MS);
  }

  /** The wait before the next probe of a limit with no known reset. */
  probeDelay(key: string, recheckMs: number): number {
    const probes = this.#probes.get(key);
    return probes && Date.now() - probes.at < PROBE_WINDOW_MS
      ? Math.min(recheckMs * 2 ** probes.count, PROBE_MAX_MS)
      : recheckMs;
  }

  /** A limit ended: a real reset forgets its probes, a probe adds one. */
  probed(key: string, reset: boolean): void {
    if (reset) {
      this.#probes.delete(key);
      return;
    }
    const probe = this.#probes.get(key);
    const now = Date.now();
    this.#probes.set(key, { count: probe && now - probe.at < PROBE_WINDOW_MS ? probe.count + 1 : 1, at: now });
  }

  /** A turn completed on the model: forget what grew its waits. */
  forget(key: string): void {
    this.#strikes.delete(key);
    this.#probes.delete(key);
  }

  clear(): void {
    this.#strikes.clear();
    this.#probes.clear();
  }
}

/** A Gemini model that Google refused for a spent quota, and when that refusal ends (epoch seconds). */
export interface SpentModel {
  model: string;
  resetsAt: number;
}

/**
 * The models of one provider account that a spent quota now passes over: a provider error that named its reset, or a
 * spent balance. The usage reading shows only the plan's own windows, so such a model would read as room left.
 */
export function spentModelsOf(
  failures: Iterable<{
    provider: string;
    accountId: string | null;
    model: string;
    endsAt: number;
    spent: boolean;
    resetNamed: boolean;
  }>,
  provider: string,
  accountId: string | null,
): SpentModel[] {
  const now = Date.now();
  return [...failures]
    .filter(
      (failure) =>
        failure.provider === provider &&
        failure.accountId === accountId &&
        (failure.resetNamed || failure.spent) &&
        failure.endsAt > now,
    )
    .map((failure) => ({ model: failure.model, resetsAt: failure.endsAt / 1_000 }));
}

/**
 * The `/usage` reading shows the plan's weekly bucket, but Google also refuses one model for a shorter period
 * ("You have reached your current quota for this period"), and the plan page then shows more left. While such a
 * refusal holds a model, the group that lists it reads as spent until the reset that the refusal named.
 */
export function withSpentModels(
  usage: AccountUsage,
  spentFor: (accountId: string | null) => readonly SpentModel[],
): AccountUsage {
  const now = Date.now() / 1_000;
  let changed = false;
  const limits = usage.limits.map((limit) => {
    if (limit.id !== "antigravity") return limit;
    const spent = spentFor(limit.accountId ?? null).filter((entry) => entry.resetsAt > now);
    if (spent.length === 0) return limit;
    let next: AccountUsageLimit = limit;
    for (const entry of spent) {
      const window: AccountUsageWindow = { usedPercent: 100, windowDurationMins: null, resetsAt: entry.resetsAt };
      const groups = next.groups;
      if (!groups) {
        next = { ...next, primary: spentWindow(next.primary, window) };
        continue;
      }
      const group = usageGroupForModel(groups, entry.model);
      if (!group) continue;
      // The limit's own windows mirror the group that was read; they follow it.
      const mirrored = sameWindow(next.primary, group.primary) && sameWindow(next.secondary, group.secondary);
      const primary = spentWindow(group.primary, window);
      next = {
        ...next,
        ...(mirrored ? { primary } : {}),
        groups: groups.map((candidate) => (candidate === group ? { ...candidate, primary } : candidate)),
      };
    }
    changed = true;
    return next;
  });
  return changed ? { ...usage, limits } : usage;
}

/** The spent window, unless the current one is already spent for at least as long. */
function spentWindow(current: AccountUsageWindow | null, spent: AccountUsageWindow): AccountUsageWindow {
  return current && current.usedPercent >= 100 && (current.resetsAt ?? 0) >= (spent.resetsAt ?? 0) ? current : spent;
}

function sameWindow(left: AccountUsageWindow | null, right: AccountUsageWindow | null): boolean {
  if (left === right) return true;
  return (
    left !== null &&
    right !== null &&
    left.usedPercent === right.usedPercent &&
    left.resetsAt === right.resetsAt &&
    left.windowDurationMins === right.windowDurationMins
  );
}

/** The ids of the agents on a backup model whose home model is ready now, so their return can start. */
export function agentsToReturn<Agent extends { id: string; usageLimitReturn?: object | undefined }>(
  agents: readonly Agent[],
  ready: (home: NonNullable<Agent["usageLimitReturn"]>) => boolean,
): string[] {
  return agents.flatMap((agent) => (agent.usageLimitReturn && ready(agent.usageLimitReturn) ? [agent.id] : []));
}

/** Runs `sweep` every `RETURN_SWEEP_EVERY` until the scope that forks it closes. */
export const returnSweep = (sweep: () => void) =>
  Effect.forever(Effect.sleep(RETURN_SWEEP_EVERY).pipe(Effect.andThen(Effect.sync(sweep))));
