// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { describe, expect, it } from "vitest";
import {
  inWindow,
  isProviderOff,
  sanitizeProviderTimeOff,
} from "../../../../packages/contracts/src/fork/provider-time-off";

const at = (hhmm: string) => new Date(`2026-11-06T${hhmm}:00`); // local time, as the host reads it

describe("provider time-off", () => {
  it("matches a window inside one day, with the end excluded", () => {
    const window = { from: "09:00", to: "17:00" };
    expect(inWindow(window, at("09:00"))).toBe(true);
    expect(inWindow(window, at("16:59"))).toBe(true);
    expect(inWindow(window, at("17:00"))).toBe(false);
    expect(inWindow(window, at("08:59"))).toBe(false);
  });

  it("matches a window that crosses midnight", () => {
    const night = { from: "22:00", to: "07:00" };
    expect(inWindow(night, at("23:30"))).toBe(true);
    expect(inWindow(night, at("00:15"))).toBe(true);
    expect(inWindow(night, at("06:59"))).toBe(true);
    expect(inWindow(night, at("07:00"))).toBe(false);
    expect(inWindow(night, at("12:00"))).toBe(false);
  });

  it("never matches an empty or malformed window", () => {
    expect(inWindow({ from: "10:00", to: "10:00" }, at("10:00"))).toBe(false);
    expect(inWindow({ from: "25:00", to: "07:00" }, at("23:00"))).toBe(false);
    expect(inWindow({ from: "", to: "" }, at("23:00"))).toBe(false);
  });

  it("is off for the provider whose window holds now, and for no other", () => {
    const timeOff = { claude: [{ from: "22:00", to: "07:00" }], opencode: [{ from: "12:00", to: "13:00" }] };
    expect(isProviderOff(timeOff, "claude", at("23:00"))).toBe(true);
    expect(isProviderOff(timeOff, "opencode", at("23:00"))).toBe(false);
    expect(isProviderOff(timeOff, "antigravity", at("23:00"))).toBe(false);
    expect(isProviderOff(undefined, "claude", at("23:00"))).toBe(false);
  });

  it("is off all day for 00:00 to 23:59, up to the last minute", () => {
    const allDay = { claude: [{ from: "00:00", to: "23:59" }] };
    expect(isProviderOff(allDay, "claude", at("00:00"))).toBe(true);
    expect(isProviderOff(allDay, "claude", at("23:58"))).toBe(true);
    expect(isProviderOff(allDay, "claude", at("23:59"))).toBe(false);
  });

  it("keeps only well-formed windows from storage", () => {
    expect(
      sanitizeProviderTimeOff({
        claude: [{ from: "22:00", to: "07:00" }, { from: "bad", to: "07:00" }, null, "x"],
        gone: [{ from: "x", to: "y" }],
        junk: "no",
      }),
    ).toEqual({ claude: [{ from: "22:00", to: "07:00" }] });
    expect(sanitizeProviderTimeOff(null)).toEqual({});
    expect(sanitizeProviderTimeOff([])).toEqual({});
  });
});
