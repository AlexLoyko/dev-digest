import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import * as t from '../src/db/schema.js';
import type { PrIntent, Review } from '@devdigest/shared';

/**
 * L03 intent layer — Docker-backed (Testcontainers Postgres). NOT run by the
 * implementer/test-writer agent; scheduled by a human with Docker available.
 * Self-skips cleanly when no Docker daemon is reachable (`dockerAvailable()`).
 *
 * Covers what the hermetic suite (`test/intent-*.test.ts`) structurally
 * cannot: real jsonb/timestamp round-tripping through the `pr_intent` table,
 * `onConflictDoUpdate` actually replacing the one row per PR, and the
 * `review_intent` feature-model registry default (`openrouter`) resolving for
 * real via `resolveFeatureModel`'s raw `container.db` query.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded secret introduced.',
  score: 80,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live key is committed in source.',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

/** IntentDraft — the classifier's model-local output schema (constants.ts). */
const INTENT_DRAFT = {
  sources_used: ['pr_title', 'pr_body'],
  embedded_instructions_detected: false,
  type: 'feature',
  intent: 'Add rate limiting to public API endpoints.',
  in_scope: ['middleware on /api/public/*'],
  out_of_scope: ['authentication changes'],
};

/** `review_intent`'s registry default provider is `openrouter` (contracts/platform.ts),
 *  independent of whichever provider the review agent itself uses — override BOTH
 *  with the same MockLLMProvider instance so `.calls` captures every completeStructured
 *  call regardless of which provider resolves it. */
function llmOverrides(llm: MockLLMProvider) {
  return { openai: llm, openrouter: llm };
}

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  headSha = 'a1b2c3d4',
) {
  const name = `intent-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rate-limit',
      base: 'main',
      headSha,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('L03 intent layer (Testcontainers pg)', () => {
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

  it('the seven new pr_intent columns round-trip through upsertIntent/getIntentRecord', async () => {
    const repo = new ReviewRepository(pg.handle.db);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const intent: PrIntent = {
      intent: 'Add rate limiting to public endpoints.',
      in_scope: ['middleware on /api/public/*'],
      out_of_scope: ['authentication changes'],
      type: 'feature',
      confidence: 'high',
      sources: [{ kind: 'doc', ref: 'docs/plan.md', resolved: true }],
    };
    await repo.upsertIntent(pr.id, intent, {
      headSha: 'sha-1',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });

    const record = await repo.getIntentRecord(pr.id);
    expect(record).toBeDefined();
    // All seven new columns (type, confidence, sources, head_sha, provider,
    // model, classified_at) round-trip, plus the pre-existing intent/in_scope/
    // out_of_scope columns.
    expect(record!.pr_id).toBe(pr.id);
    expect(record!.head_sha).toBe('sha-1');
    expect(record!.provider).toBe('openrouter');
    expect(record!.model).toBe('deepseek/deepseek-v4-flash');
    expect(record!.classified_at).not.toBeNull();
    expect(record!.type).toBe('feature');
    expect(record!.confidence).toBe('high');
    expect(record!.sources).toEqual(intent.sources);
    expect(record!.in_scope).toEqual(intent.in_scope);
    expect(record!.out_of_scope).toEqual(intent.out_of_scope);
    expect(record!.intent).toBe(intent.intent);
  });

  it('onConflictDoUpdate REPLACES the single row when head_sha moves (one row per PR, not a history)', async () => {
    const repo = new ReviewRepository(pg.handle.db);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const v1: PrIntent = { intent: 'v1', in_scope: [], out_of_scope: [], type: 'chore', confidence: 'low', sources: [] };
    await repo.upsertIntent(pr.id, v1, { headSha: 'sha-1', provider: 'openai', model: 'gpt-4.1' });

    const v2: PrIntent = {
      intent: 'v2',
      in_scope: ['a'],
      out_of_scope: [],
      type: 'feature',
      confidence: 'high',
      sources: [{ kind: 'doc', ref: 'x.md', resolved: true }],
    };
    await repo.upsertIntent(pr.id, v2, { headSha: 'sha-2', provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' });

    const rows = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.headSha).toBe('sha-2');
    expect(rows[0]!.intent).toBe('v2');

    const record = await repo.getIntentRecord(pr.id);
    expect(record!.head_sha).toBe('sha-2');
    expect(record!.confidence).toBe('high');
  });

  it('a legacy row with head_sha = NULL misses the cache and reclassifies exactly once', async () => {
    const repo = new ReviewRepository(pg.handle.db);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 'sha-current');
    // Simulate a pre-L03 row (head_sha was added nullable so old rows don't
    // look like a valid cache for the wrong SHA).
    const legacy: PrIntent = { intent: 'legacy', in_scope: [], out_of_scope: [], type: 'chore', confidence: 'low', sources: [] };
    await repo.upsertIntent(pr.id, legacy, { headSha: null, provider: null, model: null });

    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { Review: REVIEW_FIXTURE, IntentDraft: INTENT_DRAFT },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: DIFF }), llm: llmOverrides(llm) },
    });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Legacy Test Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const record = await repo.getIntentRecord(pr.id);
    expect(record!.head_sha).toBe('sha-current');
    expect(record!.intent).not.toBe('legacy');

    const draftCalls = llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName?: string }).schemaName === 'IntentDraft',
    );
    expect(draftCalls).toHaveLength(1);

    await app.close();
  });

  it('two review runs at the SAME head_sha make exactly ONE IntentDraft call; GET /pulls/:id/intent 404→200', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 'sha-fixed');
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { Review: REVIEW_FIXTURE, IntentDraft: INTENT_DRAFT },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { embedder: new MockEmbedder(), git: new MockGitClient({ diff: DIFF }), llm: llmOverrides(llm) },
    });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Cache Test Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    // Before any review: 404.
    const before = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(before.statusCode).toBe(404);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // After the first review: 200, with the classified fields.
    const after = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(after.statusCode).toBe(200);
    expect(after.json().type).toBe('feature');
    expect(after.json().confidence).toBeDefined();

    // A second review at the SAME head_sha must hit the cache, not reclassify.
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const draftCalls = llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName?: string }).schemaName === 'IntentDraft',
    );
    expect(draftCalls).toHaveLength(1);

    await app.close();
  });

  it('GET /pulls/:id/intent is 404 for a PR that belongs to another workspace', async () => {
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: `other-ws-${repoSeq}` }).returning();
    const repo = new ReviewRepository(pg.handle.db);
    const { pr: otherPr } = await setupRepoAndPr(pg.handle.db, otherWs!.id, 'sha-other');
    await repo.upsertIntent(
      otherPr.id,
      { intent: 'x', in_scope: [], out_of_scope: [], type: 'chore', confidence: 'low', sources: [] },
      { headSha: 'sha-other', provider: 'openai', model: 'gpt-4.1' },
    );

    // The app's LocalNoAuthProvider always scopes to the SEEDED default
    // workspace — `otherPr` lives in a different workspace, so this must 404
    // even though the row exists.
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${otherPr.id}/intent` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
