import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApiClient } from '../api-client.js';
import type { ReviewDto } from '../api-client.js';
import { createResolver } from '../resolve.js';
import { createRunIndex, type RunIndex, type RunIndexEntry } from '../run-index.js';
import type { McpConfig } from '../config.js';
import type { ToolDeps } from '../tools/types.js';
import { TOOL_ERROR_KINDS } from '../errors.js';
import type { ToolErrorKind } from '../errors.js';
import {
  AGENT_GENERAL_ID,
  PR_480_NUMBER,
  PR_482_ID,
  RUN_ID,
  createFakeApi,
} from '../../test/fake-api.js';
import { RUN_OUTCOME_FAILED_KINDS, runReview } from './run-review.js';
import type { RunOutcomeFailedKind } from './run-review.js';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'mcp-run-review-test-'));
}

/** Small-budget config so timeout scenarios exercise in real milliseconds, not the 240s default. */
function testConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  return {
    apiUrl: 'http://127.0.0.1:3001',
    runTimeoutMs: 5_000,
    pollIntervalMs: 5,
    maxFindings: 20,
    debug: undefined,
    apiToken: undefined,
    ...overrides,
  };
}

function buildDeps(
  fakeApi: ReturnType<typeof createFakeApi>,
  config: McpConfig,
  runIndex?: RunIndex,
): ToolDeps {
  const api = createApiClient({ config, fetch: fakeApi.fetch });
  const resolver = createResolver(api);
  return {
    api,
    resolver,
    runIndex: runIndex ?? createRunIndex({ dir: tempDir() }),
    config,
  };
}

describe('runReview — happy path', () => {
  it('resolves repo/PR/agent, starts the review, waits for completion, and returns the finished review', async () => {
    const fakeApi = createFakeApi({ runStatuses: ['running', 'done'] });
    const deps = buildDeps(fakeApi, testConfig());

    const outcome = await runReview(deps, { repo: 'acme/api', pr: 482, agentId: 'General' });

    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') {
      throw new Error('expected status "done"');
    }
    expect(outcome.runId).toBe(RUN_ID);
    expect(outcome.prId).toBe(PR_482_ID);
    expect(outcome.repo).toBe('acme/api');
    expect(outcome.pr).toBe(482);
    expect(outcome.agentId).toBe(AGENT_GENERAL_ID);
    expect(outcome.agentName).toBe('General');
    expect(outcome.review.run_id).toBe(RUN_ID);
    expect(outcome.review.findings).toHaveLength(47);
  });

  it('resolves an agent by name (not just id)', async () => {
    const fakeApi = createFakeApi({ runStatuses: ['done'] });
    const deps = buildDeps(fakeApi, testConfig());

    const outcome = await runReview(deps, { repo: 'acme/api', pr: 482, agentId: 'general' });

    expect(outcome.status).toBe('done');
  });
});

describe('runReview — budget exhausted', () => {
  it('returns status "running" with a usable run_id, and records runIndex.put BEFORE the wait loop starts', async () => {
    const fakeApi = createFakeApi({ runStatuses: ['running'] }); // never reaches a terminal status
    const baseRunIndex = createRunIndex({ dir: tempDir() });
    const putCallOrder: number[] = [];
    const runIndex: RunIndex = {
      put(entry: RunIndexEntry) {
        // Records how many HTTP calls had happened by the time put() ran —
        // if put() runs before the wait loop's first poll, this is the same
        // count as immediately after startReview (1 call: the POST).
        putCallOrder.push(fakeApi.calls.length);
        baseRunIndex.put(entry);
      },
      get: (runId) => baseRunIndex.get(runId),
      size: () => baseRunIndex.size(),
    };
    const config = testConfig({ runTimeoutMs: 30, pollIntervalMs: 5 });
    const deps = buildDeps(fakeApi, config, runIndex);

    const outcome = await runReview(deps, { repo: 'acme/api', pr: 482, agentId: 'General' });

    expect(outcome.status).toBe('running');
    if (outcome.status !== 'running') {
      throw new Error('expected status "running"');
    }
    expect(outcome.runId).toBe(RUN_ID);
    expect(outcome.repo).toBe('acme/api');
    expect(outcome.pr).toBe(482);
    expect(outcome.agentId).toBe(AGENT_GENERAL_ID);
    expect(outcome.agentName).toBe('General');
    expect(outcome.elapsedS).toBeGreaterThanOrEqual(0);

    // The run_id is usable — the run index already has PR context for it,
    // even though the wait itself never reached a terminal status.
    expect(baseRunIndex.get(RUN_ID)?.pr_id).toBe(PR_482_ID);

    // Ordering: put() must have happened before the first `/pulls/:id/runs`
    // poll, i.e. at or before the call count observed right after the
    // POST /pulls/:id/review that starts the run.
    expect(putCallOrder).toHaveLength(1);
    const firstRunsPollIndex = fakeApi.calls.findIndex((call) => /\/pulls\/.+\/runs$/.test(call.path));
    expect(firstRunsPollIndex).toBeGreaterThanOrEqual(0);
    expect(putCallOrder[0]).toBeLessThanOrEqual(firstRunsPollIndex);
  });
});

