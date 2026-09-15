# notes

A persistent scratchpad: one Cloudflare Worker, one Durable Object per
namespace, and a browser component that autosaves into it.

```js
import { NotesApp } from "@barry-bags/notes";

new NotesApp(document.getElementById("root"), {
  workerUrl: "https://barry-notes.<account>.workers.dev",
  namespace: "my-scratchpad",
});
```

The component debounces edits by 800ms, saves on blur, and shows its state in
the header. Each namespace is a separate Durable Object with its own SQLite
database and exactly one note in it.

## Worth knowing before changing anything here

**The worker has no authentication.** The `X-Notes-Namespace` header is the
only thing separating one scratchpad from another, and it is supplied by the
caller. Anyone who knows or guesses a namespace string can read and overwrite
it with `curl`; `PUT` is as open as `GET`. CORS reflects the caller's origin
(`Origin || '*'`), so any web page can drive it from a browser too.

That is survivable only because nothing currently points at this worker. Before
putting a real UI or a real domain in front of it, put a gateway in front of it
too — `bags/artifacts` in the barry monorepo does exactly this, which is why it
has a second `deployments:` entry holding a Google-OAuth worker.

**Renaming the worker orphans the data.** Durable Object storage is keyed to
the worker and class name, so changing `barry-notes` or `NotesObject` does not
migrate the scratchpads — it silently starts empty ones beside them. The
manifest's `worker:` field is cross-checked against `wrangler.jsonc` at deploy
time to make a mismatch fail loudly rather than quietly.

**The `url` in `bag.yaml` is a placeholder.** This worker declares no routes and
no custom domain, so its real address is an account-specific `workers.dev`
subdomain assigned at deploy time. Replace the placeholder with what
`wrangler deploy` prints.

**There are no tests.** This moved out of the monorepo without any, and the
known defects below are all untested. A regression test here should be broken
first to confirm it goes red — an assertion that has never failed is a claim,
not evidence.

Known defects, none fixed by the move:

- `saveNote` binds `content` unvalidated: `PUT {}` puts `undefined` into a
  `NOT NULL` column, and `{"content": 123}` is stored as-is.
- `request.json()` is unguarded, so a malformed body is a 500 rather than a 400.
- `_save()` drops concurrent saves (`if (this._saving) return`) without
  rescheduling, so a keystroke during an in-flight PUT can be lost.
- `Note.updated_at` is typed `string`, but `getNote()` returns `null` for a
  scratchpad that has never been written.
- `/health` returns before the CORS block, so a cross-origin health check fails
  in a browser.
- The `beforeunload` save uses synchronous XHR, which modern Chrome blocks.

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
