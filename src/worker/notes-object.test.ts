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
   * The Note type now says `updated_at: string | null`, which is what this
   * path actually returns. It used to claim `string`, denying the one case a
   * consumer hits first — an unwritten scratchpad.
   */
  it('returns a null updated_at, which the Note type now admits', async () => {
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
   * `content` used to be destructured and bound straight into the statement,
   * so PUT {} put undefined into a NOT NULL column and PUT {"content":123}
   * stored a number. The column's type is the contract.
   */
  it('400s a missing content rather than binding undefined', async () => {
    const { obj, calls } = makeObject();
    const res = await obj.fetch(req('/note', { method: 'PUT', body: '{}' }));
    expect(res.status).toBe(400);
    expect(calls.some((c) => c.query.includes('INSERT'))).toBe(false);
  });

  it('400s a non-string content', async () => {
    for (const content of [123, true, null, { a: 1 }, ['x']]) {
      const { obj, calls } = makeObject();
      const res = await obj.fetch(
        req('/note', { method: 'PUT', body: JSON.stringify({ content }) }),
      );
      expect(res.status, JSON.stringify(content)).toBe(400);
      expect(calls.some((c) => c.query.includes('INSERT'))).toBe(false);
    }
  });

  it('accepts an empty string, which is a legitimate cleared scratchpad', async () => {
    const { obj, calls } = makeObject();
    const res = await obj.fetch(req('/note', { method: 'PUT', body: JSON.stringify({ content: '' }) }));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.query.includes('INSERT'))).toBe(true);
  });

  it('400s a malformed JSON body instead of throwing', async () => {
    const { obj } = makeObject();
    const res = await obj.fetch(req('/note', { method: 'PUT', body: '{not json' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Invalid JSON body' });
  });
});
