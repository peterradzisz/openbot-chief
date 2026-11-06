// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import { describe, expect, it } from "vitest";
import { createFailureNoticeDedupe, FAILURE_NOTICE_REPEAT_MS, failureNoticeKey } from "./notice-dedupe";

describe("failureNoticeKey", () => {
  it("never keys an approval or a plain result", () => {
    expect(failureNoticeKey({ kind: "approval", workflowId: "w1", text: "token quota" })).toBeNull();
    expect(failureNoticeKey({ kind: "output", workflowId: "w1", text: "Build done" })).toBeNull();
  });

  it("puts every usage-shaped failure of a workflow in one class", () => {
    expect(failureNoticeKey({ kind: "output", workflowId: "w1", text: "Token Plan usage limit reached" })).toBe(
      "w1:usage",
    );
    expect(failureNoticeKey({ kind: "output", workflowId: "w1", text: "429 rate limit" })).toBe("w1:usage");
  });

  it("keys any other failure by its first line", () => {
    expect(failureNoticeKey({ kind: "output", workflowId: "w2", text: "Step FAILED: exit 1\nstack" })).toBe(
      "w2:Step FAILED: exit 1",
    );
  });
});

describe("createFailureNoticeDedupe", () => {
  it("shows one failure per workflow and class an hour", () => {
    let clock = 10 * FAILURE_NOTICE_REPEAT_MS;
    const repeated = createFailureNoticeDedupe(() => clock);
    const notice = { kind: "output" as const, workflowId: "w1", text: "usage limit reached" };
    expect(repeated(notice)).toBe(false);
    clock += FAILURE_NOTICE_REPEAT_MS - 1;
    expect(repeated(notice)).toBe(true);
    expect(repeated({ ...notice, workflowId: "w2" })).toBe(false);
    clock += 1;
    expect(repeated(notice)).toBe(false);
  });

  it("never holds an approval", () => {
    const repeated = createFailureNoticeDedupe(() => 0);
    const approval = { kind: "approval" as const, workflowId: "w1", text: "FAILED" };
    expect(repeated(approval)).toBe(false);
    expect(repeated(approval)).toBe(false);
  });
});
