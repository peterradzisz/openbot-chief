#!/usr/bin/env node
// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
// Fork merge helper (fork-owned, see docs/FORK.md). Resolves the conflicts of an upstream merge that
// always resolve the same way, and lists the rest for a human.
//
//   node scripts/fork-merge-resolve.mjs           # dry run: prints what it would do
//   node scripts/fork-merge-resolve.mjs --apply   # does it
//
// It refuses to run unless a merge is in progress. Rules:
// - `.github/workflows/*` with a modify/delete conflict: the fork deletes upstream's workflows, so
//   `git rm` the file.
// - Provider i18n catalogs (`packages/i18n/src/messages/<locale>/provider.ts` and
//   `…/<locale>/error/provider.ts`): take upstream's side (`--theirs`). It warns about `fork.` keys on
//   the fork's side, and about any key only the fork's side has, since taking upstream's side drops it.
// - Anything else stays for a human.
//
// No dependencies; works with Node or Bun.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** The two-letter `git status` codes of an unmerged path. */
export const UNMERGED_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
/** Modify/delete: one side deleted the file, the other changed it. */
const MODIFY_DELETE = new Set(["UD", "DU"]);
/** Both sides changed or added the file. */
const BOTH_CHANGED = new Set(["UU", "AA"]);

const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+$/u;
const PROVIDER_CATALOG = /^packages\/i18n\/src\/messages\/[^/]+\/(?:error\/)?provider\.ts$/u;

/**
 * What to do with one unmerged path. Pure: it reads only its arguments.
 * @param {string} path repository-relative, with `/`
 * @param {string} code the two-letter `git status --porcelain` code
 * @returns {{ action: "rm" | "theirs" | "manual"; reason: string }}
 */
export function classifyConflict(path, code) {
  if (!UNMERGED_CODES.has(code)) return { action: "manual", reason: `not an unmerged code: ${code}` };
  if (WORKFLOW_FILE.test(path) && MODIFY_DELETE.has(code))
    return { action: "rm", reason: "the fork deletes upstream's GitHub workflows" };
  if (PROVIDER_CATALOG.test(path) && BOTH_CHANGED.has(code))
    return { action: "theirs", reason: "provider catalog: upstream's side wins" };
  return { action: "manual", reason: "needs a human" };
}

/**
 * The quoted keys of a message catalog, in order. Pure.
 * @param {string} text
 * @returns {string[]}
 */
export function catalogKeys(text) {
  return [...text.matchAll(/^\s*"([^"\n]+)"\s*:/gmu)].map((match) => match[1] ?? "");
}

/**
 * What taking upstream's side of a catalog loses: the fork's `fork.` keys, and every key only the fork's
 * side has. Pure.
 * @param {string} ours
 * @param {string} theirs
 * @returns {{ forkKeys: string[]; dropped: string[] }}
 */
export function catalogWarnings(ours, theirs) {
  const oursKeys = catalogKeys(ours);
  const theirsKeys = new Set(catalogKeys(theirs));
  return {
    forkKeys: oursKeys.filter((key) => key.startsWith("fork.")),
    dropped: oursKeys.filter((key) => !theirsKeys.has(key)),
  };
}

/**
 * The unmerged paths of `git status --porcelain=v1 -z`. Pure.
 * @param {string} output
 * @returns {{ path: string; code: string }[]}
 */
export function parseUnmerged(output) {
  return output
    .split("\0")
    .filter((entry) => entry.length > 3)
    .map((entry) => ({ code: entry.slice(0, 2), path: entry.slice(3) }))
    .filter((entry) => UNMERGED_CODES.has(entry.code));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function stage(number, path) {
  try {
    return git(["show", `:${number}:${path}`]);
  } catch {
    return "";
  }
}

function mergeInProgress() {
  try {
    git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function main(argv) {
  const apply = argv.includes("--apply");
  if (!mergeInProgress()) {
    console.error("fork-merge-resolve: no merge is in progress (no MERGE_HEAD). Nothing to do.");
    return 1;
  }
  const unmerged = parseUnmerged(git(["status", "--porcelain=v1", "-z", "--untracked-files=no"]));
  const resolved = [];
  const manual = [];
  for (const { path, code } of unmerged) {
    const { action, reason } = classifyConflict(path, code);
    if (action === "manual") {
      manual.push(`  ${code} ${path}`);
      continue;
    }
    if (action === "theirs") {
      const { forkKeys, dropped } = catalogWarnings(stage(2, path), stage(3, path));
      for (const key of forkKeys)
        console.warn(`WARN ${path}: fork key ${key} is on the fork's side; move it to fork.ts`);
      for (const key of dropped)
        if (!forkKeys.includes(key)) console.warn(`WARN ${path}: ${key} is only on the fork's side and is dropped`);
      if (apply) {
        git(["checkout", "--theirs", "--", path]);
        git(["add", "--", path]);
      }
    } else if (apply) {
      git(["rm", "-q", "--", path]);
    }
    resolved.push(
      `  ${apply ? "" : "would "}${action === "rm" ? "git rm" : "take --theirs"}  ${code} ${path}  (${reason})`,
    );
  }
  console.log(`${apply ? "Resolved" : "Would resolve"} ${resolved.length} of ${unmerged.length} conflicts:`);
  for (const line of resolved) console.log(line);
  console.log(`Left for a human: ${manual.length}`);
  for (const line of manual) console.log(line);
  if (!apply && resolved.length > 0) console.log("Dry run. Run with --apply to resolve them.");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2));
