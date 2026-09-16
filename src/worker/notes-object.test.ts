import { describe, it, expect, vi } from 'vitest';

/**
 * `cloudflare:workers` does not resolve outside the workers runtime, so the
 * base class is stubbed and a fake SqlStorage stands in for the Durable
 * Object's SQLite. Routing, validation and response shapes are plain logic;
 * real SQL behavior is not covered here.
 */
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const { NotesObject } = await import('./notes-object.js');

function makeObject(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ query: string; bindings: unknown[] }> = [];
  const sql = {
    exec: vi.fn((query: string, ...bindings: unknown[]) => {
      calls.push({ query, bindings });
      return rows[Symbol.iterator] ? rows : [];
    }),
  };
  const ctx = { storage: { sql } } as unknown as DurableObjectState;
  return { obj: new NotesObject(ctx, {} as never), calls };
}

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://notes.test${path}`, init);
}

describe('routing', () => {
  it('404s an unknown path', async () => {
    const { obj } = makeObject();
    const res = await obj.fetch(req('/nope'));
    expect(res.status).toBe(404);
  });

  it('serves the note on both / and /note', async () => {
    for (const path of ['/', '/note']) {
      const { obj } = makeObject();
      const res = await obj.fetch(req(path));
      expect(res.status, path).toBe(200);
    }
  });

  it('404s a verb the note routes do not handle', async () => {
    const { obj } = makeObject();
    const res = await obj.fetch(req('/note', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(404);
  });
});

describe('reading a note', () => {
  it('returns an empty note rather than 404 when none has been written', async () => {
    const { obj } = makeObject([]);
    const res = await obj.fetch(req('/note'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'default', content: '', updated_at: null });
  });

  /**
   * DEFECT (README: "Note.updated_at is typed string but getNote returns
   * null"). The empty case above is the one the type denies exists, so a
   * consumer written against the type will happily do updated_at.slice() and
   * throw on a scratchpad nobody has written yet.
   */
  it('returns a null updated_at the Note type says is impossible — a known defect', async () => {
    const { obj } = makeObject([]);
    const body = (await (await obj.fetch(req('/note'))).json()) as { updated_at: string | null };
    expect(body.updated_at).toBeNull();
  });

  it('returns the stored row when one exists', async () => {
    const { obj } = makeObject([
      { id: 'default', content: 'hello', updated_at: '2026-01-01T00:00:00.000Z' },
    ]);
    const body = await (await obj.fetch(req('/note'))).json();
    expect(body).toMatchObject({ content: 'hello' });
  });
});

describe('writing a note', () => {
  it('upserts the content and reports the new timestamp', async () => {
    const { obj, calls } = makeObject();
    const res = await obj.fetch(
      req('/note', { method: 'PUT', body: JSON.stringify({ content: 'written' }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; updated_at: string };
    expect(body.ok).toBe(true);
    expect(Date.parse(body.updated_at)).not.toBeNaN();

    const insert = calls.find((c) => c.query.includes('INSERT'));
    expect(insert?.bindings).toContain('written');
  });

  /**
   * DEFECT (README: "saveNote binds content unvalidated"). `content` is read
   * straight off the parsed body with no check, so PUT {} binds undefined into
   * a NOT NULL column and PUT {"content":123} stores a number. Neither is
   * rejected; both reach SQLite and fail (or succeed) there instead of here.
   */
  it('binds a missing content as undefined instead of rejecting — a known defect', async () => {
    const { obj, calls } = makeObject();
    const res = await obj.fetch(req('/note', { method: 'PUT', body: '{}' }));
    expect(res.status).toBe(200);
    const insert = calls.find((c) => c.query.includes('INSERT'));
    expect(insert?.bindings).toContain(undefined);
  });

  it('binds a non-string content unchanged — a known defect', async () => {
    const { obj, calls } = makeObject();
    await obj.fetch(req('/note', { method: 'PUT', body: JSON.stringify({ content: 123 }) }));
    const insert = calls.find((c) => c.query.includes('INSERT'));
    expect(insert?.bindings).toContain(123);
  });

  /**
   * DEFECT (README: "request.json() is unguarded"). A malformed body rejects
   * inside the handler and escapes as a throw rather than a 400.
   */
  it('throws on malformed JSON instead of returning 400 — a known defect', async () => {
    const { obj } = makeObject();
    await expect(
      obj.fetch(req('/note', { method: 'PUT', body: '{not json' })),
    ).rejects.toThrow();
  });
});
