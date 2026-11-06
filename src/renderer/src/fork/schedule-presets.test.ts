// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { describe, expect, it } from "vitest";
import {
  FORK_SCHEDULE_PRESETS,
  forkPresetByValue,
  forkPresetOf,
} from "../../../../packages/ui/src/features/conversation/fork/schedule-presets";

describe("fork schedule presets", () => {
  it("offers 15 and 30 minutes as whole-day cron expressions", () => {
    expect(FORK_SCHEDULE_PRESETS.map((preset) => preset.expression)).toEqual(["*/15 * * * *", "*/30 * * * *"]);
  });

  it("reads a saved custom schedule back as its preset, whatever the spacing", () => {
    expect(forkPresetOf({ kind: "custom", expression: "*/15 * * * *" })?.value).toBe("fork:every15");
    expect(forkPresetOf({ kind: "custom", expression: "  */30   *  * * * " })?.value).toBe("fork:every30");
  });

  it("leaves every other schedule alone", () => {
    expect(forkPresetOf({ kind: "custom", expression: "0 9-18 * * *" })).toBeUndefined();
    expect(forkPresetOf({ kind: "hourly" })).toBeUndefined();
  });

  it("finds a preset by its menu value, and never a draft kind", () => {
    expect(forkPresetByValue("fork:every30")?.expression).toBe("*/30 * * * *");
    expect(forkPresetByValue("hourly")).toBeUndefined();
  });
});
