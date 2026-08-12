import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';

/**
 * `GET /pulls/:id/smart-diff` (L03) — the assertion that doesn't need Postgres:
 * schema-first validation rejects a non-uuid `:id` with 422 BEFORE the handler
 * runs, so no DB query is ever attempted (mirrors `intent-routes.test.ts`).
 *
 * The grouping itself is covered exhaustively in `smart-diff.test.ts` against
 * the pure function; the DB-backed 404 (unknown / other-workspace PR) is in
 * `reviews.it.test.ts`.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('GET /pulls/:id/smart-diff (no DB)', () => {
  it('422 for a non-uuid :id — rejected by schema before the handler runs', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });
});
