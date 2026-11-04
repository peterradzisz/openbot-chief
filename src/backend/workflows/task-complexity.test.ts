// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { describe, expect, it } from "vitest";
import {
  buildMicroClassifierPrompt,
  evaluateTaskComplexity,
  matchTrivialRule,
  parseComplexityWord,
} from "./task-complexity";

describe("task-complexity", () => {
  describe("Layer 2A (matchTrivialRule)", () => {
    it("matches issue with trivial label", () => {
      const input = "Issue #123: Fix footer link\nLabels: bug, trivial\nDescription: update href";
      expect(matchTrivialRule(input)).toBe(true);
    });

    it("matches typo or docs in labels", () => {
      expect(matchTrivialRule("Labels: documentation")).toBe(true);
      expect(matchTrivialRule("Labels: typo")).toBe(true);
      expect(matchTrivialRule("labels: quickfix")).toBe(true);
    });

    it("matches trivial commit/title patterns", () => {
      expect(matchTrivialRule("fix typo in README.md")).toBe(true);
      expect(matchTrivialRule("bump version to 1.2.3")).toBe(true);
      expect(matchTrivialRule("[complexity: trivial] do this small fix")).toBe(true);
    });

    it("does not match complex tasks", () => {
      const input = "Refactor authentication system to support multiple providers with session pooling";
      expect(matchTrivialRule(input)).toBe(false);
    });

    it("handles empty or invalid inputs", () => {
      expect(matchTrivialRule("")).toBe(false);
    });
  });

  describe("Layer 2B (parseComplexityWord & prompt)", () => {
    it("parses TRIVIAL, NORMAL, COMPLEX from responses", () => {
      expect(parseComplexityWord("TRIVIAL")).toBe("trivial");
      expect(parseComplexityWord("This task is trivial.")).toBe("trivial");
      expect(parseComplexityWord("NORMAL")).toBe("normal");
      expect(parseComplexityWord("COMPLEX")).toBe("complex");
      expect(parseComplexityWord("UNKNOWN_WORD")).toBe(null);
    });

    it("builds prompt truncating long inputs safely", () => {
      const longInput = "a".repeat(2000);
      const prompt = buildMicroClassifierPrompt(longInput);
      expect(prompt).toContain("--- Task Input ---");
      expect(prompt).toContain("...(truncated)");
    });
  });

  describe("evaluateTaskComplexity (Integration & Fallback)", () => {
    it("returns trivial via rule when Layer 2A matches (zero tokens)", async () => {
      let called = false;
      const res = await evaluateTaskComplexity("Labels: typo\nFix misspelling", async () => {
        called = true;
        return "NORMAL";
      });
      expect(res.complexity).toBe("trivial");
      expect(res.reason).toBe("rule");
      expect(called).toBe(false); // LLM must NOT be called
    });

    it("calls micro-classifier when rule does not match", async () => {
      let calledPrompt = "";
      const res = await evaluateTaskComplexity("Add OAuth provider support", async (prompt) => {
        calledPrompt = prompt;
        return "COMPLEX";
      });
      expect(res.complexity).toBe("complex");
      expect(res.reason).toBe("classifier");
      expect(calledPrompt).toContain("Add OAuth provider support");
    });

    it("gracefully falls back and skips when micro-classifier throws an error", async () => {
      const res = await evaluateTaskComplexity("Add OAuth provider support", async () => {
        throw new Error("Rate limit exceeded (429)");
      });
      expect(res.complexity).toBe("normal");
      expect(res.reason).toBe("fallback-skip");
    });

    it("gracefully falls back when micro-classifier returns unparseable text", async () => {
      const res = await evaluateTaskComplexity("Add OAuth provider support", async () => {
        return "I cannot answer this question right now.";
      });
      expect(res.complexity).toBe("normal");
      expect(res.reason).toBe("fallback-skip");
    });

    it("skips gracefully when no generator is provided", async () => {
      const res = await evaluateTaskComplexity("Standard feature request");
      expect(res.complexity).toBe("normal");
      expect(res.reason).toBe("fallback-skip");
    });
  });
});
