import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  LLMProvider,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  ModelInfo,
} from '@devdigest/shared';
import { BriefResponse, StoredBrief } from '@devdigest/shared';
import * as t from '../src/db/schema.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { BriefRepository } from '../src/modules/brief/repository.js';
import { MockLLMProvider, MockGitHubClient } from '../src/adapters/mocks.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief-routes.it] Docker not available — skipping Testcontainers integration test.');
}

type Db = PgFixture['handle']['db'];

/**
 * `LocalNoAuthProvider` (the real `container.auth` behind `getContext`)
 * always resolves the ONE workspace named `DEFAULT_WORKSPACE_NAME` plus the
 * ONE user at `SYSTEM_USER_EMAIL` (`adapters/auth/local.ts`) — it throws if
 * either is missing, regardless of what other workspaces a test creates. So,
 * unlike `brief-generate.it.test.ts`/`brief-repo.it.test.ts` (which call
 * `BriefService`/`BriefRepository` directly and never touch `container.auth`),
 * every test here goes through the real HTTP `getContext` and MUST seed
 * exactly this bootstrap row pair — a lighter stand-in for `db/seed.ts`'s
 * full `seed()` (which additionally clones a fixture repo, unneeded here).
 */
async function seedAuthBootstrap(db: Db): Promise<string> {
  const [ws] = await db
    .insert(t.workspaces)
    .values({ name: 'default' })
    .returning({ id: t.workspaces.id });
  await db.insert(t.users).values({ email: 'you@local', name: 'You' });
  return ws!.id;
}

async function seedRepo(db: Db, workspaceId: string, name = 'brief-routes'): Promise<string> {
  const [row] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning({ id: t.repos.id });
  return row!.id;
}

async function seedPull(
  db: Db,
  workspaceId: string,
  repoId: string,
  overrides: Partial<{ headSha: string; number: number; body: string | null }> = {},
): Promise<string> {
  const [row] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: overrides.number ?? 1,
      title: 'Add retry logic to payment webhook handler',
      author: 'octocat',
      branch: 'feature/retry-webhooks',
      base: 'main',
      headSha: overrides.headSha ?? 'sha-a',
      additions: 42,
      deletions: 5,
      filesCount: 2,
      body: overrides.body ?? null,
    })
    .returning({ id: t.pullRequests.id });
  return row!.id;
}

async function seedAgent(db: Db, workspaceId: string, name = 'Security Reviewer'): Promise<string> {
  const [row] = await db
    .insert(t.agents)
    .values({ workspaceId, name, provider: 'openai', model: 'gpt-4.1', systemPrompt: 'Review the diff.' })
    .returning({ id: t.agents.id });
  return row!.id;
}

/** A `done` agent_run with a valid review verdict — counts as "completed" (AC-12). */
async function seedCompletedRun(
  db: Db,
  workspaceId: string,
  prId: string,
  agentId: string,
  overrides: Partial<{ verdict: string }> = {},
): Promise<string> {
  const [run] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId,
      agentId,
      prId,
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'done',
      durationMs: 1200,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.01,
      findingsCount: 2,
      grounding: 'ok',
      score: 80,
      blockers: 0,
    })
    .returning({ id: t.agentRuns.id });
  const runId = run!.id;

  await db.insert(t.reviews).values({
    workspaceId,
    prId,
    agentId,
    runId,
    kind: 'review',
    verdict: overrides.verdict ?? 'approve',
    summary: 'Looks fine.',
    score: 80,
    model: 'gpt-4.1',
  });

  return runId;
}

/** A `failed` agent_run — never counts as "completed" (EC-5), regardless of verdict. */
async function seedFailedRun(db: Db, workspaceId: string, prId: string, agentId: string): Promise<void> {
  await db.insert(t.agentRuns).values({
    workspaceId,
    agentId,
    prId,
    provider: 'openai',
    model: 'gpt-4.1',
    status: 'failed',
    error: 'upstream timeout',
  });
}

function makeStoredBrief(headSha: string): StoredBrief {
  return {
    schema_version: 1,
    head_sha: headSha,
    generated_at: new Date().toISOString(),
    provider: 'openai',
    model: 'gpt-4.1',
    tokens_in: 500,
    tokens_out: 200,
    cost_usd: 0.02,
    duration_ms: 3400,
    input_tokens_measured: true,
    degraded: [],
    brief: {
      what: 'Adds retry logic to the payment webhook handler.',
      why: 'Webhook deliveries were silently dropped on transient 5xx errors.',
      risk_level: 'medium',
      risks: [
        {
          kind: 'reliability',
          title: 'Retry loop lacks backoff',
          explanation: 'Retries fire immediately, which could amplify an outage.',
          severity: 'medium',
          file_refs: [{ path: 'src/webhooks/handler.ts', start_line: 10, end_line: 24 }],
        },
      ],
      review_focus: [{ file: { path: 'src/webhooks/handler.ts' }, reason: 'Core retry logic change.' }],
    },
  };
}

