import { describe, it, expect, vi } from 'vitest';
import type { Intent, PrIntentRecord, Review } from '@devdigest/shared';
import { IntentService } from '../src/modules/intent/service.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { RunBus } from '../src/platform/sse.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { AgentRow, PullRow } from '../src/db/rows.js';
import type { ReviewRepository } from '../src/modules/reviews/repository.js';
import type { Container } from '../src/platform/container.js';

/**
 * `IntentService.ensureForPull` (step 8) and its wiring into
 * `ReviewRunExecutor.executeRuns` (step 11) — cache-by-head-sha, best-effort
 * degradation, and "classify once per PR, not once per agent".
 *
 * Hermetic: no Postgres. `resolveFeatureModel` still issues a raw
 * `container.db.select().from().where()` query (it has no repo-layer
 * indirection to bypass, unlike `container.reviewRepo`), so `db` here is
 * stubbed to resolve `[]` — "no workspace override", which is exactly the
 * real behaviour on a fresh workspace and lets the registry default resolve.
 */

const VALID_DRAFT = {
  sources_used: ['pr_title', 'pr_body'],
  embedded_instructions_detected: false,
  type: 'feature',
  intent: 'Add rate limiting to public API endpoints.',
  in_scope: ['middleware on /api/public/*'],
  out_of_scope: ['authentication changes'],
};

const RAW_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;
const DIFF = parseUnifiedDiff(RAW_DIFF);

function makePull(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 482,
    title: 'Add rate limiting to public API endpoints',
    author: 'marisa.koch',
    branch: 'feat/rate-limit-public',
    base: 'main',
    headSha: 'sha-new',
    lastReviewedSha: null,
    additions: 10,
    deletions: 2,
    filesCount: 1,
    status: 'needs_review',
    body: 'Add rate limiting. Closes #471.',
    openedAt: null,
    updatedAt: null,
    ...overrides,
  } as PullRow;
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'repo-1',
    workspaceId: 'ws-1',
    owner: 'acme',
    name: 'widgets',
    fullName: 'acme/widgets',
    defaultBranch: 'main',
    clonePath: null,
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function fakeDb() {
  // Mimics `container.db.select({...}).from(t.settings).where(...)` resolving
  // to no rows — "no workspace override", so `resolveFeatureModel` falls back
  // to the registry default without ever needing a real Postgres connection.
  return {
    select: () => ({ from: () => ({ where: async () => [] }) }),
  };
}

function makeFakeReviewRepo(initial?: PrIntentRecord) {
  let stored = initial;
  return {
    getIntentRecord: vi.fn(async () => stored),
    upsertIntent: vi.fn(
      async (
        prId: string,
        intent: Intent,
        meta: { headSha: string | null; provider: string | null; model: string | null },
      ) => {
        stored = {
          ...intent,
          pr_id: prId,
          head_sha: meta.headSha,
          provider: meta.provider,
          model: meta.model,
          classified_at: new Date('2026-06-01T00:00:00.000Z').toISOString(),
        };
      },
    ),
  };
}

function buildContainer(opts: {
  reviewRepo: ReturnType<typeof makeFakeReviewRepo>;
  git?: MockGitClient;
  llm?: unknown;
}): Container {
  return {
    reviewRepo: opts.reviewRepo,
    git: opts.git ?? new MockGitClient(),
    // Always throws — L03 §1 removed linked-issue resolution, the
    // classifier's only network call, so `resolveSources` must never invoke
    // this at all. Any test that ends up calling it will fail loudly.
    github: async () => {
      throw new Error(
        'container.github() must never be called — L03 §1 removed linked-issue resolution',
      );
    },
    db: fakeDb(),
    llm: async () => opts.llm ?? new MockLLMProvider('openai', { structured: VALID_DRAFT }),
  } as unknown as Container;
}

function draftCallsOf(llm: MockLLMProvider) {
  return llm.calls.filter(
    (c) => c.method === 'completeStructured' && (c.req as { schemaName?: string }).schemaName === 'IntentDraft',
  );
}

