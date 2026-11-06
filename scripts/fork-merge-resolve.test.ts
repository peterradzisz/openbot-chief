// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { describe, expect, it } from "vitest";
import { catalogWarnings, classifyConflict, parseUnmerged } from "./fork-merge-resolve.mjs";

describe("classifyConflict", () => {
  it("removes a GitHub workflow with a modify/delete conflict", () => {
    expect(classifyConflict(".github/workflows/release.yml", "DU").action).toBe("rm");
    expect(classifyConflict(".github/workflows/ci.yml", "UD").action).toBe("rm");
  });

  it("leaves a GitHub workflow that both sides changed to a human", () => {
    expect(classifyConflict(".github/workflows/ci.yml", "UU").action).toBe("manual");
    expect(classifyConflict(".github/workflows/nested/ci.yml", "DU").action).toBe("manual");
  });

  it("takes upstream's side of a provider catalog", () => {
    expect(classifyConflict("packages/i18n/src/messages/en/provider.ts", "UU").action).toBe("theirs");
    expect(classifyConflict("packages/i18n/src/messages/de/error/provider.ts", "AA").action).toBe("theirs");
  });

  it("leaves other catalogs, a deleted provider catalog and other files to a human", () => {
    expect(classifyConflict("packages/i18n/src/messages/en/settings.ts", "UU").action).toBe("manual");
    expect(classifyConflict("packages/i18n/src/messages/en/provider.ts", "UD").action).toBe("manual");
    expect(classifyConflict("src/backend/workflows/workflows.ts", "UU").action).toBe("manual");
  });

  it("answers manual for a code that is not unmerged", () => {
    expect(classifyConflict(".github/workflows/ci.yml", "M ").action).toBe("manual");
  });
});

describe("catalogWarnings", () => {
  it("names the fork keys and the keys only the fork's side has", () => {
    const ours = '  "provider.a": "A",\n  "provider.mine": "M",\n  "fork.x": "X",\n';
    const theirs = '  "provider.a": "A",\n  "provider.new":\n    "N",\n';
    expect(catalogWarnings(ours, theirs)).toEqual({
      forkKeys: ["fork.x"],
      dropped: ["provider.mine", "fork.x"],
    });
  });
});

describe("parseUnmerged", () => {
  it("keeps only unmerged entries", () => {
    const output = "UU src/a.ts\0M  src/b.ts\0DU .github/workflows/ci.yml\0";
    expect(parseUnmerged(output)).toEqual([
      { code: "UU", path: "src/a.ts" },
      { code: "DU", path: ".github/workflows/ci.yml" },
    ]);
  });
});
