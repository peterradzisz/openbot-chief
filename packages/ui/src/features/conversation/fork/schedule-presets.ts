// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * Fork: "Every 15 minutes" and "Every 30 minutes" in the frequency menu. Upstream's menu stops at
 * an hourly step; these two are whole-day presets that set the cron expression of a custom schedule, so they need no
 * new schedule kind: a saved one reads back as the same preset. Upstream's picker keeps three one-line hooks.
 */

import type { AppTextKey } from "@openbot/i18n";

export interface ForkSchedulePreset {
  /** The menu value; it never clashes with a draft kind. */
  value: `fork:${string}`;
  expression: string;
  label: AppTextKey;
}

export const FORK_SCHEDULE_PRESETS: readonly ForkSchedulePreset[] = [
  { value: "fork:every15", expression: "*/15 * * * *", label: "fork.routine.every15" },
  { value: "fork:every30", expression: "*/30 * * * *", label: "fork.routine.every30" },
];

/** The preset a custom schedule is, or undefined. Spaces around the fields do not matter. */
export function forkPresetOf(schedule: { kind: string; expression?: string }): ForkSchedulePreset | undefined {
  if (schedule.kind !== "custom" || typeof schedule.expression !== "string") return undefined;
  const expression = schedule.expression.trim().replace(/\s+/g, " ");
  return FORK_SCHEDULE_PRESETS.find((preset) => preset.expression === expression);
}

export function forkPresetByValue(value: string): ForkSchedulePreset | undefined {
  return FORK_SCHEDULE_PRESETS.find((preset) => preset.value === value);
}
