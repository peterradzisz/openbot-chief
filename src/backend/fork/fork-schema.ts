// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.
/**
 * The fork's own database schema, kept outside upstream's numbered migrations.
 *
 * Upstream's runner (`migrateOpenBotDatabase`) requires a contiguous `schema_migrations` history and
 * stops with `NewerDatabaseError` when the database holds a version above the code's latest. The fork
 * merges upstream every couple of weeks, and upstream will ship its own next migration numbers, so a
 * fork table or column added as a numbered migration is a merge trap. Here every fork change is an
 * idempotent statement run after upstream's migrations, at every start:
 *
 * - `reconcileForkMigrations` runs BEFORE upstream's migrations and removes the version-59 row an
 *   earlier fork build wrote as its own migration (upstream's latest was 58), so upstream's runner
 *   starts.
 * - `applyForkSchema` runs AFTER them: the workflow pause column and tables, the Auto-approve column and
 *   the step decision note, and the upgrade pause.
 *
 * Upgrade pause (owner rule): after every upgrade the app comes up with every workflow held and needs a
 * manual "Resume all". `fork_state.last_app_version` records the version that ran last; a different
 * version (or the first run of this layer on a database that has workflows) sets the global pause with
 * reason `upgrade`. A restart of the same version changes nothing, so a manual resume sticks. Each
 * workflow's own `paused_at` is never touched here. `OPENBOT_NO_UPGRADE_PAUSE=1` skips the pause and
 * still records the version.
 */

import { DatabaseSync } from "node:sqlite";
import type { WorkflowScheduling } from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { version as packageVersion } from "../../../package.json";
import { migrateOpenBotDatabase } from "../openbot-database-schema";

const logger = createOpenBotLogger("fork-schema");

/** The version of this build, as Electron reports it for a packaged app (package.json). */
export const FORK_APP_VERSION: string = packageVersion;

/** The schema version an earlier fork build recorded for its own migration, above upstream's 58. */
export const FORK_LEGACY_MIGRATION_VERSION = 59;

/** The environment switch that skips the upgrade pause. The version is still recorded. */
export const NO_UPGRADE_PAUSE_ENV = "OPENBOT_NO_UPGRADE_PAUSE";

// `workflows.paused_at`: the time the user paused the workflow, or null. A paused workflow starts no run
// from a schedule, webhook, mention or GitHub event; a due occurrence is skipped, not kept. Runs that
// are open go on, and a manual run still starts. A graph save, restore or version leaves it as it is.
// ALTER TABLE puts it at the end of `workflows`.
export const FORK_WORKFLOW_PAUSED_COLUMN_SQL = "paused_at TEXT";

// `workflow_scheduling`: one row, the pause of every workflow at once. A workflow is paused when this or
// its own `paused_at` is set; resuming one leaves the other. No row reads as not paused.
// `paused_reason`: 'upgrade' when the start of a new version set it, 'manual' when a user did, NULL
// when not paused.
export const FORK_WORKFLOW_SCHEDULING_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS workflow_scheduling (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    paused_at TEXT,
    paused_reason TEXT
  );
