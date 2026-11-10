# Fork rules (personal fork of nightly-labs/openbot)

This repository is a personal, noncommercial fork of upstream OpenBot. It merges upstream every two weeks, on the
release tag (`v0.63.0`, `v0.64.0`, …). Every fork edit inside a file upstream also changes is a
possible merge conflict: the v0.63.0 merge had 41, mostly fork logic written inside upstream-owned
files. These rules keep that surface small.

## Ownership

- **Fork-owned**: anything under `src/backend/fork/`, `src/main/fork/`, `src/preload/fork/`,
  `src/renderer/src/fork/`, `packages/*/…/fork/`, the i18n area `packages/i18n/src/messages/*/fork.ts`,
  `changelog.d/`, `scripts/fork-*`, this file, and test files the fork added. The list lives at the top of
  `scripts/fork-seams.mjs` (`FORK_OWNED_GLOBS`); edit it there.
- **Upstream-owned**: everything else, including fork-added files that sit in upstream directories
  (they rarely conflict, but they are candidates to move under a `fork/` directory).

## Rules

1. **Fork logic lives in fork-owned files.** A knob, a parser, a dedupe, a stylesheet, a helper:
   write it in a `fork/` directory next to the layer it belongs to (backend, main, renderer, package).
2. **Upstream files carry only hooks**, each marked `// FORK:` (or `/* FORK: */` in CSS): an import
   plus one call, one extra condition, one `@import`. Aim for 1-3 lines per upstream file. Keep the
   upstream line shape where you can (`const x = forkThing(); // FORK:`), so a merge sees a one-line change.
3. **Behaviour stays where the hook says.** A CSS move keeps cascade order: import the fork stylesheet
   right after the upstream file whose rules it extends. A JS move keeps evaluation order and return values.
4. **Merge every two weeks, on the release tag. No cherry-picks** from upstream between merges: a
   cherry-pick lands again in the next merge as a conflict of the fork with itself.
5. **Schema changes stay out of upstream's numbered migrations** (`src/backend/fork/fork-schema.ts`).
6. **Strings**: new fork strings go in the fork's own i18n area, `packages/i18n/src/messages/en/fork.ts`,
   under `fork.` keys (`fork.workflow.overview.*`); `en/index.ts` registers it with one import and one
   spread. Each locale has an empty `fork.ts` so `i18n:check` finds the module; to translate, fill it
   and spread it in that locale's `index.ts`. Exception: host text the backend writes with `sourceText`
   (such as `error.workflow.autoApproved`) stays in its `error/` or `status/` area, because `sourceText`
   reads only the source catalog and a `fork.` key there would cost an edit to upstream `source.ts`.
   Older fork strings still sit in upstream areas (`settings.*`, `provider.model.*`) as marked blocks;
   move them to `fork.ts` when you next touch them.

## The seams report

```sh
bun scripts/fork-seams.mjs                  # HEAD vs the newest v* tag that is an ancestor of HEAD
bun scripts/fork-seams.mjs --base v0.63.0   # explicit base
bun scripts/fork-seams.mjs --worktree       # include uncommitted edits
bun scripts/fork-seams.mjs --json           # machine-readable
```

It lists every upstream-owned file that differs from the base (`+added -removed`, tagged `[new]` or
`[deleted]`), every `FORK:` marker in upstream-owned files, and the summary line
`N upstream-owned files carry fork edits (target <= 10)`. It is advisory and always exits 0. Run it
before and after a merge, and when a change touches an upstream file.

Current state of this public tree vs `v0.63.0` (2026-11-06, `--base v0.63.0`):
`112 upstream-owned files carry fork edits (target <= 10)` — 72 edit an upstream file, 16 delete one,
24 are fork-added files in upstream directories. The count includes the public identity edits
(README, package.json, electron-builder.yml, the release feed, the agent workspace root) and the
removed `.github/workflows`. In this repository v0.63.0 is not an ancestor of `main` (the update
was applied as a regular commit), so pass `--base v0.63.0` explicitly.

## Fork modules and their hooks

Fork behaviour sits in fork-owned files; the upstream files that call into them carry one-line
`// FORK:` hooks (the seams report lists each one). Where to look for what the fork adds:

| Module | What it does | Hooks in upstream files |
|---|---|---|
| `src/backend/fork/usage-limit-fork.ts` | Failover that comes back (two-minute sweep of idle agents on a backup), growing holds for models that keep failing and growing probe waits for limits with no known reset, and the usage overlay that shows a spent Gemini quota as spent | `agent/usage-limit-gate.ts` (hold, probe wait, release, completed, dispose, `spentModels`), `agent-service.ts` (boot sweep, `getUsage`) |
| `src/backend/fork/workflow-run-fork.ts` | Workflow pause, Auto-approve notes and the Reporting read (one batched usage query, prune at most every ten minutes) | `workflows/workflow-run-store.ts`, `workflows/workflows.ts` |

The renderer side of the All workflows page is `src/renderer/src/features/workflows/AllWorkflowsPage.tsx`
(a fork-added file in an upstream directory, so a candidate to move under `src/renderer/src/fork/`).

## Pre-merge checklist

1. Tag the current state: `git tag fork-pre-<version>`.
2. Merge in a **separate worktree** (`git worktree add ../openbot-merge<ver> -b merge/v<ver>`), never in
   the live checkout.
3. Dry run first: `git merge-tree --write-tree HEAD v<ver>` and read the conflict list; compare it with
   `bun scripts/fork-seams.mjs`.
4. Merge, then run `node scripts/fork-merge-resolve.mjs` (dry run) and `… --apply`: it refuses to run
   without a merge in progress, `git rm`s modify/delete conflicts in `.github/workflows/*`, takes
   upstream's side of the provider catalogs (`messages/*/provider.ts`, `messages/*/error/provider.ts`)
   with a warning for each `fork.` key or fork-only key that this drops (re-add those in `fork.ts`), and
   lists what is left for a human. Resolve the rest, then run the typechecks (`typecheck:contracts`, `typecheck:i18n`, `typecheck:node`,
   `typecheck:renderer`, `typecheck:storybook`) and the tests (`bunx vitest run --maxWorkers=2 …`).
5. Run the database migration on a **copy** of the live database, never on the original.
6. Smoke-test the merged build on an **isolated profile** (its own user-data directory).
7. Back up the live profile and database.
8. Cut over.
9. After an upgrade everything starts **paused** (the fork's upgrade pause): check the app, then
   Resume all.
