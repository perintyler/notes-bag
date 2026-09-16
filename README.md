# notes

A persistent scratchpad: one Cloudflare Worker, one Durable Object per
namespace, and a browser component that autosaves into it.

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
