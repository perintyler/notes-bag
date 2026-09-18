# notes

Two stores under one name. **They do not sync.**

| | What | Where |
|---|---|---|
| **Local notes** | Many notes, each with a title and body. What the MCP tools, the web app and the iOS app read and write. | SQLite on this Mac, `~/.barry/notes.db`, served by `server/` on :3870 |
| **Scratchpad worker** | ONE note per namespace, no auth, no public hostname. | A Cloudflare Durable Object, `src/worker/` |

Nothing reconciles them: a note written on the phone does not appear in the
worker's scratchpad and vice versa. That is stated up front because the shared
name invites the assumption that they are one store. Syncing them is separate
work nobody has done.

## The local store

```sh
pnpm install
pnpm start          # http://127.0.0.1:3870
pnpm test           # store, service, and the worker's own tests
pnpm typecheck      # two programs: the worker's and the service's
```

`BARRY_NOTES_DB` overrides the database path. The service reads `BARRY_SECRET`:
with one bound it requires `Authorization: Bearer <secret>` (or
`x-barry-secret`) on every `/api/` route; `/health` never takes auth, so a probe
can tell "server down" from "wrong secret".

`tsconfig.json` and `tsconfig.server.json` exist because the worker and the
service need different global type sets — `types` is all-or-nothing per
program, and the worker pins `@cloudflare/workers-types`, which replaces Node's
globals.

### API

`GET /health` · `GET /api/notes` (index: previews, no bodies) ·
`POST /api/notes` · `GET|PATCH|DELETE /api/notes/:id`

On `PATCH`, an **omitted** field is left alone and an **empty string** clears
it. Collapsing those two would make it impossible to edit a title without
resending the whole body, and every autosave would race the other field.

### The iOS app

```sh
cd notes-ios && ./scripts/test.sh
barry ios build notes --simulator "iPhone 16 Pro"
barry ios build notes --device
```

Simulator talks to `127.0.0.1:3870` with no secret. A device goes over
Tailscale to Caddy, which selects the `notes.barry.lan` vhost from the `Host`
header — a raw service port is not reachable from a phone. There is
deliberately **no** `notes.barry.rocks`: notes are the most personal thing here
and the tailnet is the boundary.

## The scratchpad worker

```js
import { NotesApp } from "@barry-bags/notes";

new NotesApp(document.getElementById("root"), {
  // A path on your own origin, not the worker's address. The worker has no
  // auth of its own, so the page in front of it should proxy — see below.
  workerUrl: "/api/notes",
  namespace: "my-scratchpad",
});
```

The component debounces edits by 800ms, saves on blur, and shows its state in
the header. Each namespace is a separate Durable Object with its own SQLite
database and exactly one note in it.

## Worth knowing before changing anything here

**The worker authenticates nothing — it relies on having no public
hostname.** The `X-Notes-Namespace` header is the only thing separating one
scratchpad from another, and the caller supplies it. Anyone who can reach the
worker and guesses a namespace can read and overwrite it; `PUT` is as open as
`GET`, and CORS reflects the caller's origin (`Origin || '*'`), so any web page
could drive it from a browser.

That is survivable only because `wrangler.jsonc` sets `workers_dev: false`, so
there is no public URL. It answered on `workers.dev` until that landed, which
made an unwritten scratchpad readable and writable by anyone who found the
hostname.

Nothing consumes this worker yet. When something does, reach it through a
service binding from an authenticated worker rather than turning `workers_dev`
back on — barry.rocks does this for the sibling `links` bag, proxying through
its own session-checked route so the browser never learns a worker address.

**Renaming the worker orphans the data.** Durable Object storage is keyed to
the worker and class name, so changing `barry-notes` or `NotesObject` does not
migrate the scratchpads — it silently starts empty ones beside them. The
manifest's `worker:` field is cross-checked against `wrangler.jsonc` at deploy
time to make a mismatch fail loudly rather than quietly.

**The `url` in `bag.yaml` is a placeholder.** This worker declares no routes and
no custom domain, so its real address is an account-specific `workers.dev`
subdomain assigned at deploy time. Replace the placeholder with what
`wrangler deploy` prints.

**The tests cover the fixes below, and each was verified by breaking it.** Run
them with `pnpm test`. They stub `cloudflare:workers` and fake SqlStorage, so
they cover routing, validation and response shapes but never real SQL or DO
persistence. The browser component is untested.

Fixed here, after the move:

- `PUT` requires `content` to be a string. It used to be destructured and bound
  straight into the statement, so `PUT {}` put `undefined` into a `NOT NULL`
  column and `PUT {"content":123}` stored a number. An empty string is still
  accepted — that is a cleared scratchpad, not a missing field.
- A malformed JSON body is a 400, not an unhandled throw.
- `Note.updated_at` is typed `string | null`, which is what the read path
  actually returns. It claimed `string`, denying the one case a consumer hits
  first: a scratchpad nobody has written yet.

Still true, and worth knowing:

- `/health` returns before the CORS block, so a cross-origin health check fails
  in a browser. Harmless while nothing calls it cross-origin.
- The `beforeunload` save uses synchronous XHR, which modern Chrome blocks. The
  debounced save and the blur save both work; this is the last-resort path.
- `_save()` drops a concurrent save (`if (this._saving) return`) without
  rescheduling, so a keystroke landing during an in-flight PUT can be lost.
  Fixing it properly means a dirty flag and a re-run after the in-flight save
  resolves, which is a behavior change to the component rather than the worker.

## Layout

| Path | What |
|---|---|
| `src/NotesApp.js` | The browser component — DOM, debounce, autosave |
| `src/worker/index.ts` | Worker entry: `/health`, CORS, namespace → DO routing |
| `src/worker/notes-object.ts` | The Durable Object and its SQLite schema |
| `scripts/build.js` | Bundles `dist/` — CSS, IIFE, and an inline-able string |
| `wrangler.jsonc` | Worker name, DO binding, migration |

## Deploying

```sh
pnpm build && pnpm deploy
```
