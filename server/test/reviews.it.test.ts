import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
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

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');

    await app.close();
  });

  it('run cost: persisted from the outcome and served on the run list, trace, and PR list', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Cost', provider: 'openai', model: 'gpt-4.1', system_prompt: 'cost' },
      })
    ).json();

    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // MockLLMProvider reports costUsd 0.001 per structured call; the engine sums
    // across chunks, so the exact total depends on the strategy — assert it is a
    // real positive number that survived the whole pipeline rather than a literal.
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.costUsd).toBeGreaterThan(0);
    const persisted = run!.costUsd!;

    // (a) run list
    const runs = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(runs.find((r: { run_id: string }) => r.run_id === runId).cost_usd).toBeCloseTo(persisted, 10);

    // (b) trace stats
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.stats.cost_usd).toBeCloseTo(persisted, 10);

    // (c) PR list — the PR's total (one run here, so it equals that run)
    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(pulls.find((p: { id: string }) => p.id === pr.id).total_cost_usd).toBeCloseTo(persisted, 10);

    await app.close();
  });

  it('run cost: a PR with no completed run reports null, not zero', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // A failed run must not become the list's cost — "—" ≠ "$0.00".
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      prId: pr.id,
      ranAt: new Date(),
      provider: 'openai',
      model: 'gpt-4.1',
      durationMs: 10,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: null,
      status: 'failed',
      error: '429 quota exceeded',
    });

    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    expect(pulls.find((p: { id: string }) => p.id === pr.id).total_cost_usd).toBeNull();

    await app.close();
  });

  it('run cost: a PR reviewed by several agents reports their SUMMED cost', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // A fan-out: one "Run review" click → one agent_runs row per agent. Costs are
    // deliberately distinct so a regression that reports a single run is caught
    // whichever row it happens to pick.
    const costs = [0.0031, 0.0033, 0.0242];
    await pg.handle.db.insert(t.agentRuns).values([
      ...costs.map((costUsd, i) => ({
        workspaceId,
        prId: pr.id,
        ranAt: new Date(Date.now() + i), // ms apart, as separate INSERTs produce
        provider: 'openai',
        model: 'gpt-4.1',
        durationMs: 1000,
        tokensIn: 100,
        tokensOut: 50,
        costUsd,
        status: 'done' as const,
        findingsCount: 0,
        grounding: '0/0 passed',
      })),
      // A failed run in the same batch contributes nothing (null, not zero).
      {
        workspaceId,
        prId: pr.id,
        ranAt: new Date(),
        provider: 'openai',
        model: 'gpt-4.1',
        durationMs: 10,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: null,
        status: 'failed' as const,
        error: '429 quota exceeded',
      },
    ]);

    const pulls = (await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` })).json();
    const total = pulls.find((p: { id: string }) => p.id === pr.id).total_cost_usd;

    expect(total).toBeCloseTo(0.0306, 10);
    // The bug this guards: the column used to report one run's cost. Assert the
    // total is not equal to ANY single run — "a positive number" would have passed.
    for (const c of costs) expect(total).not.toBeCloseTo(c, 10);

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  // ---- Smart Diff (L03) --------------------------------------------------
  // The grouping/ordering logic is covered exhaustively and hermetically in
  // `smart-diff.test.ts`; these two cases prove the ROUTE reads real rows —
  // workspace scoping, and the findings join that `smart-diff.test.ts` can only
  // assert against hand-built inputs.

  it('smart diff 404s for a PR that does not exist', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const res = await app.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-4000-8000-000000000000/smart-diff',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('smart diff groups files before any review, then fills finding_lines from persisted findings', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Before: the grouping already works — this is the property that makes
    // Smart Diff useful on import, with no model in the loop.
    const before = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` })
    ).json();
    expect(before.groups).toHaveLength(1);
    expect(before.groups[0].role).toBe('wiring'); // src/config.ts
    expect(before.groups[0].files[0].finding_lines).toEqual([]);
    expect(before.split_suggestion.too_big).toBe(false);

    // After: findings written straight to the DB rather than produced by a run.
    // The route reads them through `reviewsForPull`, so this covers the join
    // either way — and it does NOT add a second review run to this file, whose
    // parallel Postgres containers already sit near the polling budget
    // (INSIGHTS.md, 2026-08-12 "a new *.it.test.ts file can flake an unrelated
    // one, by contention").
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr.id, kind: 'review', verdict: 'comment', score: 50 })
      .returning();
    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        rationale: 'r',
        confidence: 0.95,
      },
      // A second, overlapping finding — the union must dedupe line 12.
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 13,
        severity: 'WARNING',
        category: 'bug',
        title: 'Adjacent issue',
        rationale: 'r',
        confidence: 0.5,
      },
      // A finding on a file the PR does not touch — must not appear anywhere.
      {
        reviewId: review!.id,
        file: 'src/not-in-this-pr.ts',
        startLine: 3,
        endLine: 3,
        severity: 'WARNING',
        category: 'bug',
        title: 'Elsewhere',
        rationale: 'r',
        confidence: 0.5,
      },
    ]);

    const after = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` })
    ).json();
    expect(after.groups).toHaveLength(1);
    expect(after.groups[0].files).toHaveLength(1);
    expect(after.groups[0].files[0].path).toBe('src/config.ts');
    expect(after.groups[0].files[0].finding_lines).toEqual([11, 12, 13]);
    await app.close();
  });
});
