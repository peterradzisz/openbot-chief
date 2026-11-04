// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { describe, expect, it } from "vitest";
import { agentStepText } from "./workflow-walk";

describe("agentStepText", () => {
  it("formats standard step prompt when no options provided", () => {
    const text = agentStepText("Nightly Build", "Run compile step", "some input");
    expect(text).toContain('The workflow "Nightly Build" gives you one step.');
    expect(text).toContain("Run compile step");
    expect(text).toContain("--- input ---\nsome input");
    expect(text).not.toContain("[Reasoning effort:");
    expect(text).not.toContain("[Output cap:");
  });

  it("injects reasoning effort when effort is non-default", () => {
    const text = agentStepText("Review PR", "Review code changes", "diff data", { effort: "high" });
    expect(text).toContain("[Reasoning effort: high]");
  });

  it("skips reasoning effort when effort is none, default, or seat", () => {
    const textNone = agentStepText("Review PR", "Review", "", { effort: "none" });
    expect(textNone).not.toContain("[Reasoning effort:");

    const textDef = agentStepText("Review PR", "Review", "", { effort: "default" });
    expect(textDef).not.toContain("[Reasoning effort:");

    const textSeat = agentStepText("Review PR", "Review", "", { effort: "seat" });
    expect(textSeat).not.toContain("[Reasoning effort:");
  });

  it("injects reasoning effort for medium", () => {
    const textMed = agentStepText("Review PR", "Review", "", { effort: "medium" });
    expect(textMed).toContain("[Reasoning effort: medium]");
  });

  it("injects output cap directive when outCapTokens is positive", () => {
    const text16k = agentStepText("Summarize", "Summarize findings", "", { outCapTokens: 16000 });
    expect(text16k).toContain(
      "[Output cap: max 16k tokens (16000 tokens). Condense output to essential findings, diffs, and decisions.]",
    );

    const text32k = agentStepText("Summarize", "Summarize findings", "", { outCapTokens: 32000 });
    expect(text32k).toContain(
      "[Output cap: max 32k tokens (32000 tokens). Condense output to essential findings, diffs, and decisions.]",
    );
  });

  it("does not inject output cap when outCapTokens is 0 or negative", () => {
    const textZero = agentStepText("Summarize", "Summarize findings", "", { outCapTokens: 0 });
    expect(textZero).not.toContain("[Output cap:");
  });

  it("combines both effort and output cap directives cleanly", () => {
    const combined = agentStepText("Judge Pipeline", "Evaluate PR mergeability", "commit logs", {
      effort: "high",
      outCapTokens: 16000,
    });
    expect(combined).toContain("[Reasoning effort: high]");
    expect(combined).toContain(
      "[Output cap: max 16k tokens (16000 tokens). Condense output to essential findings, diffs, and decisions.]",
    );
    expect(combined).toContain("Evaluate PR mergeability");
    expect(combined).toContain("--- input ---\ncommit logs");
  });
});
