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
import * as t from '../src/db/schema.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { BriefService, isBriefGenerationFailure } from '../src/modules/brief/service.js';
import { MockLLMProvider, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';

/** Collects every `.info`/`.warn`/`.error`/`.debug` call as a single string,
 *  so a test can grep the FULL captured log output for diagnostic content or
 *  a leaked secret — mirrors `brief-generate.it.test.ts`'s helper of the same
 *  shape (kept local rather than shared, this module's owned paths are
 *  self-contained). */
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

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief-failure.it] Docker not available — skipping Testcontainers integration test.');
}

type Db = PgFixture['handle']['db'];

async function seedWorkspace(db: Db): Promise<string> {
  const [row] = await db
    .insert(t.workspaces)
    .values({ name: 'brief-failure-test' })
    .returning({ id: t.workspaces.id });
  return row!.id;
}

async function seedRepo(db: Db, workspaceId: string): Promise<string> {
  const [row] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: 'brief-failure', fullName: 'acme/brief-failure' })
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

// Same shape as PR_BRIEF_FIXTURE except an out-of-set risk_level (EC-10) —
// fails PrBrief.safeParse both inside MockLLMProvider (which throws with a
// "failed schema" message) and, if it ever got past that, in the service's
// own defensive re-validation.
const PR_BRIEF_INVALID_FIXTURE = {
  ...PR_BRIEF_FIXTURE,
  risk_level: 'catastrophic',
};

/**
 * A minimal `LLMProvider` whose `completeStructured` always rejects with a
 * plain network-style error — the "model call throws" case that has nothing
 * to do with schema validation (R-12: a local stub, not a `mocks.ts`
 * addition, keeps this module's owned paths self-contained).
 */
class RejectingLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' = 'openai';
  calls: { method: string }[] = [];

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('should not be called by BriefService');
  }

  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured' });
    throw new Error('network error: upstream unavailable');
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error('should not be called by BriefService');
  }
}

async function readStoredJson(db: Db, prId: string): Promise<unknown | undefined> {
  const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
  return row?.json;
}

d('BriefService.generate — failure branch (Testcontainers, AC-16)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('a rejecting model call stores nothing and reports model_error with no prior brief', async () => {
    const db = pg.handle.db;
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-a' });

    const provider = new RejectingLLMProvider();
    const secretValue = 'sk-test-should-never-appear-in-logs';
    const { logger, text } = makeCapturingLogger();
    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const container = new Container(config, db, {
      llm: { openai: provider },
      github: new MockGitHubClient(),
      secrets: new MockSecretsProvider({ GITHUB_TOKEN: secretValue }),
    });

    const service = new BriefService(container, logger);
    const result = await service.generate(workspaceId, prId);

    expect(provider.calls).toHaveLength(1);
    expect(isBriefGenerationFailure(result)).toBe(true);
    if (!isBriefGenerationFailure(result)) throw new Error('expected a failure result');
    expect(result.reason).toBe('model_error');
    expect(result.hasPriorBrief).toBe(false);

    // Nothing written.
    expect(await readStoredJson(db, prId)).toBeUndefined();

    // The warn log can explain its own failure: the thrown error's message
    // and the provider/model the call was attempted against (the finding
    // this test guards against — a `model_error` with no diagnosable cause).
    const logged = text();
    expect(logged).toContain('network error: upstream unavailable');
    expect(logged).toContain('"provider":"openai"');
    expect(logged).toContain('"model":"gpt-4.1"');

    // NFR-7: no secrets-provider value anywhere in the captured log output —
    // the error detail must never carry a credential.
    expect(logged).not.toContain(secretValue);
  });

  it('a provider returning an out-of-set risk_level stores nothing and reports invalid_result (EC-10)', async () => {
    const db = pg.handle.db;
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-b', number: 2 });

    const provider = new MockLLMProvider('openai', { structured: PR_BRIEF_INVALID_FIXTURE });
    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const container = new Container(config, db, {
      llm: { openai: provider },
      github: new MockGitHubClient(),
    });

    const service = new BriefService(container);
    const result = await service.generate(workspaceId, prId);

    expect(isBriefGenerationFailure(result)).toBe(true);
    if (!isBriefGenerationFailure(result)) throw new Error('expected a failure result');
    expect(result.reason).toBe('invalid_result');
    expect(result.hasPriorBrief).toBe(false);

    expect(await readStoredJson(db, prId)).toBeUndefined();
  });

  it('a failed regeneration leaves a previously stored brief byte-identical and reports hasPriorBrief', async () => {
    const db = pg.handle.db;
    const workspaceId = await seedWorkspace(db);
    const repoId = await seedRepo(db, workspaceId);
    const prId = await seedPull(db, workspaceId, repoId, { headSha: 'sha-c', number: 3 });

    // First, a successful generation to establish a prior brief.
    const goodProvider = new MockLLMProvider('openai', { structured: PR_BRIEF_FIXTURE });
    const config = loadConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const goodContainer = new Container(config, db, {
      llm: { openai: goodProvider },
      github: new MockGitHubClient(),
    });
    const goodService = new BriefService(goodContainer);
    const stored = await goodService.generate(workspaceId, prId);
    expect(isBriefGenerationFailure(stored)).toBe(false);

    const beforeJson = await readStoredJson(db, prId);
    expect(beforeJson).toBeDefined();

    // A second call for the SAME PR row (head_sha unchanged — the row itself
    // is mutable in Postgres, so this simulates "regenerate on demand"
    // rather than relying on single-flight coalescing) that fails.
    const failingProvider = new RejectingLLMProvider();
    const failingContainer = new Container(config, db, {
      llm: { openai: failingProvider },
      github: new MockGitHubClient(),
    });
    const failingService = new BriefService(failingContainer);
    const result = await failingService.generate(workspaceId, prId);

    expect(isBriefGenerationFailure(result)).toBe(true);
    if (!isBriefGenerationFailure(result)) throw new Error('expected a failure result');
    expect(result.reason).toBe('model_error');
    expect(result.hasPriorBrief).toBe(true);

    // The prior brief's full `json` is byte-identical before and after.
    const afterJson = await readStoredJson(db, prId);
    expect(afterJson).toEqual(beforeJson);
  });
});