`;
export const FORK_WORKFLOW_PAUSED_REASON_COLUMN_SQL = "paused_reason TEXT";

// `workflows.auto_approve`: 1 when the workflow decides its own approval steps (Auto-approve).
// An approval step that a run reaches while it is 1 is approved at once, with `workflow_steps.decision_note`
// saying so; an approval that already waits is left as it is. A graph save, restore or version leaves it.
export const FORK_WORKFLOW_AUTO_APPROVE_COLUMN_SQL = "auto_approve INTEGER NOT NULL DEFAULT 0";

// `workflow_steps.decision_note`: why a step was decided without a person, such as "Auto-approved by
// workflow setting". Null for every other step.
export const FORK_STEP_DECISION_NOTE_COLUMN_SQL = "decision_note TEXT";

// `fork_state`: small key/value facts of the fork layer, such as the version that ran last.
export const FORK_STATE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS fork_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export const LAST_APP_VERSION_KEY = "last_app_version";

let upstreamLatestVersion: number | undefined;

/**
 * Upstream's newest schema version, as the code in this build has it. The schema module does not export
 * it, and editing it would be a fork seam, so a new in-memory database is built once and read.
 */
export function upstreamSchemaVersion(): number {
  if (upstreamLatestVersion !== undefined) return upstreamLatestVersion;
  const probe = new DatabaseSync(":memory:");
  try {
    migrateOpenBotDatabase(probe);
    const row = probe.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
    if (!isDynamicRecord(row) || !isNumber(row.version)) throw new Error("No upstream schema version.");
    upstreamLatestVersion = row.version;
    return upstreamLatestVersion;
  } finally {
    probe.close();
  }
}

function hasTable(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => isDynamicRecord(row) && row.name === column);
}

/**
 * Removes the `schema_migrations` row of the fork's old migration 59 while upstream's latest is below
 * it AND the database carries that migration's mark, so upstream's runner does not stop with
 * `NewerDatabaseError`. The mark: the old migration made `workflow_scheduling` without the
 * `paused_reason` column that `applyForkSchema` adds at its first run, so only a database the old fork
 * build migrated and this layer has not touched yet matches. A row 59 without the mark is a genuinely
 * newer database, which upstream's runner keeps refusing. Once upstream ships a 59 this does nothing.
 * The schema that migration added stays; `applyForkSchema` owns it now. Idempotent; a new database has
 * no table yet.
 */
export function reconcileForkMigrations(
  db: DatabaseSync,
  warn: (message: string) => void = (message) => logger.warn(message),
): void {
  if (!hasTable(db, "schema_migrations")) return;
  if (FORK_LEGACY_MIGRATION_VERSION <= upstreamSchemaVersion()) return;
  if (!hasTable(db, "workflow_scheduling") || hasColumn(db, "workflow_scheduling", "paused_reason")) return;
  const removed = db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(FORK_LEGACY_MIGRATION_VERSION);
  if (Number(removed.changes) > 0) {
    warn(
      `Removed the fork's own schema migration ${FORK_LEGACY_MIGRATION_VERSION} from schema_migrations; ` +
        "the fork schema layer keeps its tables now.",
    );
  }
}

export interface ApplyForkSchemaOptions {
  /** Skip the upgrade pause; the version is still recorded. Defaults to `OPENBOT_NO_UPGRADE_PAUSE=1`. */
  skipUpgradePause?: boolean;
}

/** What `applyForkSchema` did, for tests and the start log. */
export interface ForkSchemaResult {
  /** The version that ran before, or null on the first run of this layer. */
  previousVersion: string | null;
  /** Whether this start set the global pause because of an upgrade. */
  upgradePaused: boolean;
}

/**
 * Adds the fork's columns and tables when missing and applies the upgrade pause, in one transaction.
 * Runs after `migrateOpenBotDatabase` at every start; a second run with the same version changes nothing.
 */
