/**
 * The notes service.
 *
 * Plain node:http with no framework and no build step — the plans/lists shape.
 * Every surface that reads or writes a note goes through here: the web page,
 * the iOS app, and the MCP tools. One write path, so they cannot disagree
 * about what a save means.
 *
 * This is SEPARATE from the Cloudflare worker in src/worker/. That worker is a
 * single scratchpad per namespace with no auth and no public hostname; this is
 * a multi-note store on the Mac. They do not share data and nothing syncs
 * between them — see README.md, which says so plainly rather than letting a
 * reader assume otherwise.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  updateNote,
} from "../../src/store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "..", "web");

const PORT = Number(process.env.PORT || 3870);
const SECRET = process.env.BARRY_SECRET ?? "";

/**
 * Files servable from web/, by explicit allowlist rather than a path join —
 * `join(WEB, url.pathname)` is a directory traversal, and "binds loopback
 * today" is not a security boundary.
 */
const STATIC_ASSETS: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};

function json(res: ServerResponse, body: unknown, status = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function authorized(req: IncomingMessage): boolean {
  if (!SECRET) return true;
  const header = req.headers.authorization;
  const alt = req.headers["x-barry-secret"];
  return header === `Bearer ${SECRET}` || alt === SECRET;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // A note is prose, not a file upload. Cap it rather than letting one
    // request exhaust memory.
    if (size > 4_000_000) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  try {
    // Unauthenticated on purpose: a probe that needs a secret cannot tell
    // "server down" from "wrong secret".
    if (path === "/health") {
      return json(res, { ok: true, service: "notes" });
    }

    const asset = STATIC_ASSETS[path];
    if (asset && method === "GET") {
      const body = readFileSync(join(WEB, asset.file));
      res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store" });
      return res.end(body);
    }

    if (path.startsWith("/api/")) {
      if (!authorized(req)) return json(res, { error: "unauthorized" }, 401);

      if (path === "/api/notes") {
        if (method === "GET") return json(res, { notes: listNotes() });
        if (method === "POST") {
          const body = (await readBody(req)) as { title?: unknown; content?: unknown };
          const note = createNote(
            optionalString(body.title, "title") ?? "",
            optionalString(body.content, "content") ?? "",
          );
          return json(res, { note }, 201);
        }
        return json(res, { error: "method not allowed" }, 405);
      }

      const noteMatch = /^\/api\/notes\/([^/]+)$/.exec(path);
      if (noteMatch) {
        const id = decodeURIComponent(noteMatch[1]!);
        if (method === "GET") {
          const note = getNote(id);
          return note ? json(res, { note }) : json(res, { error: "not found" }, 404);
        }
        if (method === "PATCH" || method === "PUT") {
          const body = (await readBody(req)) as { title?: unknown; content?: unknown };
          const note = updateNote(id, {
            title: optionalString(body.title, "title"),
            content: optionalString(body.content, "content"),
          });
          return note ? json(res, { note }) : json(res, { error: "not found" }, 404);
        }
        if (method === "DELETE") {
          return deleteNote(id)
            ? json(res, { ok: true })
            : json(res, { error: "not found" }, 404);
        }
        return json(res, { error: "method not allowed" }, 405);
      }
    }

    return json(res, { error: "not found" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A bad payload is the caller's fault (400); anything else is ours (500).
    const clientFault =
      message.includes("must be a") ||
      message.includes("body too large") ||
      err instanceof SyntaxError;
    return json(res, { error: message }, clientFault ? 400 : 500);
  }
});

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`notes service on 127.0.0.1:${PORT}`);
  });
}
