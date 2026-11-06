// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { describe, expect, it } from "vitest";
import { compactionThreshold } from "./config";

describe("compactionThreshold", () => {
  it("keeps upstream's 0.8 when the variable is unset or empty", () => {
    expect(compactionThreshold(undefined)).toBe(0.8);
    expect(compactionThreshold("")).toBe(0.8);
  });

  it("takes a share in (0, 1]", () => {
    expect(compactionThreshold("0.5")).toBe(0.5);
    expect(compactionThreshold("1")).toBe(1);
  });

  it("ignores a value outside (0, 1] or not a number", () => {
    expect(compactionThreshold("0")).toBe(0.8);
    expect(compactionThreshold("-0.2")).toBe(0.8);
    expect(compactionThreshold("1.5")).toBe(0.8);
    expect(compactionThreshold("half")).toBe(0.8);
    expect(compactionThreshold("Infinity")).toBe(0.8);
  });
});
