import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { closeDb } from "../../src/db.js";

let base: string;
let dir: string;

dir = mkdtempSync(join(tmpdir(), "notes-server-"));
process.env.BARRY_NOTES_DB = join(dir, "notes.db");

/**
 * Pin the secret rather than inheriting the ambient one. A developer with
 * BARRY_SECRET exported would otherwise get 401s from every test, and a CI box
 * without it would silently exercise the no-auth path instead — the tests
 * would pass in both places while testing two different services.
 */
const SECRET = "test-secret-for-notes";
process.env.BARRY_SECRET = SECRET;

const { server } = await import("./index.js");

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.BARRY_NOTES_DB;
});

beforeEach(() => {
  closeDb();
  dir = mkdtempSync(join(tmpdir(), "notes-server-"));
  process.env.BARRY_NOTES_DB = join(dir, "notes.db");
});

afterEach(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * `body` is `any` on purpose: these tests assert on real service responses,
 * and threading a response type through every call would restate the server's
 * shapes in the tests that exist to check them.
 */
async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SECRET}`,
      ...init?.headers,
    },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("health and auth", () => {
  it("answers /health without a secret", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "notes" });
  });

  it("rejects an API call with no secret", async () => {
    expect((await fetch(`${base}/api/notes`)).status).toBe(401);
  });

  it("accepts the x-barry-secret spelling too", async () => {
    const res = await fetch(`${base}/api/notes`, { headers: { "x-barry-secret": SECRET } });
    expect(res.status).toBe(200);
  });
});

describe("notes api", () => {
  it("creates, reads, edits and deletes a note", async () => {
    const created = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Ideas", content: "first" }),
    });
    expect(created.status).toBe(201);
    const id = created.body.note.id;

    expect((await api(`/api/notes/${id}`)).body.note.content).toBe("first");

    const edited = await api(`/api/notes/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "second" }),
    });
    expect(edited.body.note.content).toBe("second");
    // Title untouched by a content-only edit.
    expect(edited.body.note.title).toBe("Ideas");

    expect((await api(`/api/notes/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/notes/${id}`)).status).toBe(404);
  });

  it("creates an empty note when given no fields", async () => {
    const created = await api("/api/notes", { method: "POST", body: "{}" });
    expect(created.status).toBe(201);
    expect(created.body.note.title).toBe("");
    expect(created.body.note.content).toBe("");
  });

  it("returns an index with previews and no bodies", async () => {
    await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ content: "the first line\nmore" }),
    });
    const { body } = await api("/api/notes");
    expect(body.notes[0].preview).toBe("the first line");
    expect(body.notes[0].content).toBeUndefined();
  });

  it("404s a missing note", async () => {
    expect((await api("/api/notes/nope")).status).toBe(404);
    expect(
      (await api("/api/notes/nope", { method: "PATCH", body: JSON.stringify({ title: "x" }) }))
        .status,
    ).toBe(404);
    expect((await api("/api/notes/nope", { method: "DELETE" })).status).toBe(404);
  });

  it("reports a bad payload as 400, not 500", async () => {
    expect(
      (await api("/api/notes", { method: "POST", body: JSON.stringify({ title: 42 }) })).status,
    ).toBe(400);
    expect((await api("/api/notes", { method: "POST", body: "{not json" })).status).toBe(400);
  });

  it("rejects an unknown method with 405", async () => {
    expect((await api("/api/notes", { method: "DELETE" })).status).toBe(405);
  });
});

describe("static assets", () => {
  it("serves the page and refuses a traversal", async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");

    const escaped = await fetch(`${base}/../package.json`, { redirect: "manual" });
    expect(escaped.status).toBe(404);
  });
});
