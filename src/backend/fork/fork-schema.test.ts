// @vitest-environment node
// Copyright (c) 2026 Peter Radziszewski. Independently developed for this fork. All rights reserved.

// The fork's schema layer on the real SQLite: the workflow pause schema is added after upstream's
// migrations, the old fork migration 59 row is removed before them, and every upgrade holds all
// workflows until a manual resume.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { OpenBotDatabase } from "../openbot-database";
import { migrateOpenBotDatabase, NewerDatabaseError } from "../openbot-database-schema";
import {
  applyForkSchema,
  FORK_APP_VERSION,
  FORK_LEGACY_MIGRATION_VERSION,
  NO_UPGRADE_PAUSE_ENV,
  readWorkflowScheduling,
  reconcileForkMigrations,
  upstreamSchemaVersion,
  writeWorkflowScheduling,
} from "./fork-schema";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const LATER = new Date("2026-11-07T08:00:00.000Z");

const databases: DatabaseSync[] = [];
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A database at upstream's latest schema, as upstream's own start leaves it. */
function upstreamDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  migrateOpenBotDatabase(db, { appliedAt: "2026-11-01T00:00:00.000Z" });
  return db;
}

function addWorkflow(db: DatabaseSync, id: string): void {
  db.prepare(
    `INSERT INTO workflows (workflow_id, title, created_at, updated_at)
     VALUES (?, ?, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
  ).run(id, id);
}

/** What the fork's old migration 59 left: the column, the reason-less table, every workflow paused, row 59. */
function applyLegacyMigration59(db: DatabaseSync): void {
  db.exec("ALTER TABLE workflows ADD COLUMN paused_at TEXT");
  db.exec("UPDATE workflows SET paused_at = '2026-11-06T09:00:00.000Z'");
  db.exec("CREATE TABLE workflow_scheduling (id INTEGER PRIMARY KEY CHECK(id = 1), paused_at TEXT)");
  db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, '2026-11-06T09:00:00.000Z')").run(
    FORK_LEGACY_MIGRATION_VERSION,
  );
}

const lastVersion = (db: DatabaseSync) =>
  db.prepare("SELECT value FROM fork_state WHERE key = 'last_app_version'").get()?.value ?? null;

const pausedOf = (db: DatabaseSync) =>
  db.prepare("SELECT workflow_id, paused_at FROM workflows ORDER BY workflow_id").all();

const columnsOf = (db: DatabaseSync, table: string) =>
  db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name);

describe("fork schema", () => {
  it("is outside upstream's numbered migrations: upstream's latest stays below the fork's old 59", () => {
    expect(upstreamSchemaVersion()).toBe(58);
    expect(FORK_LEGACY_MIGRATION_VERSION).toBeGreaterThan(upstreamSchemaVersion());
  });

  it("pauses nothing on a new install and records the version", () => {
    const db = upstreamDatabase();
    const result = applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: false });

    expect(result).toEqual({ previousVersion: null, upgradePaused: false });
    expect(columnsOf(db, "workflows")).toContain("paused_at");
    expect(columnsOf(db, "workflow_scheduling")).toEqual(["id", "paused_at", "paused_reason"]);
    expect(lastVersion(db)).toBe("0.63.0");
    expect(readWorkflowScheduling(db)).toEqual({ pausedAt: null, pausedReason: null, upgradeVersion: null });
  });

  it("holds every workflow at the first run on an existing database with workflows", () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    addWorkflow(db, "b");

    const result = applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: false });

    expect(result).toEqual({ previousVersion: null, upgradePaused: true });
    expect(readWorkflowScheduling(db)).toEqual({
      pausedAt: NOW.toISOString(),
      pausedReason: "upgrade",
      upgradeVersion: "0.63.0",
    });
    // The upgrade pause is global: no workflow gets its own pause.
    expect(pausedOf(db)).toEqual([
      { workflow_id: "a", paused_at: null },
      { workflow_id: "b", paused_at: null },
    ]);
    expect(lastVersion(db)).toBe("0.63.0");
  });

  it("keeps a manual resume across a restart of the same version", () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: false });
    expect(writeWorkflowScheduling(db, false, NOW)).toEqual({
      pausedAt: null,
      pausedReason: null,
      upgradeVersion: null,
    });

    expect(applyForkSchema(db, "0.63.0", LATER, { skipUpgradePause: false }).upgradePaused).toBe(false);
    expect(readWorkflowScheduling(db).pausedAt).toBeNull();
  });

  it("holds every workflow again after a version change", () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: false });
    writeWorkflowScheduling(db, false, NOW);

    const result = applyForkSchema(db, "0.64.0", LATER, { skipUpgradePause: false });

    expect(result).toEqual({ previousVersion: "0.63.0", upgradePaused: true });
    expect(readWorkflowScheduling(db)).toEqual({
      pausedAt: LATER.toISOString(),
      pausedReason: "upgrade",
      upgradeVersion: "0.64.0",
    });
    expect(lastVersion(db)).toBe("0.64.0");
  });

  it("keeps a manual pause and its time when an upgrade finds it on", () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: true });
    writeWorkflowScheduling(db, true, NOW);

    applyForkSchema(db, "0.64.0", LATER, { skipUpgradePause: false });

    expect(readWorkflowScheduling(db)).toEqual({
      pausedAt: NOW.toISOString(),
      pausedReason: "manual",
      upgradeVersion: null,
    });
  });

  it("leaves each workflow's own pause as it is, also after Resume all", () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    addWorkflow(db, "b");
    applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: false });
    db.exec("UPDATE workflows SET paused_at = '2026-11-06T10:00:00.000Z' WHERE workflow_id = 'b'");

    applyForkSchema(db, "0.64.0", LATER, { skipUpgradePause: false });
    expect(pausedOf(db)).toEqual([
      { workflow_id: "a", paused_at: null },
      { workflow_id: "b", paused_at: "2026-11-06T10:00:00.000Z" },
    ]);
    writeWorkflowScheduling(db, false, LATER);
    expect(pausedOf(db)).toEqual([
      { workflow_id: "a", paused_at: null },
      { workflow_id: "b", paused_at: "2026-11-06T10:00:00.000Z" },
    ]);
  });

  it("changes nothing when it runs twice", () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: false });
    const schema = () => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    const before = { schema: schema(), scheduling: readWorkflowScheduling(db), version: lastVersion(db) };

    expect(applyForkSchema(db, "0.63.0", LATER, { skipUpgradePause: false })).toEqual({
      previousVersion: "0.63.0",
      upgradePaused: false,
    });
    expect({ schema: schema(), scheduling: readWorkflowScheduling(db), version: lastVersion(db) }).toEqual(before);
  });

  it(`skips the pause with ${NO_UPGRADE_PAUSE_ENV}=1 and still records the version`, () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    const saved = process.env[NO_UPGRADE_PAUSE_ENV];
    process.env[NO_UPGRADE_PAUSE_ENV] = "1";
    try {
      expect(applyForkSchema(db, "0.63.0", NOW).upgradePaused).toBe(false);
      expect(applyForkSchema(db, "0.64.0", LATER).upgradePaused).toBe(false);
    } finally {
      if (saved === undefined) delete process.env[NO_UPGRADE_PAUSE_ENV];
      else process.env[NO_UPGRADE_PAUSE_ENV] = saved;
    }
    expect(readWorkflowScheduling(db).pausedAt).toBeNull();
    expect(lastVersion(db)).toBe("0.64.0");
  });

  it("rolls back every change when a step fails", () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    db.exec("CREATE TABLE fork_state (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(value <> 'bad'))");
    expect(() => applyForkSchema(db, "bad", NOW, { skipUpgradePause: false })).toThrow();
    expect(columnsOf(db, "workflows")).not.toContain("paused_at");
    expect(columnsOf(db, "workflows")).not.toContain("auto_approve");
    expect(columnsOf(db, "workflow_steps")).not.toContain("decision_note");
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'workflow_scheduling'").get()).toBeUndefined();
  });

  it("adds Auto-approve, off for every workflow, and the step decision note, once", () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: true });

    expect(columnsOf(db, "workflows")).toContain("auto_approve");
    expect(columnsOf(db, "workflow_steps")).toContain("decision_note");
    expect(db.prepare("SELECT workflow_id, auto_approve FROM workflows").all()).toEqual([
      { workflow_id: "a", auto_approve: 0 },
    ]);
    // A workflow made later starts with it off too.
    addWorkflow(db, "b");
    expect(db.prepare("SELECT auto_approve FROM workflows WHERE workflow_id = 'b'").get()).toEqual({
      auto_approve: 0,
    });

    // A second run, also of a new version, adds nothing and keeps a value that is on.
    db.exec("UPDATE workflows SET auto_approve = 1 WHERE workflow_id = 'a'");
    const schema = () => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    const before = schema();
    applyForkSchema(db, "0.63.0", LATER, { skipUpgradePause: true });
    applyForkSchema(db, "0.64.0", LATER, { skipUpgradePause: true });
    expect(schema()).toEqual(before);
    expect(db.prepare("SELECT auto_approve FROM workflows WHERE workflow_id = 'a'").get()).toEqual({
      auto_approve: 1,
    });
  });

  it("adds Auto-approve to a database that an earlier fork layer already gave the pause schema", () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    // The pause layer as the build before Auto-approve left it.
    db.exec("ALTER TABLE workflows ADD COLUMN paused_at TEXT");
    db.exec(
      "CREATE TABLE workflow_scheduling (id INTEGER PRIMARY KEY CHECK(id = 1), paused_at TEXT, paused_reason TEXT)",
    );
    db.exec("CREATE TABLE fork_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec("INSERT INTO fork_state (key, value) VALUES ('last_app_version', '0.63.0')");

    applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: false });
    expect(columnsOf(db, "workflows").slice(-2)).toEqual(["paused_at", "auto_approve"]);
    expect(columnsOf(db, "workflow_steps").at(-1)).toBe("decision_note");
    expect(readWorkflowScheduling(db).pausedAt).toBeNull();
  });
});

describe("fork migration reconcile", () => {
  it("lets a database with the fork's old migration 59 start, then migrates and applies the fork schema", () => {
    const db = upstreamDatabase();
    addWorkflow(db, "a");
    addWorkflow(db, "b");
    applyLegacyMigration59(db);
    expect(() => migrateOpenBotDatabase(db)).toThrow(NewerDatabaseError);

    const warnings: string[] = [];
    reconcileForkMigrations(db, (message) => warnings.push(message));
    expect(warnings).toHaveLength(1);
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version > 58").all()).toEqual([]);

    migrateOpenBotDatabase(db);
    expect(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({ version: 58 });
    applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: false });

    expect(columnsOf(db, "workflow_scheduling")).toEqual(["id", "paused_at", "paused_reason"]);
    expect(readWorkflowScheduling(db)).toEqual({
      pausedAt: NOW.toISOString(),
      pausedReason: "upgrade",
      upgradeVersion: "0.63.0",
    });
    // The pauses the old migration set stay.
    expect(pausedOf(db)).toEqual([
      { workflow_id: "a", paused_at: "2026-11-06T09:00:00.000Z" },
      { workflow_id: "b", paused_at: "2026-11-06T09:00:00.000Z" },
    ]);
  });

  it("keeps a row 59 that the old fork migration did not write, so a newer database is still refused", () => {
    const db = upstreamDatabase();
    applyForkSchema(db, "0.63.0", NOW, { skipUpgradePause: false });
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, 'now')").run(
      FORK_LEGACY_MIGRATION_VERSION,
    );
    const warnings: string[] = [];
    reconcileForkMigrations(db, (message) => warnings.push(message));
    expect(warnings).toEqual([]);
    expect(() => migrateOpenBotDatabase(db)).toThrow(NewerDatabaseError);
  });

  it("does nothing on a new database, on one without row 59, and when it runs again", () => {
    const fresh = new DatabaseSync(":memory:");
    databases.push(fresh);
    const warnings: string[] = [];
    reconcileForkMigrations(fresh, (message) => warnings.push(message));
    expect(fresh.prepare("SELECT name FROM sqlite_master").all()).toEqual([]);

    const db = upstreamDatabase();
    const before = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
    reconcileForkMigrations(db, (message) => warnings.push(message));
    reconcileForkMigrations(db, (message) => warnings.push(message));
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual(before);
    expect(warnings).toEqual([]);
  });

  it("opens the live shape through OpenBotDatabase: row 59 gone, the pause schema there, every workflow held", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbot-fork-schema-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const seeded = new DatabaseSync(join(directory, "openbot.db"));
    migrateOpenBotDatabase(seeded, { appliedAt: "2026-11-01T00:00:00.000Z" });
    addWorkflow(seeded, "a");
    applyLegacyMigration59(seeded);
    seeded.close();

    const saved = process.env[NO_UPGRADE_PAUSE_ENV];
    delete process.env[NO_UPGRADE_PAUSE_ENV];
    const database = new OpenBotDatabase(directory);
    try {
      await Effect.runPromise(database.initialize());
      const connection = database.connection;
      expect(connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()).toEqual({
        version: 58,
      });
      expect(readWorkflowScheduling(connection)).toMatchObject({
        pausedReason: "upgrade",
        upgradeVersion: FORK_APP_VERSION,
      });
      expect(lastVersion(connection)).toBe(FORK_APP_VERSION);
      expect(pausedOf(connection)).toEqual([{ workflow_id: "a", paused_at: "2026-11-06T09:00:00.000Z" }]);
      // Auto-approve: the column is there and off for the workflow that existed; the steps keep a note.
      expect(connection.prepare("SELECT auto_approve FROM workflows").all()).toEqual([{ auto_approve: 0 }]);
      expect(columnsOf(connection, "workflow_steps")).toContain("decision_note");
    } finally {
      database.close();
      if (saved !== undefined) process.env[NO_UPGRADE_PAUSE_ENV] = saved;
    }
  });
});