const PR_BRIEF_FIXTURE = {
  what: 'Adds retry logic to the payment webhook handler.',
  why: 'Webhook deliveries were silently dropped on transient 5xx errors.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'reliability',
      title: 'Retry loop lacks backoff',
      explanation: 'Retries fire immediately, which could amplify an outage.',
      severity: 'medium',
      file_refs: [{ path: 'src/webhooks/handler.ts', start_line: 10, end_line: 24 }],
    },
  ],
  review_focus: [{ file: { path: 'src/webhooks/handler.ts' }, reason: 'Core retry logic change.' }],
};

/**
 * A `completeStructured` call that stays pending until `release()` is called.
 * A local stub (not a `mocks.ts` addition, per R-12) used ONLY by the
 * concurrency test below, to deterministically force two concurrent POSTs to
 * overlap inside `BriefService`'s single-flight window (EC-9) rather than
 * relying on incidental event-loop timing.
 */
class DeferredLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' = 'openai';
  calls: { method: string }[] = [];
  private release!: (result: StructuredResult<unknown>) => void;
  private readonly gate: Promise<StructuredResult<unknown>>;

  constructor() {
    this.gate = new Promise<StructuredResult<unknown>>((res) => {
      this.release = res;
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('should not be called by BriefService');
  }

  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured' });
    // Blocks here until `releaseAll()` is called — see class doc.
    return (await this.gate) as StructuredResult<T>;
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error('should not be called by BriefService');
  }

  /** Unblocks every pending `completeStructured` call with the fixed fixture. */
  releaseAll(): void {
    this.release({
      data: PR_BRIEF_FIXTURE,
      model: 'gpt-4.1',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(PR_BRIEF_FIXTURE),
      attempts: 1,
    });
  }
}