describe('runReview — failed outcomes', () => {
  it('unknown_repo', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi, testConfig());

    const outcome = await runReview(deps, { repo: 'acme/missing', pr: 482, agentId: 'General' });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('unknown_repo');
    expect(outcome.text).toContain('is not in DevDigest');
  });

  it('unknown_pr (unmatched number)', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi, testConfig());

    const outcome = await runReview(deps, { repo: 'acme/api', pr: 9999, agentId: 'General' });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('unknown_pr');
    expect(outcome.text).toContain('was not found in');
  });

  it('unknown_pr (a PR with a nullish id — not importable yet)', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi, testConfig());

    const outcome = await runReview(deps, {
      repo: 'acme/api',
      pr: PR_480_NUMBER,
      agentId: 'General',
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('unknown_pr');
  });

  it('unknown_agent', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi, testConfig());

    const outcome = await runReview(deps, { repo: 'acme/api', pr: 482, agentId: 'NoSuchAgent' });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('unknown_agent');
    expect(outcome.text).toContain('devdigest_list_agents');
  });

  it('agent_disabled', async () => {
    const fakeApi = createFakeApi();
    const deps = buildDeps(fakeApi, testConfig());

    const outcome = await runReview(deps, { repo: 'acme/api', pr: 482, agentId: 'Legacy' });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('agent_disabled');
    expect(outcome.text).toContain('is disabled in DevDigest');
  });

  it('rate_limited (429 on POST /pulls/:id/review)', async () => {
    const fakeApi = createFakeApi();
    const config = testConfig();
    const rateLimitedFetch: typeof fetch = async (input, init) => {
      const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && /^\/pulls\/.+\/review$/.test(url.pathname)) {
        return new Response(JSON.stringify({ statusCode: 429, error: 'Too Many Requests', message: 'slow down' }), {
          status: 429,
        });
      }
      return fakeApi.fetch(input, init);
    };
    const api = createApiClient({ config, fetch: rateLimitedFetch });
    const resolver = createResolver(api);
    const deps: ToolDeps = { api, resolver, runIndex: createRunIndex({ dir: tempDir() }), config };

    const outcome = await runReview(deps, { repo: 'acme/api', pr: 482, agentId: 'General' });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('rate_limited');
    expect(outcome.text).toContain('review runs per minute');
  });

  it('run_failed (the run reaches terminal status "failed")', async () => {
    const fakeApi = createFakeApi({ runStatuses: ['running', 'failed'] });
    const deps = buildDeps(fakeApi, testConfig());

    const outcome = await runReview(deps, { repo: 'acme/api', pr: 482, agentId: 'General' });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('run_failed');
    expect(outcome.text).toContain('LLM provider returned a 500');
  });

  it('no_review (the run finished but no review row matches its run_id)', async () => {
    const mismatchedReview: ReviewDto = {
      id: 'other-review-id',
      pr_id: PR_482_ID,
      agent_id: AGENT_GENERAL_ID,
      run_id: 'some-other-run-id',
      agent_name: 'General',
      kind: 'review',
      verdict: 'approve',
      summary: 'An unrelated review row.',
      score: 90,
      model: 'gpt-4.1',
      created_at: '2026-01-01T00:00:00.000Z',
      findings: [],
    };
    const fakeApi = createFakeApi({ runStatuses: ['done'], review: mismatchedReview });
    const deps = buildDeps(fakeApi, testConfig());

    const outcome = await runReview(deps, { repo: 'acme/api', pr: 482, agentId: 'General' });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('no_review');
    expect(outcome.text).toContain('produced no review');
  });

  it('api_unreachable (fetch itself fails)', async () => {
    const config = testConfig();
    const unreachableFetch: typeof fetch = async () => {
      throw new Error('fetch failed');
    };
    const api = createApiClient({ config, fetch: unreachableFetch });
    const resolver = createResolver(api);
    const deps: ToolDeps = { api, resolver, runIndex: createRunIndex({ dir: tempDir() }), config };

    const outcome = await runReview(deps, { repo: 'acme/api', pr: 482, agentId: 'General' });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('api_unreachable');
    expect(outcome.text).toContain('not reachable');
  });
});

