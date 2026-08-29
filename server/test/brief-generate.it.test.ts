import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { StoredBrief } from '@devdigest/shared';
import * as t from '../src/db/schema.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { BriefService } from '../src/modules/brief/service.js';
import { MockLLMProvider, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief-generate.it] Docker not available — skipping Testcontainers integration test.');
}

type Db = PgFixture['handle']['db'];

async function seedWorkspace(db: Db): Promise<string> {
  const [row] = await db
    .insert(t.workspaces)
    .values({ name: 'brief-generate-test' })
    .returning({ id: t.workspaces.id });
  return row!.id;
}

async function seedRepo(db: Db, workspaceId: string): Promise<string> {
  const [row] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: 'brief-generate', fullName: 'acme/brief-generate' })
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
      body: overrides.body ?? 'Adds retries. Closes #7.',
    })
    .returning({ id: t.pullRequests.id });
  return row!.id;
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
  review_focus: [
    { file: { path: 'src/webhooks/handler.ts' }, reason: 'Core retry logic change.' },
  ],
};

const PR_BRIEF_EMPTY_FIXTURE = {
  what: 'No files changed in this PR.',
  why: 'The PR contains no diff to assess.',
  risk_level: 'low',
  risks: [],
  review_focus: [],
};

/** Collects every `.info`/`.warn`/`.error`/`.debug` call as a single string,
 *  so tests can grep the FULL captured log output for a leaked secret. */
function makeCapturingLogger() {
  const lines: string[] = [];
  const capture = (obj: unknown, msg?: string) => {
    lines.push(JSON.stringify({ obj, msg }));
  };
  return {
    logger: { info: capture, warn: capture, error: capture, debug: capture },
    text: () => lines.join('\n'),
  };
}

d('BriefService.generate (Testcontainers, AC-2)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('produces exactly one completeStructured call and a StoredBrief-valid row, with usage/timing recorded', async () => {
    const db = pg.handle.db;
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    await db.insert(t.prFiles).values([
      { prId, path: 'src/webhooks/handler.ts', additions: 30, deletions: 4, patch: '@@ secret patch body @@' },
      { prId, path: 'src/webhooks/types.ts', additions: 12, deletions: 1, patch: '@@ another patch @@' },
    ]);

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const secretValue = 'sk-test-should-never-appear-in-logs';
    const { logger, text } = makeCapturingLogger();

    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const container = new Container(config, db, {
      llm: { openai: provider },
      github: new MockGitHubClient(),
      secrets: new MockSecretsProvider({ GITHUB_TOKEN: secretValue }),
    });

    const service = new BriefService(container, logger);
    const stored = await service.generate(workspaceId, prId);

    // AC-2: exactly one completeStructured call.
    expect(provider.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    // The row satisfies StoredBrief.
    expect(() => StoredBrief.parse(stored)).not.toThrow();

    // Usage reported by the stub lands in the stored envelope (AC-10, NFR-6).
    expect(stored.model).toBe('gpt-4.1');
    expect(stored.provider).toBe('openai');
    expect(stored.tokens_in).toBe(100);
    expect(stored.tokens_out).toBe(50);
    expect(stored.cost_usd).toBe(0.001);
    expect(stored.duration_ms).not.toBeNull();
    expect(typeof stored.duration_ms).toBe('number');
    expect(stored.input_tokens_measured).toBe(true);

    // Persisted row round-trips through the repository too.
    const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect(row).toBeDefined();
    const persisted = StoredBrief.parse(row!.json);
    expect(persisted.head_sha).toBe('sha-a');
    expect(persisted.brief.risks[0]!.file_refs[0]!.path).toBe('src/webhooks/handler.ts');

    // NFR-7: no secrets-provider value anywhere in the captured log output.
    expect(text()).not.toContain(secretValue);
  });

  it('a zero-changed-file PR still yields a non-empty what/why with empty risks/review_focus (EC-3)', async () => {
    const db = pg.handle.db;
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-b', number: 2, body: null });

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_EMPTY_FIXTURE });
    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const container = new Container(config, db, {
      llm: { openai: provider },
      github: new MockGitHubClient(),
    });

    const service = new BriefService(container);
    const stored = await service.generate(workspaceId, prId);

    expect(provider.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect(stored.brief.what.length).toBeGreaterThan(0);
    expect(stored.brief.why.length).toBeGreaterThan(0);
    expect(stored.brief.risks).toEqual([]);
    expect(stored.brief.review_focus).toEqual([]);
  });
});