d('Brief HTTP routes (Testcontainers, AC-9 / AC-8 / AC-23)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);

  beforeAll(async () => {
    pg = await startPg();
    workspaceId = await seedAuthBootstrap(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('GET with no stored brief returns 200 with brief:null/meta:null/stale:false, and makes zero LLM calls (AC-23, AC-9)', async () => {
    const db = pg.handle.db;
    const repoId = await seedRepo(db, workspaceId, 'no-brief');
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const app = await buildApp({
      config,
      db,
      overrides: { llm: { openai: provider }, github: new MockGitHubClient() },
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ brief: null, meta: null, stale: false, latest_run: null });
    expect(() => BriefResponse.parse(body)).not.toThrow();

    // AC-9: zero LLM calls, even on the "no brief" branch.
    expect(provider.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('GET with a current (non-stale) brief returns it as-is and makes zero LLM calls', async () => {
    const db = pg.handle.db;
    const repoId = await seedRepo(db, workspaceId, 'current');
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    const repo = new BriefRepository(db);
    await repo.upsert(prId, makeStoredBrief('sha-a'));

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const app = await buildApp({
      config,
      db,
      overrides: { llm: { openai: provider }, github: new MockGitHubClient() },
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = BriefResponse.parse(res.json());
    expect(body.stale).toBe(false);
    expect(body.brief).not.toBeNull();
    expect(body.meta).not.toBeNull();
    expect(body.meta!.head_sha).toBe('sha-a');
    expect(body.brief!.what).toBe(makeStoredBrief('sha-a').brief.what);

    expect(provider.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('GET with a STALE brief reports stale:true, still returns the stored brief as-is, and makes zero LLM calls (AC-9)', async () => {
    const db = pg.handle.db;
    const repoId = await seedRepo(db, workspaceId, 'stale');
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    const repo = new BriefRepository(db);
    await repo.upsert(prId, makeStoredBrief('sha-a'));

    // The PR moved past the head the brief was generated for — no regeneration
    // happens as a side effect of this move (nothing else touches pr_brief).
    await db.update(t.pullRequests).set({ headSha: 'sha-b' }).where(eq(t.pullRequests.id, prId));

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const app = await buildApp({
      config,
      db,
      overrides: { llm: { openai: provider }, github: new MockGitHubClient() },
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = BriefResponse.parse(res.json());
    expect(body.stale).toBe(true);
    expect(body.brief).not.toBeNull();
    expect(body.meta!.head_sha).toBe('sha-a'); // the stored brief's own generation sha, unchanged

    // AC-9: GET NEVER regenerates, even though it just observed staleness.
    expect(provider.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('latest_run is null when the only run failed (EC-5), independent of brief presence', async () => {
    const db = pg.handle.db;
    const repoId = await seedRepo(db, workspaceId, 'failed-run');
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });
    const agentId = await seedAgent(db, workspaceId);
    await seedFailedRun(db, workspaceId, prId, agentId);

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const app = await buildApp({
      config,
      db,
      overrides: { llm: { openai: provider }, github: new MockGitHubClient() },
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = BriefResponse.parse(res.json());
    expect(body.brief).toBeNull(); // no brief generated in this test
    expect(body.latest_run).toBeNull(); // the only run failed — never counts (EC-5)

    await app.close();
  });

  it('latest_run is still resolved when brief is null (the two are independent)', async () => {
    const db = pg.handle.db;
    const repoId = await seedRepo(db, workspaceId, 'run-no-brief');
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });
    const agentId = await seedAgent(db, workspaceId);
    const runId = await seedCompletedRun(db, workspaceId, prId, agentId, { verdict: 'request_changes' });

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const app = await buildApp({
      config,
      db,
      overrides: { llm: { openai: provider }, github: new MockGitHubClient() },
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(res.statusCode).toBe(200);
    const body = BriefResponse.parse(res.json());
    expect(body.brief).toBeNull();
    expect(body.latest_run).not.toBeNull();
    expect(body.latest_run!.run_id).toBe(runId);
    expect(body.latest_run!.verdict).toBe('request_changes');

    expect(provider.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    await app.close();
  });

  it('GET on an unknown PR id 404s rather than leaking a "no brief" 200 (A01)', async () => {
    const db = pg.handle.db;
    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const app = await buildApp({
      config,
      db,
      overrides: { llm: { openai: provider }, github: new MockGitHubClient() },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-0000-0000-000000000000/brief',
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('POST config declares the 10/min rate limit (rate limiting is disabled under NODE_ENV=test — assert config, not observed 429s)', async () => {
    const db = pg.handle.db;
    const repoId = await seedRepo(db, workspaceId, 'rl-config');
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const app = await buildApp({
      config,
      db,
      overrides: { llm: { openai: provider }, github: new MockGitHubClient() },
    });

    let capturedConfig: unknown;
    app.addHook('preHandler', async (req) => {
      if (req.routeOptions.url === '/pulls/:id/brief/generate' && req.method === 'POST') {
        capturedConfig = req.routeOptions.config;
      }
    });

    await app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate` });
    expect(capturedConfig).toMatchObject({ rateLimit: { max: 10, timeWindow: '1 minute' } });

    await app.close();
  });

  it('concurrent POSTs for one PR state coalesce into one completeStructured call and identical bodies (EC-9, AC-8)', async () => {
    const db = pg.handle.db;
    const repoId = await seedRepo(db, workspaceId, 'concurrent');
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    const provider = new DeferredLLMProvider();
    const app = await buildApp({
      config,
      db,
      overrides: { llm: { openai: provider }, github: new MockGitHubClient() },
    });

    const post = () => app.inject({ method: 'POST', url: `/pulls/${prId}/brief/generate` });

    // Fire request 1 ALONE first and wait until it reaches (and blocks on)
    // `completeStructured`. Per `SingleFlight.run()`'s documented atomicity
    // guarantee ("fn() is invoked and the key registered with no `await`
    // between them"), the `${prId}:${headSha}` key is GUARANTEED to already
    // be in the map by the time this call lands — not merely "probably, if
    // the others were fast enough".
    //
    // The previous version of this test fired all three requests together
    // and released the provider as soon as request 1 reached the model
    // call. That is racy: requests 2/3 still had to complete their own
    // (real, Postgres) `getPull`/`getRepo` reads and reach
    // `singleFlight.run()` themselves, and nothing guaranteed that finished
    // before request 1's key was evicted — if it lost that race, request
    // 2/3 legitimately started a second, independent generation (a second
    // `completeStructured` call) even though the product code was correct.
    // See EC-9/AC-8 finding write-up for the full diagnosis.
    //
    // Only dispatching requests 2/3 AFTER request 1's key is confirmed
    // registered removes that direction of the race entirely — they can no
    // longer arrive at `run()` before the key exists.
    const call1 = post();
    const deadline = Date.now() + 2000;
    while (provider.calls.length < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(provider.calls).toHaveLength(1); // sanity: request 1 is now blocked inside the guard

    const call2 = post();
    const call3 = post();

    // Settle, not a barrier: give requests 2/3's own `getPull`/`getRepo`
    // reads (real Postgres round trips, not mocked — this module doesn't
    // expose a seam to instrument `singleFlight.run()` entry directly from
    // outside `BriefService`) time to complete and reach `run()` while
    // request 1's key is still registered, before we let request 1 proceed
    // past the gate. Request 1's key additionally stays registered for its
    // entire post-release tail (schema re-validation, grounding, and the
    // `repository.upsert` write) before `SingleFlight`'s `.finally()` evicts
    // it, which is further slack beyond this explicit wait — but that slack
    // is incidental, so it isn't relied on alone.
    await new Promise((r) => setTimeout(r, 100));

    provider.releaseAll();

    const [res1, res2, res3] = await Promise.all([call1, call2, call3]);

    expect(provider.calls).toHaveLength(1); // AC-8: coalesced into exactly one model call
    for (const res of [res1, res2, res3]) {
      expect(res.statusCode).toBe(200);
    }
    expect(res1.json()).toEqual(res2.json());
    expect(res1.json()).toEqual(res3.json());
    expect(() => StoredBrief.parse(res1.json())).not.toThrow();

    await app.close();
  });
});