describe('runReview — stays out of the presentation layer', () => {
  it('the source contains no JSON.stringify and no import from ./format.js or ../format.js', () => {
    const sourcePath = fileURLToPath(new URL('./run-review.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).not.toContain('JSON.stringify');
    expect(source).not.toMatch(/from\s+['"]\.{1,2}\/format\.js['"]/);
  });
});

/**
 * Hardening pass: `ToolErrorKind` (errors.ts) and `RunOutcomeFailedKind`
 * (run-review.ts) must never drift apart. Before this, `classify()` was the
 * ONLY link between an error builder's wording and the kind a caller
 * observed — rewording a builder's text silently broke classification with
 * no test failing. Now every throw site this task owns (`resolve.ts`) sets
 * `ToolError.kind` explicitly, and these two independently-declared unions
 * are asserted to stay in lockstep at both the type level and the runtime
 * level, so a value added to one without the other fails the suite instead
 * of drifting quietly.
 */
describe('ToolErrorKind / RunOutcomeFailedKind stay in sync', () => {
  it('runtime: TOOL_ERROR_KINDS and RUN_OUTCOME_FAILED_KINDS contain exactly the same values', () => {
    expect([...TOOL_ERROR_KINDS].sort()).toEqual([...RUN_OUTCOME_FAILED_KINDS].sort());
  });

  it('type-level: ToolErrorKind and RunOutcomeFailedKind are mutually assignable (compile-time check)', () => {
    // If either union ever gains or loses a member relative to the other,
    // one of these two assignments fails to typecheck — `npm run typecheck`
    // (and `tsc --noEmit` over test files) catches it even though this
    // assertion performs no runtime work.
    const toolKindAsOutcomeKind: RunOutcomeFailedKind[] = TOOL_ERROR_KINDS as unknown as ToolErrorKind[] as RunOutcomeFailedKind[];
    const outcomeKindAsToolKind: ToolErrorKind[] = RUN_OUTCOME_FAILED_KINDS as unknown as RunOutcomeFailedKind[] as ToolErrorKind[];

    expect(toolKindAsOutcomeKind.length).toBe(TOOL_ERROR_KINDS.length);
    expect(outcomeKindAsToolKind.length).toBe(RUN_OUTCOME_FAILED_KINDS.length);
  });

  it('every kind is produced by at least one throw/return site outside errors.ts\'s own declaration', () => {
    // Deliberately excludes errors.ts: TOOL_ERROR_KINDS's own declaration
    // would trivially contain every literal, which would prove nothing.
    // Each of these three files must independently reference the kind it
    // is responsible for producing.
    const resolveSrc = readFileSync(fileURLToPath(new URL('../resolve.ts', import.meta.url)), 'utf8');
    const runReviewSrc = readFileSync(fileURLToPath(new URL('./run-review.ts', import.meta.url)), 'utf8');
    const readFindingsSrc = readFileSync(fileURLToPath(new URL('./read-findings.ts', import.meta.url)), 'utf8');
    const combined = `${resolveSrc}\n${runReviewSrc}\n${readFindingsSrc}`;

    for (const kind of RUN_OUTCOME_FAILED_KINDS as readonly (RunOutcomeFailedKind | ToolErrorKind)[]) {
      expect(combined).toContain(`'${kind}'`);
    }
  });
});
