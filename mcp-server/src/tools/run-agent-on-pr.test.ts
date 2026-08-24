import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewDto, ReviewDtoFinding } from '../api-client.js';
import { loadConfig } from '../config.js';
import type { RunOutcome } from '../flows/run-review.js';
import type { ToolDeps } from './types.js';

/**
 * This task's whole point is that `run-agent-on-pr.ts` stays a thin,
 * three-step handler: parse input, call the ALREADY-TESTED `runReview()`
 * flow exactly once, map its `RunOutcome` through `ok()`/`fail()`. So this
 * suite stubs the flow module itself — never the fake HTTP API — per this
 * task's own instructions. End-to-end coverage against the fake API already
 * lives in `flows/run-review.test.ts`.
 */
vi.mock('../flows/run-review.js', () => ({
  runReview: vi.fn(),
}));

const { runReview } = await import('../flows/run-review.js');
const { runAgentOnPrTool } = await import('./run-agent-on-pr.js');

const mockedRunReview = vi.mocked(runReview);

const config = loadConfig({ DEVDIGEST_API_URL: 'http://127.0.0.1:3001' });

const deps: ToolDeps = {
  api: undefined,
  resolver: undefined,
  runIndex: undefined,
  config,
};

function makeFinding(overrides: Partial<ReviewDtoFinding> = {}): ReviewDtoFinding {
  return {
    id: 'f-1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'SQL injection',
    file: 'src/a.ts',
    start_line: 120,
    end_line: 134,
    rationale: 'User input reaches a raw query.',
    suggestion: 'Use a parameterized query.',
    confidence: 0.9,
    kind: 'finding',
    trifecta_components: null,
    evidence: null,
    review_id: 'review-1',
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function makeReview(overrides: Partial<ReviewDto> = {}): ReviewDto {
  return {
    id: 'review-1',
    pr_id: 'pr-uuid-1',
    agent_id: 'agent-uuid-1',
    run_id: 'run-123',
    agent_name: 'Security',
    kind: 'review',
    verdict: 'request_changes',
    summary: 'Found one critical issue.',
    score: 62,
    model: 'claude-test',
    created_at: '2026-08-23T00:00:00.000Z',
    findings: [makeFinding()],
    ...overrides,
  };
}

const EXACT_DESCRIPTION =
  'Review a GitHub pull request with a DevDigest agent and return the finished verdict and ' +
  'findings. Does the whole job in one call: starts the review, waits for it to finish, and ' +
  'collects the results — do not poll. Use for requests like "review PR 482", "check this PR ' +
  'for bugs or security problems before merge".';

beforeEach(() => {
  mockedRunReview.mockReset();
});

describe('devdigest_run_agent_on_pr — declaration', () => {
  it('carries the exact verbatim description and name', () => {
    expect(runAgentOnPrTool.name).toBe('devdigest_run_agent_on_pr');
    expect(runAgentOnPrTool.description).toBe(EXACT_DESCRIPTION);
  });

  it('declares the R15 annotations exactly — the only write tool', () => {
    expect(runAgentOnPrTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('declares a flat outputSchema with no nested $ref/$defs/oneOf', () => {
    const keys = Object.keys(runAgentOnPrTool.outputSchema);
    expect(keys).toEqual(
      expect.arrayContaining(['status', 'repo', 'pr', 'agent_id', 'agent_name', 'run_id']),
    );
  });

  it('stays a thin handler: never touches deps.api directly (calls the flow only)', () => {
    const source = readFileSync(fileURLToPath(new URL('./run-agent-on-pr.ts', import.meta.url)), 'utf8');
    expect(source).not.toContain('deps.api.');
  });
});

describe('devdigest_run_agent_on_pr — handler (stubbed flow)', () => {
  it('done: maps to ok() with status "done", echoing agent_id and agent_name, findings formatted', async () => {
    const outcome: RunOutcome = {
      status: 'done',
      runId: 'run-123',
      prId: 'pr-uuid-1',
      repo: 'acme/api',
      pr: 482,
      agentId: 'agent-uuid-1',
      agentName: 'Security',
      review: makeReview(),
    };
    mockedRunReview.mockResolvedValue(outcome);

    const result = await runAgentOnPrTool.handler(
      { repo: 'acme/api', pr: 482, agent_id: 'Security', response_format: 'concise' },
      deps,
    );

    expect(mockedRunReview).toHaveBeenCalledTimes(1);
    expect(mockedRunReview).toHaveBeenCalledWith(deps, {
      repo: 'acme/api',
      pr: 482,
      agentId: 'Security',
    });

    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload.status).toBe('done');
    expect(payload.repo).toBe('acme/api');
    expect(payload.pr).toBe(482);
    expect(payload.agent_id).toBe('agent-uuid-1');
    expect(payload.agent_name).toBe('Security');
    expect(payload.run_id).toBe('run-123');
    expect(payload.verdict).toBe('request_changes');
    expect(payload.score).toBe(62);
    expect(payload.findings_total).toBe(1);

    // TextContent block mirrors structuredContent exactly.
    const textBlock = result.content[0] as { type: string; text: string };
    expect(JSON.parse(textBlock.text)).toEqual(payload);
  });

  it('concise vs detailed field sets differ on the done envelope', async () => {
    const outcome: RunOutcome = {
      status: 'done',
      runId: 'run-123',
      prId: 'pr-uuid-1',
      repo: 'acme/api',
      pr: 482,
      agentId: 'agent-uuid-1',
      agentName: 'Security',
      review: makeReview(),
    };
    mockedRunReview.mockResolvedValue(outcome);

    const concise = await runAgentOnPrTool.handler(
      { repo: 'acme/api', pr: 482, agent_id: 'Security', response_format: 'concise' },
      deps,
    );
    const conciseFindings = (concise.structuredContent as { findings: Record<string, unknown>[] })
      .findings;
    expect(conciseFindings[0]).not.toHaveProperty('why');
    expect(conciseFindings[0]).not.toHaveProperty('fix');
    expect(conciseFindings[0]).not.toHaveProperty('id');
    expect(conciseFindings[0]).not.toHaveProperty('confidence');

    const detailed = await runAgentOnPrTool.handler(
      { repo: 'acme/api', pr: 482, agent_id: 'Security', response_format: 'detailed' },
      deps,
    );
    const detailedFindings = (detailed.structuredContent as { findings: Record<string, unknown>[] })
      .findings;
    expect(detailedFindings[0]).toHaveProperty('why');
    expect(detailedFindings[0]).toHaveProperty('fix');
    expect(detailedFindings[0]).toHaveProperty('id');
    expect(detailedFindings[0]).toHaveProperty('confidence');
  });

  it('running (budget exhausted): non-error — R5 regression test', async () => {
    const outcome: RunOutcome = {
      status: 'running',
      runId: 'run-456',
      repo: 'acme/api',
      pr: 482,
      agentId: 'agent-uuid-1',
      agentName: 'Security',
      elapsedS: 240,
    };
    mockedRunReview.mockResolvedValue(outcome);

    const result = await runAgentOnPrTool.handler(
      { repo: 'acme/api', pr: 482, agent_id: 'Security', response_format: 'concise' },
      deps,
    );

    // R5: a bounded-wait timeout is NOT an error.
    expect(result.isError).not.toBe(true);
    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload.status).toBe('running');
    expect(payload.run_id).toBe('run-456');
    expect(payload.elapsed_s).toBe(240);
    expect(payload.next_step).toContain('devdigest_get_findings');
    expect(payload.next_step).toContain('run_id="run-456"');
  });

  it('failed: maps to fail(outcome.text) — isError true, text passed through verbatim', async () => {
    const outcome: RunOutcome = {
      status: 'failed',
      kind: 'unknown_repo',
      text: 'Repository "x/y" is not in DevDigest. Known repositories: acme/api. Add it at http://localhost:3000/repos, then retry.',
    };
    mockedRunReview.mockResolvedValue(outcome);

    const result = await runAgentOnPrTool.handler(
      { repo: 'x/y', pr: 482, agent_id: 'Security', response_format: 'concise' },
      deps,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: outcome.text }]);
    expect(result.structuredContent).toBeUndefined();
  });

  it('interpolates the actual run_id into the truncated next_step on the done envelope', async () => {
    const manyFindings = Array.from({ length: 25 }, (_, i) =>
      makeFinding({ id: `f-${i}`, title: `Issue ${i}` }),
    );
    const outcome: RunOutcome = {
      status: 'done',
      runId: 'run-789',
      prId: 'pr-uuid-1',
      repo: 'acme/api',
      pr: 482,
      agentId: 'agent-uuid-1',
      agentName: 'Security',
      review: makeReview({ summary: 'Many issues found.', score: 40, findings: manyFindings }),
    };
    mockedRunReview.mockResolvedValue(outcome);

    const result = await runAgentOnPrTool.handler(
      { repo: 'acme/api', pr: 482, agent_id: 'Security', response_format: 'concise' },
      deps,
    );

    const payload = result.structuredContent as Record<string, unknown>;
    expect(payload.findings_total).toBe(25);
    expect(payload.findings_shown).toBe(20);
    expect(payload.next_step).toContain('run_id="run-789"');
    expect(payload.next_step).toContain('devdigest_get_findings');
  });
});