describe('IntentService.ensureForPull — cache', () => {
  it('cache hit: a stored record whose head_sha === pull.headSha returns it without any IntentDraft call', async () => {
    const cached: PrIntentRecord = {
      intent: 'Cached intent summary.',
      in_scope: [],
      out_of_scope: [],
      type: 'feature',
      confidence: 'medium',
      sources: [{ kind: 'pr_title', ref: 'x', resolved: true }],
      pr_id: 'pr-1',
      head_sha: 'sha-new',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      classified_at: '2026-01-01T00:00:00.000Z',
    };
    const reviewRepo = makeFakeReviewRepo(cached);
    const llm = new MockLLMProvider('openai', { structured: VALID_DRAFT });
    const container = buildContainer({ reviewRepo, llm });
    const service = new IntentService(container);

    const result = await service.ensureForPull('ws-1', makePull({ headSha: 'sha-new' }), makeRepo(), DIFF, makeLogger());

    expect(result).toEqual(cached);
    expect(draftCallsOf(llm)).toHaveLength(0);
    expect(reviewRepo.upsertIntent).not.toHaveBeenCalled();
  });

  it('cache miss: a differing head_sha triggers exactly one classification and persists the new head_sha', async () => {
    const stale: PrIntentRecord = {
      intent: 'Stale.',
      in_scope: [],
      out_of_scope: [],
      type: 'chore',
      confidence: 'low',
      sources: [],
      pr_id: 'pr-1',
      head_sha: 'sha-old',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      classified_at: '2026-01-01T00:00:00.000Z',
    };
    const reviewRepo = makeFakeReviewRepo(stale);
    const llm = new MockLLMProvider('openai', { structured: VALID_DRAFT });
    const container = buildContainer({ reviewRepo, llm });
    const service = new IntentService(container);

    const result = await service.ensureForPull('ws-1', makePull({ headSha: 'sha-new' }), makeRepo(), DIFF, makeLogger());

    expect(result).toBeDefined();
    expect(result!.head_sha).toBe('sha-new');
    expect(draftCallsOf(llm)).toHaveLength(1);
    expect(reviewRepo.upsertIntent).toHaveBeenCalledTimes(1);
  });

  it('a legacy row with head_sha = null misses the cache and reclassifies once', async () => {
    const legacy: PrIntentRecord = {
      intent: 'Legacy, pre-L03-shaped row.',
      in_scope: [],
      out_of_scope: [],
      type: 'chore',
      confidence: 'low',
      sources: [],
      pr_id: 'pr-1',
      head_sha: null,
      provider: null,
      model: null,
      classified_at: null,
    };
    const reviewRepo = makeFakeReviewRepo(legacy);
    const llm = new MockLLMProvider('openai', { structured: VALID_DRAFT });
    const container = buildContainer({ reviewRepo, llm });
    const service = new IntentService(container);

    const result = await service.ensureForPull('ws-1', makePull({ headSha: 'sha-new' }), makeRepo(), DIFF, makeLogger());

    expect(result).toBeDefined();
    expect(result!.head_sha).toBe('sha-new');
    expect(draftCallsOf(llm)).toHaveLength(1);
  });
});

