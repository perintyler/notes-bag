import { defineTool } from "@barry-rocks/sdk/bags";
import { z } from "zod";
import { api } from "./client.js";
import type { Note, NoteSummary } from "./store.js";

/**
 * Tools go through the same HTTP service the web page and the iOS app use —
 * one write path, so the three surfaces cannot disagree about what a save
 * means. The store layer stays importable for tests and the server.
 *
 * These read the LOCAL notes store on this Mac, not the Cloudflare scratchpad
 * worker in src/worker/. The two do not share data; see README.md.
 */

function noteLine(n: NoteSummary | Note): string {
  const label = n.title || ("preview" in n ? n.preview : "") || "Untitled";
  return `${n.id}  ${n.updated_at.slice(0, 16).replace("T", " ")}  ${label}`;
}

export const notesList = defineTool({
  namespace: "notes",
  access: "read",
  name: "notes",
  description:
    "Every note, most recently edited first. Bodies are omitted — each row " +
    "carries a one-line preview; use get_note for the full text.",
  schema: {},
  handler: async () => {
    const { notes } = await api<{ notes: NoteSummary[] }>("/api/notes");
    return notes;
  },
  cliFormat: (result) => {
    const rows = result as NoteSummary[];
    return rows.length ? rows.map(noteLine).join("\n") : "No notes yet.";
  },
});

export const notesGet = defineTool({
  namespace: "notes",
  access: "read",
  name: "get_note",
  description: "One note, with its full body.",
  schema: {
    id: z.string().min(1).describe("The note's id, from `notes` or `create_note`"),
  },
  handler: async ({ id }) => {
    const { note } = await api<{ note: Note }>(`/api/notes/${encodeURIComponent(id)}`);
    return note;
  },
  cliFormat: (result) => {
    const note = result as Note;
    return `${note.title || "Untitled"}\n\n${note.content}`;
  },
});

export const notesCreate = defineTool({
  namespace: "notes",
  access: "write",
  name: "create_note",
  description:
    "Create a note. Both fields are optional — an empty note is a valid " +
    "starting point, the same as tapping New in the app.",
  schema: {
    title: z.string().optional().describe("Short title. Omit for an untitled note."),
    content: z.string().optional().describe("The body, as plain text or markdown."),
  },
  handler: async ({ title, content }) => {
    const { note } = await api<{ note: Note }>("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title, content }),
    });
    return note;
  },
  cliFormat: (result) => noteLine(result as Note),
});

export const notesUpdate = defineTool({
  namespace: "notes",
  access: "write",
  name: "update_note",
  description:
    "Change a note's title, body, or both. An OMITTED field is left alone; " +
    "passing an empty string clears it. Replaces the whole body — read it " +
    "first with get_note if you mean to append.",
  schema: {
    id: z.string().min(1).describe("The note's id"),
    title: z.string().optional().describe("New title. Omit to leave unchanged."),
    content: z.string().optional().describe("New body. Omit to leave unchanged."),
  },
  handler: async ({ id, title, content }) => {
    const body: Record<string, string> = {};
    // Send only what was supplied: the service treats an absent field as
    // "leave alone", so forwarding undefined as null would clear it.
    if (title !== undefined) body.title = title;
    if (content !== undefined) body.content = content;

    const { note } = await api<{ note: Note }>(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return note;
  },
  cliFormat: (result) => noteLine(result as Note),
});

export const notesDelete = defineTool({
  namespace: "notes",
  access: "write",
  name: "delete_note",
  description: "Delete a note. This cannot be undone — there is no archive.",
  schema: {
    id: z.string().min(1).describe("The note's id"),
  },
  handler: async ({ id }) => {
    await api<{ ok: true }>(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
    return { deleted: id };
  },
  cliFormat: (result) => `Deleted ${(result as { deleted: string }).deleted}`,
});
