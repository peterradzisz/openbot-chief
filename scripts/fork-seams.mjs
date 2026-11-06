#!/usr/bin/env node
// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
// Fork seams report (fork-owned, see docs/FORK.md). Advisory: always exits 0.
//
// Lists every upstream-owned file that differs from the last upstream release tag the fork merged,
// with +/- line counts, and every `FORK:` marker in upstream-owned files. The goal is a small merge
// surface: fork logic lives in fork-owned files, upstream files carry only one-line `// FORK:` hooks.
//
//   bun scripts/fork-seams.mjs                  # base = newest v* tag that is an ancestor of HEAD
//   bun scripts/fork-seams.mjs --base v0.63.0   # explicit base
//   bun scripts/fork-seams.mjs --json           # machine-readable
//   bun scripts/fork-seams.mjs --worktree       # compare the working tree instead of HEAD
//
// Works with plain Node too (`node scripts/fork-seams.mjs`); no dependencies.

import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------------------------
// Fork-owned paths. A file matching any of these is the fork's own and never counts as a seam.
// Keep this list short and easy to edit; `**` spans directories, `*` stays inside one.
// ---------------------------------------------------------------------------------------------
const FORK_OWNED_GLOBS = [
  "src/backend/fork/**",
  "src/main/fork/**",
  "src/preload/fork/**",
  "src/renderer/src/fork/**",
  "packages/**/fork/**",
  "packages/i18n/src/messages/*/fork.ts",
  "scripts/fork-*",
  "docs/FORK.md",
  "changelog.d/**",
  // Files the fork added in upstream directories that are fork-owned by agreement (e.g. the
  // workflow work in flight). Add exact paths or globs here.
];

/** Test files the fork added (absent at the base tag) are fork-owned too. */
const FORK_ONLY_TEST = /\.test\.tsx?$/u;

const TARGET = 10;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      index += 1;
      if (glob[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "u");
}

const forkOwnedPatterns = FORK_OWNED_GLOBS.map(globToRegExp);

function parseArgs(argv) {
  const options = { base: null, json: false, worktree: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--worktree") options.worktree = true;
    else if (arg === "--base") options.base = argv[++index] ?? null;
    else if (arg.startsWith("--base=")) options.base = arg.slice("--base=".length);
  }
  return options;
}

function defaultBase() {
  const tags = git(["tag", "--list", "v*", "--sort=-v:refname", "--merged", "HEAD"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return tags[0] ?? null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const base = options.base ?? defaultBase();
  if (!base) {
    console.log("fork-seams: no v* tag is an ancestor of HEAD; pass --base <tag>.");
    return;
  }
  const range = options.worktree ? [base] : [base, "HEAD"];

  // A = the fork added the file, D = the fork deleted an upstream file (a modify/delete conflict
  // whenever upstream edits it), M = the fork edited an upstream file.
  const statusOf = new Map();
  for (const line of git(["diff", "--no-renames", "--name-status", ...range, "--"]).split("\n")) {
    if (!line) continue;
    const [code, ...rest] = line.split("\t");
    statusOf.set(rest.join("\t"), code === "A" ? "new" : code === "D" ? "deleted" : "modified");
  }
  const files = [];
  for (const line of git(["diff", "--no-renames", "--numstat", ...range, "--"]).split("\n")) {
    if (!line) continue;
    const [plus, minus, ...rest] = line.split("\t");
    const path = rest.join("\t");
    const status = statusOf.get(path) ?? "modified";
    const forkOwned =
      forkOwnedPatterns.some((pattern) => pattern.test(path)) || (status === "new" && FORK_ONLY_TEST.test(path));
    files.push({
      path,
      added: plus === "-" ? null : Number(plus),
      removed: minus === "-" ? null : Number(minus),
      status,
      forkOwned,
    });
  }
  const upstreamOwned = files.filter((file) => !file.forkOwned);

  const grepArgs = ["grep", "-n", "-I", "-e", "FORK:"];
  if (!options.worktree) grepArgs.push("HEAD");
  let grepOutput = "";
  try {
    grepOutput = git(grepArgs);
  } catch {
    // git grep exits 1 when nothing matches.
  }
  const markers = [];
  for (const line of grepOutput.split("\n")) {
    if (!line) continue;
    const withoutRev = options.worktree ? line : line.slice("HEAD:".length);
    const match = /^(.*?):(\d+):(.*)$/u.exec(withoutRev);
    if (!match) continue;
    const [, path, lineNumber, text] = match;
    if (forkOwnedPatterns.some((pattern) => pattern.test(path))) continue;
    markers.push({ path, line: Number(lineNumber), text: text.trim() });
  }

  const count = (status) => upstreamOwned.filter((file) => file.status === status).length;
  const summary = `${upstreamOwned.length} upstream-owned files carry fork edits (target <= ${TARGET})`;
  const breakdown =
    `  ${count("modified")} edit an upstream file, ${count("deleted")} delete one (modify/delete conflict when ` +
    `upstream touches it), ${count("new")} are fork-added files in upstream directories (rarely conflict; ` +
    "candidates to move under a fork/ directory)";

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          base,
          compared: options.worktree ? "worktree" : "HEAD",
          target: TARGET,
          summary,
          counts: { modified: count("modified"), deleted: count("deleted"), new: count("new") },
          upstreamOwned,
          markers,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`fork-seams: ${options.worktree ? "working tree" : "HEAD"} vs ${base}\n`);
  console.log("Upstream-owned files that differ from the base (+added -removed):");
  const sorted = [...upstreamOwned].sort(
    (left, right) => (right.added ?? 0) + (right.removed ?? 0) - ((left.added ?? 0) + (left.removed ?? 0)),
  );
  for (const file of sorted) {
    const counts = file.added === null ? "binary" : `+${file.added} -${file.removed}`;
    const tag = file.status === "modified" ? "" : `[${file.status}] `;
    console.log(`  ${counts.padEnd(14)} ${tag}${file.path}`);
  }
  console.log(`\nFORK: markers in upstream-owned files (${markers.length}):`);
  for (const marker of markers) console.log(`  ${marker.path}:${marker.line}  ${marker.text.slice(0, 100)}`);
  console.log(`\n${summary}`);
  console.log(breakdown);
}

try {
  main();
} catch (error) {
  console.log(`fork-seams: could not build the report: ${error instanceof Error ? error.message : String(error)}`);
}
process.exit(0);
