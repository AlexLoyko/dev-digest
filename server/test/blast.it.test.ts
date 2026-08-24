/**
 * GET /pulls/:id/blast — integration test against a real Postgres (Testcontainers).
 *
 * Seeds a repo with a full persistent index (symbols/references/file_edges/
 * file_rank/file_facts) and asserts the happy-path response: the same-file
 * reference is excluded from callers, the cross-file caller's downstream
 * endpoint is attributed at depth 1, and the prior overlapping PR is
 * surfaced. Gated on Docker exactly like the other `.it.test.ts` files.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { BlastRadiusView } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const CHANGED_FILE = 'src/rate-limit.ts';
const CALLER_FILE = 'src/api/router.ts';

d('GET /pulls/:id/blast (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('returns a full-state blast radius with correct caller exclusion, endpoint depth, and prior PRs', async () => {
    const db = pg.handle.db;

    // ---- repo -------------------------------------------------------------
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'blast-it', fullName: 'acme/blast-it' })
      .returning();
    const repoId = repo!.id;

    // ---- persistent index state (status: full) -----------------------------
    await db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: 'sha-full-1',
      indexerVersion: 2,
      status: 'full',
      filesIndexed: 2,
      filesSkipped: 0,
      stats: {},
    });

    // ---- symbols: the changed symbol + the caller's enclosing symbol -------
    await db.insert(t.symbols).values([
      {
        repoId,
        path: CHANGED_FILE,
        name: 'rateLimit',
        kind: 'function',
        line: 10,
        endLine: 20,
        exported: true,
      },
      {
        repoId,
        path: CALLER_FILE,
        name: 'handleRequest',
        kind: 'function',
        line: 5,
        endLine: 50,
        exported: true,
      },
    ]);

    // ---- references: one same-file (excluded), one cross-file (counted) ----
    await db.insert(t.references).values([
      {
        repoId,
        fromPath: CHANGED_FILE, // same file as declFile — must be excluded
        toSymbol: 'rateLimit',
        line: 15,
        declFile: CHANGED_FILE,
      },
      {
        repoId,
        fromPath: CALLER_FILE,
        toSymbol: 'rateLimit',
        line: 42,
        declFile: CHANGED_FILE,
      },
    ]);

    // ---- import graph: router.ts imports rate-limit.ts (depth-1 importer) --
    await db.insert(t.fileEdges).values({ repoId, fromFile: CALLER_FILE, toFile: CHANGED_FILE });

    // ---- file rank for the caller file (needed by the caller JOIN) ---------
    await db.insert(t.fileRank).values({
      repoId,
      filePath: CALLER_FILE,
      pagerank: 0.5,
      hotness: 0,
      rank: 0.5,
      percentile: 80,
    });

    // ---- facts: router.ts exposes an HTTP endpoint --------------------------
    await db.insert(t.fileFacts).values({
      repoId,
      filePath: CALLER_FILE,
      endpoints: ['GET /api/x'],
      crons: [],
    });

    // ---- the PR under test --------------------------------------------------
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 101,
        title: 'Tune the rate limiter',
        author: 'marisa.koch',
        branch: 'feat/rl-tune',
        base: 'main',
        headSha: 'headsha1',
        additions: 5,
        deletions: 1,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    await db.insert(t.prFiles).values({ prId: pr!.id, path: CHANGED_FILE, additions: 5, deletions: 1 });

    // ---- a PRIOR pull request overlapping the same changed file ------------
    const [priorPr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 88,
        title: 'Adjust rate limit window',
        author: 'someone.else',
        branch: 'feat/rl-window',
        base: 'main',
        headSha: 'priorsha1',
        additions: 3,
        deletions: 2,
        filesCount: 1,
        status: 'merged',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })
      .returning();
    await db.insert(t.prFiles).values({ prId: priorPr!.id, path: CHANGED_FILE, additions: 3, deletions: 2 });

    const app = await buildApp({ config: config(), db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr!.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusView;

    expect(body.state).toBe('full');
    expect(body.reason).toBe('ok');
    expect(body.indexed_sha).toBe('sha-full-1');
    expect(body.head_sha).toBe('headsha1');
    expect(body.repo_full_name).toBe('acme/blast-it');

    expect(body.symbols).toHaveLength(1);
    const sym = body.symbols[0]!;
    expect(sym.name).toBe('rateLimit');
    expect(sym.file).toBe(CHANGED_FILE);

    // Same-file reference excluded — only the cross-file caller counts.
    expect(sym.callers).toHaveLength(1);
    expect(sym.caller_total).toBe(1);
    expect(sym.callers_truncated).toBe(false);
    expect(sym.callers[0]!.file).toBe(CALLER_FILE);
    expect(sym.callers[0]!.symbol).toBe('handleRequest');

    // Endpoint attributed at depth 1 (declared in the direct importer file).
    expect(sym.endpoints).toHaveLength(1);
    expect(sym.endpoints[0]).toMatchObject({ label: 'GET /api/x', file: CALLER_FILE, depth: 1 });
    expect(sym.endpoint_total).toBe(1);
    expect(sym.cron_total).toBe(0);
    expect(sym.facts_truncated).toBe(false);

    // Top-level counts reflect true totals (regression: previously summed the
    // already-capped display arrays instead of the pre-cap totals).
    expect(body.counts.callers).toBe(1);
    expect(body.counts.endpoints).toBe(1);
    expect(body.counts.crons).toBe(0);

    expect(body.prior_prs).toHaveLength(1);
    expect(body.prior_prs[0]).toMatchObject({
      number: 88,
      title: 'Adjust rate limit window',
      files_overlap: [CHANGED_FILE],
    });
  });
});