export function applyForkSchema(
  db: DatabaseSync,
  appVersion: string,
  now: Date,
  options: ApplyForkSchemaOptions = {},
): ForkSchemaResult {
  const skipUpgradePause = options.skipUpgradePause ?? process.env[NO_UPGRADE_PAUSE_ENV] === "1";
  const ownsTransaction = !db.isTransaction;
  if (ownsTransaction) db.exec("BEGIN IMMEDIATE");
  try {
    if (!hasColumn(db, "workflows", "paused_at")) {
      db.exec(`ALTER TABLE workflows ADD COLUMN ${FORK_WORKFLOW_PAUSED_COLUMN_SQL}`);
    }
    db.exec(FORK_WORKFLOW_SCHEDULING_SCHEMA_SQL);
    // The fork's old migration 59 made the table without the reason.
    if (!hasColumn(db, "workflow_scheduling", "paused_reason")) {
      db.exec(`ALTER TABLE workflow_scheduling ADD COLUMN ${FORK_WORKFLOW_PAUSED_REASON_COLUMN_SQL}`);
    }
    db.exec(FORK_STATE_SCHEMA_SQL);
    if (!hasColumn(db, "workflows", "auto_approve")) {
      db.exec(`ALTER TABLE workflows ADD COLUMN ${FORK_WORKFLOW_AUTO_APPROVE_COLUMN_SQL}`);
    }
    if (!hasColumn(db, "workflow_steps", "decision_note")) {
      db.exec(`ALTER TABLE workflow_steps ADD COLUMN ${FORK_STEP_DECISION_NOTE_COLUMN_SQL}`);
    }

    const stored = db.prepare("SELECT value FROM fork_state WHERE key = ?").get(LAST_APP_VERSION_KEY);
    const previousVersion = isDynamicRecord(stored) && isString(stored.value) ? stored.value : null;
    const hasWorkflows = Boolean(db.prepare("SELECT 1 FROM workflows LIMIT 1").get());
    const upgraded = previousVersion === null ? hasWorkflows : previousVersion !== appVersion;
    const upgradePaused = upgraded && !skipUpgradePause;
    if (upgradePaused) {
      db.prepare(
        `INSERT INTO workflow_scheduling (id, paused_at, paused_reason) VALUES (1, ?, 'upgrade')
         ON CONFLICT(id) DO UPDATE SET
           paused_reason = CASE WHEN workflow_scheduling.paused_at IS NULL THEN 'upgrade'
             ELSE workflow_scheduling.paused_reason END,
           paused_at = COALESCE(workflow_scheduling.paused_at, excluded.paused_at)`,
      ).run(now.toISOString());
    }
    if (previousVersion !== appVersion) {
      db.prepare(
        "INSERT INTO fork_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(LAST_APP_VERSION_KEY, appVersion);
    }
    if (ownsTransaction) db.exec("COMMIT");
    if (upgradePaused) {
      logger.warn(
        `Paused every workflow after the upgrade from ${previousVersion ?? "an earlier build"} to ${appVersion}; ` +
          "resume them on All workflows.",
      );
    }
    return { previousVersion, upgradePaused };
  } catch (error) {
    if (ownsTransaction && db.isTransaction) db.exec("ROLLBACK");
    logger.error("The fork schema could not be applied.", toLogValue(error));
    throw error;
  }
}

/** Reads the pause of every workflow. No row reads as not paused. */
export function readWorkflowScheduling(db: DatabaseSync): WorkflowScheduling {
  const row = db
    .prepare(
      `SELECT s.paused_at, s.paused_reason,
         (SELECT value FROM fork_state WHERE key = ?) AS app_version
       FROM workflow_scheduling AS s WHERE s.id = 1`,
    )
    .get(LAST_APP_VERSION_KEY);
  if (!isDynamicRecord(row) || !isString(row.paused_at)) {
    return { pausedAt: null, pausedReason: null, upgradeVersion: null };
  }
  // A pause from the fork's old migration has no reason; it was a user's.
  const pausedReason = row.paused_reason === "upgrade" ? "upgrade" : "manual";
  return {
    pausedAt: row.paused_at,
    pausedReason,
    upgradeVersion: pausedReason === "upgrade" && isString(row.app_version) ? row.app_version : null,
  };
}

/**
 * Pauses or resumes every workflow at once. A pause keeps the time and the reason of a pause that is
 * already on; a new one is `manual`. A resume clears both. Each workflow's own pause stays as it is.
 */
export function writeWorkflowScheduling(db: DatabaseSync, paused: boolean, now: Date): WorkflowScheduling {
  if (paused) {
    db.prepare(
      `INSERT INTO workflow_scheduling (id, paused_at, paused_reason) VALUES (1, ?, 'manual')
       ON CONFLICT(id) DO UPDATE SET
         paused_reason = CASE WHEN workflow_scheduling.paused_at IS NULL THEN 'manual'
           ELSE workflow_scheduling.paused_reason END,
         paused_at = COALESCE(workflow_scheduling.paused_at, excluded.paused_at)`,
    ).run(now.toISOString());
  } else {
    db.prepare(
      `INSERT INTO workflow_scheduling (id, paused_at, paused_reason) VALUES (1, NULL, NULL)
       ON CONFLICT(id) DO UPDATE SET paused_at = NULL, paused_reason = NULL`,
    ).run();
  }
  return readWorkflowScheduling(db);
}
