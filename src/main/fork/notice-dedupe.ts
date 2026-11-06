// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
import type { WorkflowNotice } from "../../backend/workflows/workflows";

/**
 * A failure notice repeats while a plan is exhausted: every run of every lane on that plan posts the
 * same error. One toast per workflow and error class per hour is enough (owner 2026-11-02:
 * token-exceeded spam). Approvals and non-failure results never wait. Called from
 * renderer-forwarders.ts through a `// FORK:` hook.
 */
export const FAILURE_NOTICE_REPEAT_MS = 60 * 60 * 1000;

/** Past this many remembered keys the memory starts over, so it cannot grow without bound. */
const REMEMBERED_KEY_LIMIT = 200;

type NoticeFields = Pick<WorkflowNotice, "kind" | "workflowId" | "text">;

/** The workflow and error class a failure notice belongs to, or null for a notice that always shows. */
export function failureNoticeKey(notice: NoticeFields): string | null {
  if (notice.kind !== "output") return null;
  const text = notice.text ?? "";
  if (!/FAILED|usage limit|token|quota|rate limit/i.test(text)) return null;
  const errorClass = /usage limit|token|quota|rate limit/i.test(text)
    ? "usage"
    : (text.split("\n")[0] ?? "").slice(0, 80);
  return `${notice.workflowId}:${errorClass}`;
}

/**
 * A filter that answers true for a notice to drop: a failure of the same workflow and class that
 * showed less than `repeatMs` ago. A notice it lets through is remembered as shown.
 */
export function createFailureNoticeDedupe(
  now: () => number = Date.now,
  repeatMs: number = FAILURE_NOTICE_REPEAT_MS,
): (notice: NoticeFields) => boolean {
  const shown = new Map<string, number>();
  return (notice) => {
    const key = failureNoticeKey(notice);
    if (!key) return false;
    const last = shown.get(key) ?? 0;
    if (now() - last < repeatMs) return true;
    if (shown.size > REMEMBERED_KEY_LIMIT) shown.clear();
    shown.set(key, now());
    return false;
  };
}
