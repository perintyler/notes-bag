import { migrateStore } from "@barry-rocks/sdk/stores/migrate";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { bagDataDir } from "@barry-rocks/sdk/services/home";

export type NotesDb = Database.Database;

let _db: NotesDb | null = null;

export function getDbPath(): string {
  return (
    process.env.BARRY_NOTES_DB ??
    join(bagDataDir("notes"), "notes.db")
  );
}

/**
 * Migrations are inline TypeScript rather than a `migrations/` dir of .sql
 * files: reading SQL via `import.meta.url` breaks once esbuild bundles this
 * bag into ~/Library/Caches/Barry/bags/ — the same reason bags/plans,
 * bags/memory and bags/approvals inline theirs.
 *
 * Append only. Never edit a shipped migration — add a new one.
 */
const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: "001_initial",
    sql: `
      CREATE TABLE notes (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL DEFAULT '',
        content    TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
    `,
  },
];

function migrate(db: NotesDb): void {
  migrateStore(db, MIGRATIONS, "notes.db");
}

export function getDb(path = getDbPath()): NotesDb {
  if (!_db) {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    // WAL: the service, the tools and the phone hold this file concurrently.
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    migrate(db);
    _db = db;
  }
  return _db;
}

/** Test seam: point the module at an in-memory database. */
export function setDb(db: NotesDb): void {
  db.pragma("foreign_keys = ON");
  migrate(db);
  _db = db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}
