import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { StoredBrief } from '@devdigest/shared';
import * as t from '../src/db/schema.js';
import { BriefRepository } from '../src/modules/brief/repository.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[brief-repo.it] Docker not available — skipping.');
}

type Db = PgFixture['handle']['db'];

async function seedWorkspace(db: Db): Promise<string> {
  const [row] = await db.insert(t.workspaces).values({ name: 'brief-repo-test' }).returning({ id: t.workspaces.id });
  return row!.id;
}

async function seedRepo(db: Db, workspaceId: string): Promise<string> {
  const [row] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: 'brief-test', fullName: 'acme/brief-test' })
    .returning({ id: t.repos.id });
  return row!.id;
}

async function seedPull(
  db: Db,
  workspaceId: string,
  repoId: string,
  overrides: Partial<{ headSha: string; number: number }> = {},
): Promise<string> {
  const [row] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number: overrides.number ?? 1,
      title: 'Test PR',
      author: 'octocat',
      branch: 'feature/x',
      base: 'main',
      headSha: overrides.headSha ?? 'sha-a',
    })
    .returning({ id: t.pullRequests.id });
  return row!.id;
}

async function seedAgent(db: Db, workspaceId: string, name = 'Security Reviewer'): Promise<string> {
  const [row] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name,
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'Review the diff.',
    })
    .returning({ id: t.agents.id });
  return row!.id;
}

async function seedCompletedRun(
  db: Db,
  workspaceId: string,
  prId: string,
  agentId: string,
  overrides: Partial<{ verdict: string; findingsCount: number; blockers: number }> = {},
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
      findingsCount: overrides.findingsCount ?? 2,
      grounding: 'ok',
      score: 80,
      blockers: overrides.blockers ?? 0,
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
      review_focus: [
        {
          file: { path: 'src/webhooks/handler.ts' },
          reason: 'Core retry logic change.',
        },
      ],
    },
  };
}

d('BriefRepository (Testcontainers)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('upsert then getStored round-trips the envelope; isStale is false at the stored head_sha', async () => {
    const db = pg.handle.db;
    const repo = new BriefRepository(db);
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    const stored = makeStoredBrief('sha-a');
    await repo.upsert(prId, stored);

    const fetched = await repo.getStored(prId);
    expect(fetched).toEqual(stored);

    const headSha = await repo.getPullHeadSha(workspaceId, prId);
    expect(headSha).toBe('sha-a');
    expect(repo.isStale(fetched!, headSha!)).toBe(false);
  });

  it('when the PR head moves, the same stored brief is returned but isStale flips true — no write happens', async () => {
    const db = pg.handle.db;
    const repo = new BriefRepository(db);
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    const stored = makeStoredBrief('sha-a');
    await repo.upsert(prId, stored);

    // Move the PR's head to a new sha (simulating a new push) without
    // touching pr_brief at all.
    await db.update(t.pullRequests).set({ headSha: 'sha-b' }).where(eq(t.pullRequests.id, prId));

    const fetched = await repo.getStored(prId);
    expect(fetched).toEqual(stored); // same brief, no regeneration happened

    const headSha = await repo.getPullHeadSha(workspaceId, prId);
    expect(headSha).toBe('sha-b');
    expect(repo.isStale(fetched!, headSha!)).toBe(true);

    // Confirm the row genuinely wasn't rewritten by re-reading directly.
    const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect((row!.json as StoredBrief).head_sha).toBe('sha-a');
  });

  it('a row whose json is garbage reads as null, not a throw', async () => {
    const db = pg.handle.db;
    const repo = new BriefRepository(db);
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    await db.insert(t.prBrief).values({ prId, json: { garbage: true } });

    await expect(repo.getStored(prId)).resolves.toBeNull();
  });

  it('upsert on the same pr_id replaces the previous envelope (onConflictDoUpdate)', async () => {
    const db = pg.handle.db;
    const repo = new BriefRepository(db);
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    await repo.upsert(prId, makeStoredBrief('sha-a'));
    const regenerated = makeStoredBrief('sha-b');
    await repo.upsert(prId, regenerated);

    const fetched = await repo.getStored(prId);
    expect(fetched).toEqual(regenerated);

    const rows = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect(rows).toHaveLength(1);
  });

  it('getChangedFiles returns path/additions/deletions only, never patch', async () => {
    const db = pg.handle.db;
    const repo = new BriefRepository(db);
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId);

    await db.insert(t.prFiles).values([
      { prId, path: 'src/a.ts', additions: 10, deletions: 2, patch: '@@ -1,2 +1,10 @@ secret patch text' },
      { prId, path: 'src/b.ts', additions: 3, deletions: 0, patch: '@@ -1 +1 @@ another patch' },
    ]);

    const files = await repo.getChangedFiles(prId);
    expect(files).toHaveLength(2);
    for (const f of files) {
      expect(Object.keys(f).sort()).toEqual(['additions', 'deletions', 'path']);
      expect((f as Record<string, unknown>).patch).toBeUndefined();
    }
    expect(files.map((f) => f.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('getLatestRunRows joins agent_runs to reviews and includes the agent name', async () => {
    const db = pg.handle.db;
    const repo = new BriefRepository(db);
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId);
    const agentId = await seedAgent(db, workspaceId, 'Security Reviewer');
    const runId = await seedCompletedRun(db, workspaceId, prId, agentId, { verdict: 'request_changes', findingsCount: 3, blockers: 1 });

    const rows = await repo.getLatestRunRows(workspaceId, prId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      run_id: runId,
      status: 'done',
      verdict: 'request_changes',
      findings_count: 3,
      blockers: 1,
      agent_name: 'Security Reviewer',
    });
  });

  it('a merged/closed PR reads and re-upserts normally (EC-8)', async () => {
    const db = pg.handle.db;
    const repo = new BriefRepository(db);
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    await repo.upsert(prId, makeStoredBrief('sha-a'));
    await db.update(t.pullRequests).set({ status: 'merged' }).where(eq(t.pullRequests.id, prId));

    const fetched = await repo.getStored(prId);
    expect(fetched).not.toBeNull();

    const regenerated = makeStoredBrief('sha-a');
    await expect(repo.upsert(prId, regenerated)).resolves.toBeUndefined();

    const refetched = await repo.getStored(prId);
    expect(refetched).toEqual(regenerated);
  });
});
