import { DurableObject } from 'cloudflare:workers';
import { Env } from './types.js';

/**
 * Single-note-per-namespace Durable Object.
 * Each namespace gets one scratchpad that persists in SQLite.
 */
export class NotesObject extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY DEFAULT 'default',
        content TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '/note') {
      if (request.method === 'GET') return this.getNote();
      if (request.method === 'PUT') return this.saveNote(request);
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private getNote(): Response {
    const row = [...this.sql.exec('SELECT id, content, updated_at FROM notes WHERE id = ?', 'default')][0];
    if (!row) {
      return new Response(JSON.stringify({ id: 'default', content: '', updated_at: null }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(row), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async saveNote(request: Request): Promise<Response> {
    let body: { content?: unknown };
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // `content` was destructured and bound straight into the statement, so a
    // PUT with no content bound undefined into a NOT NULL column and a number
    // was stored as a number. The column's type is the contract; enforce it
    // here rather than letting SQLite decide.
    const { content } = body;
    if (typeof content !== 'string') {
      return new Response(
        JSON.stringify({ ok: false, error: 'content must be a string' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO notes (id, content, updated_at) VALUES ('default', ?, ?)
       ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
      content,
      now,
    );
    return new Response(JSON.stringify({ ok: true, updated_at: now }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
