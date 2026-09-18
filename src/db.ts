import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

export type NotesDb = Database.Database;

let _db: NotesDb | null = null;

export function getDbPath(): string {
  return (
    process.env.BARRY_NOTES_DB ??
    join(process.env.BARRY_HOME ?? join(homedir(), ".barry"), "notes.db")
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const row = db
    .prepare("SELECT coalesce(max(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };

  if (row.version > MIGRATIONS.length) {
    throw new Error(
      `notes.db is at schema version ${row.version}, but this build only knows ` +
        `${MIGRATIONS.length}. Update barry before using this database.`,
    );
  }

  for (let v = row.version; v < MIGRATIONS.length; v++) {
    const m = MIGRATIONS[v]!;
    const apply = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
        v + 1,
        m.name,
      );
      db.pragma(`user_version = ${v + 1}`);
    });
    apply();
  }
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
