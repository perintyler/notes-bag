/**
 * The notes web page.
 *
 * Same-origin calls to /api/* — no worker URL, no secret in the page.
 *
 * Autosave is debounced. The save path deliberately does NOT drop a write that
 * lands while another is in flight: src/NotesApp.js (the Cloudflare component)
 * opens with `if (this._saving) return;` and never reschedules, so a keystroke
 * typed during a PUT is lost silently. Here an in-flight save sets a dirty
 * flag and re-runs when it completes.
 *
 * User text is written with textContent, never innerHTML.
 */

const notesEl = document.getElementById("notes");
const notesEmptyEl = document.getElementById("notes-empty");
const editorEl = document.getElementById("editor");
const statusEl = document.getElementById("status");

let notes = [];
let selectedId = null;

// Autosave state for the open note.
let saveTimer = null;
let saving = false;
let dirty = false;
const SAVE_DEBOUNCE_MS = 700;

function setStatus(message, tone) {
  statusEl.textContent = message;
  if (tone) statusEl.dataset.tone = tone;
  else delete statusEl.dataset.tone;
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options && options.headers) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.error) || `request failed (${res.status})`);
  return body;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function label(note) {
  return note.title || note.preview || "Untitled";
}

function renderNotes() {
  notesEl.replaceChildren();
  notesEmptyEl.hidden = notes.length > 0;

  for (const note of notes) {
    const button = el("button", null);
    button.type = "button";
    button.setAttribute("aria-current", String(note.id === selectedId));
    button.append(el("span", null, label(note)));
    if (note.title && note.preview) button.append(el("span", "preview", note.preview));
    button.addEventListener("click", () => openNote(note.id));

    const li = document.createElement("li");
    li.append(button);
    notesEl.append(li);
  }
}

function renderEditor(note) {
  editorEl.replaceChildren();

  if (!note) {
    editorEl.append(el("p", "empty", "Select a note, or make a new one."));
    return;
  }

  const head = el("div", "editor-head");
  const del = el("button", "link-danger", "Delete");
  del.type = "button";
  del.addEventListener("click", () => removeNote(note.id));
  head.append(del);

  const title = document.createElement("input");
  title.type = "text";
  title.className = "note-title";
  title.placeholder = "Title";
  title.value = note.title;
  title.setAttribute("aria-label", "Note title");

  const body = document.createElement("textarea");
  body.className = "note-body";
  body.placeholder = "Write…";
  body.value = note.content;
  body.setAttribute("aria-label", "Note body");

  for (const field of [title, body]) {
    field.addEventListener("input", () => scheduleSave(note.id, title, body));
    // Flush on blur so leaving the field commits without waiting out the timer.
    field.addEventListener("blur", () => flushSave(note.id, title, body));
  }

  editorEl.append(head, title, body);
  body.focus();
}

function scheduleSave(id, title, body) {
  setStatus("Unsaved…");
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(id, title, body), SAVE_DEBOUNCE_MS);
}

function flushSave(id, title, body) {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  save(id, title, body);
}

/**
 * Save, coalescing writes rather than dropping them.
 *
 * A keystroke landing mid-flight sets `dirty`; when the in-flight request
 * finishes, the save re-runs with the CURRENT field values. Returning early
 * instead — the bug in src/NotesApp.js — silently loses that edit.
 */
async function save(id, title, body) {
  saveTimer = null;
  if (saving) {
    dirty = true;
    return;
  }
  saving = true;
  setStatus("Saving…");
  try {
    await api(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title: title.value, content: body.value }),
    });
    setStatus("Saved");
    setTimeout(() => {
      if (statusEl.textContent === "Saved") setStatus("");
    }, 1500);
    await refreshNotes();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    saving = false;
    if (dirty) {
      dirty = false;
      await save(id, title, body);
    }
  }
}

async function refreshNotes() {
  const { notes: fetched } = await api("/api/notes");
  notes = fetched;
  renderNotes();
}

async function openNote(id) {
  selectedId = id;
  renderNotes();
  try {
    const { note } = await api(`/api/notes/${encodeURIComponent(id)}`);
    renderEditor(note);
    setStatus("");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

async function guard(action) {
  try {
    await action();
  } catch (err) {
    setStatus(err.message, "error");
  }
}

document.getElementById("new-note").addEventListener("click", () => {
  guard(async () => {
    const { note } = await api("/api/notes", { method: "POST", body: "{}" });
    await refreshNotes();
    await openNote(note.id);
  });
});

function removeNote(id) {
  if (!window.confirm("Delete this note?")) return;
  return guard(async () => {
    await api(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
    selectedId = null;
    await refreshNotes();
    renderEditor(null);
  });
}

guard(refreshNotes);
