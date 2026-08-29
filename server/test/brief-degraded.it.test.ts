import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { GitHubClient, RepoRef, IssueMeta, PrDetail } from '@devdigest/shared';
import * as t from '../src/db/schema.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { BriefService, isBriefGenerationFailure } from '../src/modules/brief/service.js';
import { MockLLMProvider, MockGitHubClient, MockTokenizer } from '../src/adapters/mocks.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief-degraded.it] Docker not available — skipping Testcontainers integration test.');
}

type Db = PgFixture['handle']['db'];

async function seedWorkspace(db: Db): Promise<string> {
  const [row] = await db
    .insert(t.workspaces)
    .values({ name: 'brief-degraded-test' })
    .returning({ id: t.workspaces.id });
  return row!.id;
}

async function seedRepo(db: Db, workspaceId: string): Promise<string> {
  const [row] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: 'brief-degraded', fullName: 'acme/brief-degraded' })
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

async function seedIntent(db: Db, prId: string): Promise<void> {
  await db.insert(t.prIntent).values({
    prId,
    intent: 'Add retry logic so transient webhook failures are recovered automatically.',
    inScope: ['src/webhooks/handler.ts'],
    outOfScope: [],
  });
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
 * A `GitHubClient` that IS configured/present but whose issue/PR lookups
 * always throw (EC-4's "or throws" branch — distinct from "no GitHub client
 * configured at all", which the default `Container` already produces when no
 * `GITHUB_TOKEN` secret is set). Only `getIssue`/`getPullRequest` are
 * exercised by `BriefService.resolveLinkedIssue`; every other method is a
 * local stub, mirroring `brief-failure.it.test.ts`'s `RejectingLLMProvider`
 * pattern (R-12: a local stub, not a `mocks.ts` addition).
 */
class ThrowingGitHubClient implements GitHubClient {
  async listPullRequests(): Promise<never> {
    throw new Error('should not be called by BriefService');
  }
  async getPullRequest(_repo: RepoRef, _n: number): Promise<PrDetail> {
    throw new Error('upstream unavailable');
  }
  async postReview(): Promise<never> {
    throw new Error('should not be called by BriefService');
  }
  async listReviewComments(): Promise<never> {
    throw new Error('should not be called by BriefService');
  }
  async createReviewComment(): Promise<never> {
    throw new Error('should not be called by BriefService');
  }
  async openPullRequest(): Promise<never> {
    throw new Error('should not be called by BriefService');
  }
  async commitFiles(): Promise<never> {
    throw new Error('should not be called by BriefService');
  }
  async findOpenPr(): Promise<null> {
    return null;
  }
  async getIssue(_repo: RepoRef, _n: number): Promise<IssueMeta> {
    throw new Error('upstream unavailable');
  }
  async currentLogin(): Promise<string> {
    throw new Error('should not be called by BriefService');
  }
}

d('BriefService.generate — absent-input degradation (Testcontainers, AC-15)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('an absent intent, blast summary, and linked issue all proceed to a successful generation, each recorded once as omitted', async () => {
    const db = pg.handle.db;
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    // No `Closes #n` reference in the body, no clone/index for the repo, and
    // no intent row seeded — intent, blast, and linked_issue are all
    // naturally absent for this PR.
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a', body: 'No refs here.' });

    await db.insert(t.prFiles).values([
      { prId, path: 'src/webhooks/handler.ts', additions: 30, deletions: 4, patch: '@@ patch @@' },
    ]);

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    // No `github` override and no `GITHUB_TOKEN` secret — `container.github()`
    // rejects with `ConfigError`, exercising EC-4's "no GitHub client" branch.
    const container = new Container(config, db, {
      llm: { openai: provider },
    });

    const service = new BriefService(container);
    const result = await service.generate(workspaceId, prId);

    expect(isBriefGenerationFailure(result)).toBe(false);
    if (isBriefGenerationFailure(result)) throw new Error('expected a successful generation');

    expect(result.degraded).toContainEqual({ input: 'intent', action: 'omitted' });
    expect(result.degraded).toContainEqual({ input: 'blast', action: 'omitted' });
    expect(result.degraded).toContainEqual({ input: 'linked_issue', action: 'omitted' });

    // project_context is recorded exactly once, never duplicated by the
    // absent-input pass (v1 always omits it unconditionally in fitToBudget).
    const projectContextEntries = result.degraded.filter((entry) => entry.input === 'project_context');
    expect(projectContextEntries).toEqual([{ input: 'project_context', action: 'omitted' }]);

    // The generation still produced a real brief.
    expect(result.brief.what.length).toBeGreaterThan(0);
  });

  it('a linked issue that throws on lookup (EC-4) still proceeds, with intent present so only linked_issue/blast are omitted', async () => {
    const db = pg.handle.db;
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, {
      headSha: 'sha-b',
      number: 2,
      body: 'Fixes the retry bug. Closes #7.',
    });
    await seedIntent(db, prId);

    await db.insert(t.prFiles).values([
      { prId, path: 'src/webhooks/handler.ts', additions: 30, deletions: 4, patch: '@@ patch @@' },
    ]);

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const container = new Container(config, db, {
      llm: { openai: provider },
      github: new ThrowingGitHubClient(),
    });

    const service = new BriefService(container);
    const result = await service.generate(workspaceId, prId);

    expect(isBriefGenerationFailure(result)).toBe(false);
    if (isBriefGenerationFailure(result)) throw new Error('expected a successful generation');

    expect(result.degraded).toContainEqual({ input: 'linked_issue', action: 'omitted' });
    expect(result.degraded).toContainEqual({ input: 'blast', action: 'omitted' });
    // Intent was seeded and present — never recorded as omitted.
    expect(result.degraded.find((entry) => entry.input === 'intent')).toBeUndefined();
  });

  it('a run that both reduces one input (budget) and omits another (absent) records both, with every NFR-6 field intact', async () => {
    const db = pg.handle.db;
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    // No intent seeded -> 'intent' omitted. A large changed-file list under a
    // small MockTokenizer-measured budget -> 'changed_files' reduced.
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-c', number: 3, body: null });

    const manyFiles = Array.from({ length: 500 }, (_, i) => ({
      prId,
      path: `src/generated/file-${i}.ts`,
      additions: 500 - i,
      deletions: 1,
      patch: '@@ patch @@',
    }));
    await db.insert(t.prFiles).values(manyFiles);

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const container = new Container(config, db, {
      llm: { openai: provider },
      github: new MockGitHubClient(),
      // approxTokens (chars/4) against BRIEF_TOKEN_BUDGET (8000 tokens ==
      // 32000 chars) reliably forces the changed-files shed for 300 files.
      tokenizer: new MockTokenizer(),
    });

    const service = new BriefService(container);
    const result = await service.generate(workspaceId, prId);

    expect(isBriefGenerationFailure(result)).toBe(false);
    if (isBriefGenerationFailure(result)) throw new Error('expected a successful generation');

    const changedFilesEntry = result.degraded.find((entry) => entry.input === 'changed_files');
    expect(changedFilesEntry?.action).toBe('reduced');
    expect(result.degraded).toContainEqual({ input: 'intent', action: 'omitted' });

    const projectContextEntries = result.degraded.filter((entry) => entry.input === 'project_context');
    expect(projectContextEntries).toEqual([{ input: 'project_context', action: 'omitted' }]);

    // NFR-6: full generation metadata is still recorded alongside the
    // degradation list.
    expect(result.provider).toBe('openai');
    expect(typeof result.model).toBe('string');
    expect(typeof result.tokens_in).toBe('number');
    expect(typeof result.tokens_out).toBe('number');
    expect(typeof result.cost_usd).toBe('number');
    expect(typeof result.duration_ms).toBe('number');
    expect(result.input_tokens_measured).toBe(true);
  });
});
