import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * `GET|POST /pulls/:id/intent` (L03) — the ONE assertion that doesn't need
 * Postgres: schema-first validation rejects a non-uuid `:id` with 422 BEFORE
 * the handler runs, so no DB query (and for POST, no diff load or LLM call)
 * is ever attempted (mirrors `routes-smoke.test.ts`).
 *
 * The DB-backed assertions — 404 before classification, the record after,
 * a forced recompute overwriting a cache hit, and 404 for a PR in another
 * workspace — are covered in `test/intent.it.test.ts` (Docker-backed; not
 * run here).
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('GET /pulls/:id/intent (no DB)', () => {
  it('422 for a non-uuid :id — rejected by schema before the handler runs', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/intent' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});

describe('POST /pulls/:id/intent (no DB)', () => {
  it('422 for a non-uuid :id — rejected by schema before the handler runs (no diff load, no LLM call)', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'POST', url: '/pulls/not-a-uuid/intent' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});
