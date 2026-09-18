import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { closeDb, setDb } from "./db.js";
import { createNote, deleteNote, getNote, listNotes, updateNote } from "./store.js";

beforeEach(() => {
  setDb(new Database(":memory:"));
});

afterEach(() => {
  closeDb();
});

describe("notes", () => {
  it("creates an empty note", () => {
    const note = createNote();
    expect(note.id).toBeTruthy();
    expect(note.title).toBe("");
    expect(note.content).toBe("");
  });

  it("creates a note with a title and body", () => {
    const note = createNote("Shopping", "milk\nbread");
    expect(getNote(note.id)?.title).toBe("Shopping");
    expect(getNote(note.id)?.content).toBe("milk\nbread");
  });

  it("returns null for a note that does not exist", () => {
    expect(getNote("nope")).toBeNull();
  });

  it("lists newest first", () => {
    const first = createNote("First");
    const second = createNote("Second");
    // Touching the older note floats it back to the top.
    updateNote(first.id, { content: "changed" });
    expect(listNotes().map((n) => n.id)).toEqual([first.id, second.id]);
  });

  /**
   * The index must not carry note bodies: a list of long notes would ship the
   * entire store on every refresh. It carries a derived preview instead.
   */
  it("omits content from the index and derives a preview", () => {
    createNote("", "  \n\nthe first real line\nsecond line");
    const [row] = listNotes();
    expect(row).not.toHaveProperty("content");
    expect(row!.preview).toBe("the first real line");
  });

  it("clips a very long preview", () => {
    createNote("", "x".repeat(500));
    expect(listNotes()[0]!.preview.length).toBeLessThanOrEqual(120);
  });

  /**
   * An omitted field is left alone; an empty string clears it. Collapsing
   * those two would make it impossible to edit one field without resending
   * the other, and every autosave would race.
   */
  it("distinguishes an omitted field from an empty one", () => {
    const note = createNote("Title", "Body");

    updateNote(note.id, { title: "New title" });
    expect(getNote(note.id)?.content).toBe("Body");

    updateNote(note.id, { content: "" });
    expect(getNote(note.id)?.title).toBe("New title");
    expect(getNote(note.id)?.content).toBe("");
  });

  it("reports a missing note rather than pretending to update it", () => {
    expect(updateNote("nope", { title: "x" })).toBeNull();
    expect(deleteNote("nope")).toBe(false);
  });

  it("deletes a note", () => {
    const note = createNote("Temp");
    expect(deleteNote(note.id)).toBe(true);
    expect(getNote(note.id)).toBeNull();
    expect(deleteNote(note.id)).toBe(false);
  });

  it("advances updated_at on a write", () => {
    const note = createNote("T", "a");
    const updated = updateNote(note.id, { content: "b" })!;
    expect(updated.updated_at >= note.updated_at).toBe(true);
  });
});