describe('IntentService.ensureForPull — never throws', () => {
  it('(a) a container whose github() throws does not affect classification — no linked_issue is emitted, and github() is never called', async () => {
    const reviewRepo = makeFakeReviewRepo(undefined);
    const container = buildContainer({ reviewRepo });
    const githubSpy = vi.spyOn(container, 'github');
    const service = new IntentService(container);

    const result = await service.ensureForPull(
      'ws-1',
      makePull({ body: 'Add rate limiting. Closes #471.' }),
      makeRepo(),
      DIFF,
      makeLogger(),
    );

    expect(result).toBeDefined();
    expect(result!.sources.some((s) => s.kind === 'linked_issue')).toBe(false);
    expect(githubSpy).not.toHaveBeenCalled();
  });

  it('(b) container.git.readFile rejecting degrades the doc source but still classifies (no throw)', async () => {
    const git = new MockGitClient();
    vi.spyOn(git, 'readFile').mockRejectedValue(new Error('ENOENT: no such file'));
    const reviewRepo = makeFakeReviewRepo(undefined);
    const container = buildContainer({ reviewRepo, git });
    const service = new IntentService(container);

    const result = await service.ensureForPull(
      'ws-1',
      makePull({ body: 'See docs/plan.md for the design.' }),
      makeRepo(),
      DIFF,
      makeLogger(),
    );

    expect(result).toBeDefined();
    expect(result!.sources).toContainEqual({ kind: 'doc', ref: 'docs/plan.md', resolved: false });
  });

  it('(c) the LLM call rejecting returns undefined and never propagates', async () => {
    const reviewRepo = makeFakeReviewRepo(undefined);
    const rejectingLlm = {
      id: 'openai' as const,
      listModels: async () => [],
      complete: async () => {
        throw new Error('unused');
      },
      completeStructured: async () => {
        throw new Error('LLM unavailable');
      },
      embed: async () => [],
    };
    const container = buildContainer({ reviewRepo, llm: rejectingLlm });
    const service = new IntentService(container);

    await expect(service.ensureForPull('ws-1', makePull(), makeRepo(), DIFF, makeLogger())).resolves.toBeUndefined();
  });

  it('(d) the LLM returning a payload that fails schema validation returns undefined and never propagates', async () => {
    const reviewRepo = makeFakeReviewRepo(undefined);
    const badLlm = new MockLLMProvider('openai', { structured: { totally: 'wrong-shape' } });
    const container = buildContainer({ reviewRepo, llm: badLlm });
    const service = new IntentService(container);

    await expect(service.ensureForPull('ws-1', makePull(), makeRepo(), DIFF, makeLogger())).resolves.toBeUndefined();
  });
});

describe('IntentService.ensureForPull — code inference never inflates confidence', () => {
  it('a PR with an empty body still yields confidence "low", never "medium"', async () => {
    const reviewRepo = makeFakeReviewRepo(undefined);
    const draft = {
      ...VALID_DRAFT,
      sources_used: ['diff'],
      intent: 'Inferred from the diff — no PR description was given.',
    };
    const llm = new MockLLMProvider('openai', { structured: draft });
    const container = buildContainer({ reviewRepo, llm });
    const service = new IntentService(container);

    const result = await service.ensureForPull('ws-1', makePull({ body: '' }), makeRepo(), DIFF, makeLogger());

    expect(result).toBeDefined();
    expect(result!.confidence).toBe('low');

    // The code digest (the changed-file list) is always sent, regardless of
    // how thin the documentary evidence is — it never gates on an
    // `includeCode` flag, unlike the old tier-2 design.
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const userMsg = (call!.req as { messages: { role: string; content: string }[] }).messages.find(
      (m) => m.role === 'user',
    )!.content;
    expect(userMsg).toContain('Changed files:');
    expect(userMsg).toContain('src/config.ts');
  });
});

/**
 * The central point of L03 §1: the classifier's inputs narrow to exactly
 * four things, and the changed-file list is built from hunk HEADERS only
 * (path + adds/dels) — never hunk CONTENT. Assert this directly on the
 * assembled user message, not via a proxy such as a flag.
 */
describe('IntentService.ensureForPull — no hunk content ever reaches the assembled user message', () => {
  it('the user message contains the changed file path but none of the diff\'s added/removed content lines, and no Branch line', async () => {
    const reviewRepo = makeFakeReviewRepo(undefined);
    const llm = new MockLLMProvider('openai', { structured: VALID_DRAFT });
    const container = buildContainer({ reviewRepo, llm });
    const service = new IntentService(container);

    const result = await service.ensureForPull(
      'ws-1',
      makePull({ body: 'Add rate limiting.' }),
      makeRepo(),
      DIFF,
      makeLogger(),
    );

    expect(result).toBeDefined();

    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const userMsg = (call!.req as { messages: { role: string; content: string }[] }).messages.find(
      (m) => m.role === 'user',
    )!.content;

    // The path from the hunk header IS present.
    expect(userMsg).toContain('src/config.ts');
    // None of RAW_DIFF's hunk-body content lines are present.
    expect(userMsg).not.toContain('stripeKey');
    expect(userMsg).not.toContain('sk_live_xxx');
    expect(userMsg).not.toContain('port: 3000');
    expect(userMsg).not.toContain('redisUrl');
    // No raw diff markup at all.
    expect(userMsg).not.toContain('@@');
    expect(userMsg).not.toContain('diff --git');
    // The branch name was dropped from the classifier's inputs.
    expect(userMsg).not.toContain('feat/rate-limit-public');
    expect(userMsg).not.toContain('Branch:');
  });
});

