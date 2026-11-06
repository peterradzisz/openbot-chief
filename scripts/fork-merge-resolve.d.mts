// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
// Types of the fork merge helper, for its test (the node typecheck reads no JavaScript). See docs/FORK.md.

export declare const UNMERGED_CODES: ReadonlySet<string>;
export declare function classifyConflict(
  path: string,
  code: string,
): { action: "rm" | "theirs" | "manual"; reason: string };
export declare function catalogKeys(text: string): string[];
export declare function catalogWarnings(ours: string, theirs: string): { forkKeys: string[]; dropped: string[] };
export declare function parseUnmerged(output: string): { path: string; code: string }[];
