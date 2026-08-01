import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import type { RunTrace } from '../vendor/shared/index.js';
import { eq, and, desc } from 'drizzle-orm';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { SEED_PRS } from './seed-prs.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), the three built-in agents (General + Security
 * + Performance) on the default openrouter/deepseek-v4-flash provider+model,
 * and the demo pull requests from ./seed-prs.ts — each with its runs, its
 * run-linked reviews, and their findings, so the COST column, the FINDINGS
 * badges and the Agent-runs timeline all have data before the first real review.
 *
 * Guards are PER FIXTURE (per PR, then per PR's runs), not one gate over
 * everything: that is what lets a PR added to the fixtures later appear on a
 * database seeded before it existed. Repairing demo data that an OLDER seed
 * already wrote is a migration's job, not this file's — see 0012.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- demo pull requests (fixtures in ./seed-prs.ts) ----
  // Each PR is guarded independently, so a fixture ADDED later still lands on a
  // database that was seeded before it existed. Runs/reviews/findings are not
  // written here: they need the agent ids, so they follow the agents block.
  const prIds = new Map<number, string>();
  for (const fx of SEED_PRS) {
    let [row] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, fx.number)));
    if (!row) {
      const updatedAt = daysAgo(fx.ageDays);
      [row] = await db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: fx.number,
          title: fx.title,
          author: fx.author,
          branch: fx.branch,
          base: 'main',
          headSha: fx.headSha,
          // deriveReviewStatus (modules/pulls/status.ts) computes the list's
          // STATUS chip from these two, not from the `status` column: the head
          // being reviewed gives reviewed/stale, a mismatch gives needs_review.
          lastReviewedSha: fx.headReviewed ? fx.headSha : null,
          additions: fx.additions,
          deletions: fx.deletions,
          filesCount: fx.filesCount,
          status: 'open',
          body: fx.body,
          openedAt: daysAgo(fx.ageDays + 1),
          updatedAt,
        })
        .returning();

      await db
        .insert(t.prFiles)
        .values(fx.files.map((f) => ({ prId: row!.id, ...f })));
      await db
        .insert(t.prCommits)
        .values(fx.commits.map((c) => ({ prId: row!.id, ...c, committedAt: updatedAt })));
    }
    prIds.set(fx.number, row!.id);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- runs + reviews + findings, per demo PR --------------------------------
  // (L01 — specs/0001-run-cost-badge.md and specs/0002-findings-badges.md.)
  // Without these, COST is "—" and the FINDINGS column is empty on a fresh
  // install, so both features are invisible until a model key is configured.
  //
  // Seeded AFTER the agents block because runs reference agent ids, and gated
  // PER PR so a fixture added later still lands on an existing database.
  //
  // A review always carries runId + agentId: the Agent-runs timeline attributes
  // findings to a run through reviews.run_id, and a null there is exactly the
  // orphan that migration 0012 exists to repair.
  const named = await db
    .select({ id: t.agents.id, name: t.agents.name })
    .from(t.agents)
    .where(eq(t.agents.workspaceId, workspaceId));
  const idOf = (name: string) => named.find((a) => a.name === name)?.id ?? null;

  for (const fx of SEED_PRS) {
    const prId = prIds.get(fx.number)!;
    const [anyRun] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, prId));
    if (anyRun) continue;

    for (const run of fx.runs) {
      const findings = run.review?.findings ?? [];
      const ranAt = minutesAgo(run.minutesAgo);
      const [inserted] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: idOf(run.agent),
          prId,
          ranAt,
          provider: DEFAULT_PROVIDER,
          model: DEFAULT_MODEL,
          durationMs: run.durationMs,
          tokensIn: run.tokensIn,
          tokensOut: run.tokensOut,
          costUsd: run.costUsd,
          status: run.status,
          error: run.error ?? null,
          grounding: run.grounding,
          // Derived from the findings, never hand-written: these denormalized
          // counters sit on the same timeline row as the severity badges, so a
          // literal that drifts from the findings renders as a contradiction.
          findingsCount: findings.length,
          blockers: run.review ? findings.filter((f) => f.severity === 'CRITICAL').length : null,
          score: run.review?.score ?? null,
        })
        .returning();

      if (!run.review) continue;
      const [review] = await db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId,
          agentId: inserted!.agentId,
          runId: inserted!.id,
          kind: 'review',
          verdict: run.review.verdict,
          summary: run.review.summary,
          score: run.review.score,
          model: DEFAULT_MODEL,
          // Stamped from the run rather than left to defaultNow(): the
          // Review-runs accordion orders newest-first and opens the first one,
          // so insertion order would otherwise decide which run reads as
          // "latest" — and it disagrees with the runs' own chronology.
          createdAt: ranAt,
        })
        .returning();
      if (findings.length > 0) {
        await db.insert(t.findings).values(findings.map((f) => ({ ...f, reviewId: review!.id })));
      }
    }
  }

  // One trace so the run-trace drawer (and its COST tile) has content, on the
  // primary demo PR's newest completed run.
  const [tracedRun] = await db
    .select()
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.prId, prIds.get(482)!), eq(t.agentRuns.status, 'done')))
    .orderBy(desc(t.agentRuns.ranAt))
    .limit(1);
  if (tracedRun) {
    const [existingTrace] = await db
      .select()
      .from(t.runTraces)
      .where(eq(t.runTraces.runId, tracedRun.id));
    if (!existingTrace) {
      // Typed as RunTrace so the compiler enforces the contract's required
      // fields — the `trace` column is jsonb, so an untyped literal type-checks
      // happily and only fails at render time in the drawer.
      const seedTrace: RunTrace = {
        config: {
          agent: 'Security Reviewer',
          version: 'v7',
          provider: DEFAULT_PROVIDER,
          model: DEFAULT_MODEL,
          pr: 482,
          source: 'local',
        },
        stats: {
          duration_ms: tracedRun.durationMs ?? 0,
          tokens_in: tracedRun.tokensIn ?? 0,
          tokens_out: tracedRun.tokensOut ?? 0,
          cost_usd: tracedRun.costUsd ?? null,
          findings: tracedRun.findingsCount ?? 0,
          grounding: tracedRun.grounding ?? '0/0 passed',
        },
        prompt_assembly: {
          system: 'You are a security reviewer.',
          skills: null,
          memory: null,
          specs: null,
          user: 'Review PR #482 — Add rate limiting to public API endpoints',
        },
        tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
        raw_output: '{"verdict":"request_changes"}',
        // Required arrays on RunTrace — the executor always writes them, and
        // TraceBody reads .length unguarded. Omitting them crashes the drawer.
        memory_pulled: [],
        specs_read: [],
        log: [],
      };
      await db.insert(t.runTraces).values({ runId: tracedRun.id, trace: seedTrace });
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
