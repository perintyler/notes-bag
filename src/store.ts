import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/** What the index returns: no body, so a long note does not bloat the list. */
export type NoteSummary = Omit<Note, "content"> & { preview: string };

function now(): string {
  return new Date().toISOString();
}

/**
 * The first non-empty line, clipped — what the list shows when a note has no
 * title. Derived rather than stored so it cannot drift from the content.
 */
function preview(content: string): string {
  const line = content.split("\n").find((l) => l.trim().length > 0) ?? "";
  const trimmed = line.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 119)}…` : trimmed;
}

export function listNotes(): NoteSummary[] {
  const rows = getDb()
    .prepare("SELECT id, title, content, created_at, updated_at FROM notes ORDER BY updated_at DESC")
    .all() as Note[];
  return rows.map(({ content, ...rest }) => ({ ...rest, preview: preview(content) }));
}

export function getNote(id: string): Note | null {
  const row = getDb().prepare("SELECT * FROM notes WHERE id = ?").get(id) as Note | undefined;
  return row ?? null;
}

export function createNote(title = "", content = ""): Note {
  const db = getDb();
  const ts = now();
  const note: Note = {
    id: randomUUID(),
    title: title.trim(),
    content,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO notes (id, title, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(note.id, note.title, note.content, note.created_at, note.updated_at);
  return note;
}

/**
 * Update a note's title, content, or both.
 *
 * Both fields are optional and an OMITTED field is left alone — distinct from
 * passing an empty string, which clears it. Collapsing those two would make it
 * impossible to edit a title without resending the whole body, and every
 * autosave would race the other field.
 */
export function updateNote(
  id: string,
  changes: { title?: string; content?: string },
): Note | null {
  const db = getDb();
  const existing = getNote(id);
  if (!existing) return null;

  const title = changes.title === undefined ? existing.title : changes.title.trim();
  const content = changes.content === undefined ? existing.content : changes.content;
  const ts = now();

  db.prepare("UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?").run(
    title,
    content,
    ts,
    id,
  );
  return { ...existing, title, content, updated_at: ts };
}

/** Returns false when the note did not exist, so a caller can 404 honestly. */
export function deleteNote(id: string): boolean {
  return getDb().prepare("DELETE FROM notes WHERE id = ?").run(id).changes > 0;
}