// ---------------------------------------------------------------------------

/**
 * `ReviewRunExecutor.executeRuns` — step 11's "once per PR, not once per
 * agent" wiring and the "intent failure never fails the run" contract.
 * `container.intent` is injected directly (`ContainerOverrides.intent`'s
 * intended seam), so this exercises run-executor's CALL PATTERN, independent
 * of `IntentService`'s own logic (covered above).
 */

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
  ],
};

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'Test Agent',
    description: '',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are a reviewer.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    // Repo-intel is out of scope for this test — disable so the executor
    // never touches `container.repoIntel`.
    repoIntel: false,
    enabled: true,
    version: 1,
    createdBy: null,
    createdAt: new Date(),
    ...overrides,
  } as AgentRow;
}

function makeFakeExecRepo() {
  return {
    insertReview: vi.fn(async (values: Record<string, unknown>) => ({
      id: `review-${Math.random()}`,
      createdAt: new Date(),
      ...values,
    })),
    insertFindings: vi.fn(async () => []),
    completeAgentRun: vi.fn(async () => undefined),
    saveRunTrace: vi.fn(async () => undefined),
    markReviewed: vi.fn(async () => undefined),
    getPrFiles: vi.fn(async () => []),
  } as unknown as ReviewRepository;
}

function buildExecContainer(opts: {
  ensureForPull: () => Promise<PrIntentRecord | undefined>;
}): Container {
  return {
    runBus: new RunBus(),
    git: new MockGitClient({ diff: RAW_DIFF }),
    agentsRepo: { linkedSkills: vi.fn(async () => []) },
    intent: {
      ensureForPull: vi.fn(opts.ensureForPull),
      renderBlock: vi.fn(() => 'INTENT BLOCK'),
    },
    llm: async () => new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }),
  } as unknown as Container;
}

describe('ReviewRunExecutor.executeRuns — intent is derived once per PR', () => {
  it('calls container.intent.ensureForPull exactly ONCE for N>=2 agent jobs sharing one PR', async () => {
    const fakeRecord: PrIntentRecord = {
      intent: 'Add rate limiting.',
      in_scope: [],
      out_of_scope: [],
      type: 'feature',
      confidence: 'medium',
      sources: [],
      pr_id: 'pr-1',
      head_sha: 'sha-new',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      classified_at: '2026-06-01T00:00:00.000Z',
    };
    const container = buildExecContainer({ ensureForPull: async () => fakeRecord });
    const repo = makeFakeExecRepo();
    const executor = new ReviewRunExecutor(container, repo, {} as Container['agentsRepo']);

    const jobs = [
      { agent: makeAgent({ id: 'a1', name: 'Agent One' }), runId: 'run-1' },
      { agent: makeAgent({ id: 'a2', name: 'Agent Two' }), runId: 'run-2' },
    ];

    await executor.executeRuns('ws-1', makePull(), makeRepo() as never, jobs);

    expect(container.intent.ensureForPull).toHaveBeenCalledTimes(1);
    expect(repo.insertReview).toHaveBeenCalledTimes(2);
  });

  it('an intent classification failure does not fail the run — the review still completes and persists findings', async () => {
    const container = buildExecContainer({
      ensureForPull: async () => {
        throw new Error('classification boom');
      },
    });
    const repo = makeFakeExecRepo();
    const executor = new ReviewRunExecutor(container, repo, {} as Container['agentsRepo']);

    await executor.executeRuns('ws-1', makePull(), makeRepo() as never, [{ agent: makeAgent(), runId: 'run-1' }]);

    expect(repo.completeAgentRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'done' }));
    expect(repo.insertFindings).toHaveBeenCalled();
  });
});
