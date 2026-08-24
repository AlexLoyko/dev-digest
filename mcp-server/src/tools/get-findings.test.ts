import { describe, expect, it, vi } from 'vitest';
import type { Finding } from '@devdigest/shared';
import type { McpConfig } from '../config.js';
import type { ToolDeps } from './types.js';
import type { RunOutcome } from '../flows/run-review.js';

// Per T13's Action, this tool is a THIN handler over `readFindings()`
// (`flows/read-findings.ts`, T10b) — its own test therefore stubs the flow
// directly, rather than the fake API, so it exercises only the three-step
// mapping this file owns: parse input -> call the flow -> map the
// `RunOutcome` through ok()/fail(). End-to-end coverage against the fake API
// already lives in `flows/read-findings.test.ts`.
vi.mock('../flows/read-findings.js', () => ({
  readFindings: vi.fn(),
}));

const { readFindings } = await import('../flows/read-findings.js');
const { getFindingsTool } = await import('./get-findings.js');

function testConfig(): McpConfig {
  return {
    apiUrl: 'http://127.0.0.1:3001',
    runTimeoutMs: 5_000,
    pollIntervalMs: 5,
    maxFindings: 20,
    debug: undefined,
    apiToken: undefined,
  };
}

/** `deps.api` / `deps.resolver` / `deps.runIndex` are never touched by this handler — undefined proves it. */
function testDeps(): ToolDeps {
  return { api: undefined, resolver: undefined, runIndex: undefined, config: testConfig() };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Something looks off',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'Because reasons.',
    suggestion: null,
    confidence: 0.8,
    ...overrides,
  };
}

function mockOutcome(outcome: RunOutcome): void {
  vi.mocked(readFindings).mockResolvedValue(outcome);
}

const args = (overrides: Partial<{ run_id: string; severity: 'critical' | 'warning' | 'suggestion'; response_format: 'concise' | 'detailed' }> = {}) => ({
  run_id: 'run-1',
  response_format: 'concise' as const,
  ...overrides,
});

describe('devdigest_get_findings', () => {
  it('unknown run_id -> isError naming devdigest_run_agent_on_pr (R6)', async () => {
    mockOutcome({
      status: 'failed',
      kind: 'unknown_run',
      text:
        'Unknown run_id "run-1". This server only knows runs it started. ' +
        'Call devdigest_run_agent_on_pr(repo, pr, agent_id) to start a review — ' +
        'it returns a run_id and waits for the findings.',
    });

    const result = await getFindingsTool.handler(args(), testDeps());

    expect(result.isError).toBe(true);
    const text = (result.content?.[0] as { text: string }).text;
    expect(text).toContain('devdigest_run_agent_on_pr');
  });

  it('still running -> non-error, status "running", same run_id', async () => {
    mockOutcome({
      status: 'running',
      runId: 'run-1',
      repo: 'acme/api',
      pr: 482,
      agentId: 'agent-1',
      agentName: 'Security',
      elapsedS: 30,
    });

    const result = await getFindingsTool.handler(args(), testDeps());

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ status: 'running', run_id: 'run-1' });
    expect((result.structuredContent as { next_step: string }).next_step).toContain('devdigest_get_findings');
  });

  it('done -> returns verdict, score and findings', async () => {
    mockOutcome({
      status: 'done',
      runId: 'run-1',
      prId: 'pr-uuid',
      repo: 'acme/api',
      pr: 482,
      agentId: 'agent-1',
      agentName: 'Security',
      review: {
        run_id: 'run-1',
        verdict: 'request_changes',
        summary: 'Needs work.',
        score: 62,
        findings: [
          makeFinding({ id: 'f-1', severity: 'CRITICAL' }),
          makeFinding({ id: 'f-2', severity: 'WARNING' }),
          makeFinding({ id: 'f-3', severity: 'SUGGESTION' }),
        ],
      } as never,
    });

    const result = await getFindingsTool.handler(args(), testDeps());

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      status: string;
      run_id: string;
      agent_id: string;
      agent_name: string;
      findings_total: number;
      findings: unknown[];
    };
    expect(structured.status).toBe('done');
    expect(structured.run_id).toBe('run-1');
    expect(structured.agent_id).toBe('agent-1');
    expect(structured.agent_name).toBe('Security');
    expect(structured.findings_total).toBe(3);
    expect(structured.findings).toHaveLength(3);
  });

  it('severity filter narrows the findings count and echoes severity_filter', async () => {
    mockOutcome({
      status: 'done',
      runId: 'run-1',
      prId: 'pr-uuid',
      repo: 'acme/api',
      pr: 482,
      agentId: 'agent-1',
      agentName: 'Security',
      review: {
        run_id: 'run-1',
        verdict: 'request_changes',
        summary: 'Needs work.',
        score: 62,
        findings: [
          makeFinding({ id: 'f-1', severity: 'CRITICAL' }),
          makeFinding({ id: 'f-2', severity: 'WARNING' }),
          makeFinding({ id: 'f-3', severity: 'WARNING' }),
          makeFinding({ id: 'f-4', severity: 'SUGGESTION' }),
        ],
      } as never,
    });

    const result = await getFindingsTool.handler(args({ severity: 'warning' }), testDeps());

    const structured = result.structuredContent as {
      findings_total: number;
      severity_filter: string;
    };
    expect(structured.findings_total).toBe(2);
    expect(structured.severity_filter).toBe('warning');
  });

  it('truncated next_step interpolates the actual run_id', async () => {
    const findings = Array.from({ length: 25 }, (_, i) =>
      makeFinding({ id: `f-${i}`, severity: 'SUGGESTION' }),
    );
    mockOutcome({
      status: 'done',
      runId: 'run-xyz-789',
      prId: 'pr-uuid',
      repo: 'acme/api',
      pr: 482,
      agentId: 'agent-1',
      agentName: 'Security',
      review: {
        run_id: 'run-xyz-789',
        verdict: 'comment',
        summary: null,
        score: 80,
        findings,
      } as never,
    });

    const result = await getFindingsTool.handler(args({ run_id: 'run-xyz-789' }), testDeps());

    const structured = result.structuredContent as { next_step: string; findings_shown: number };
    expect(structured.findings_shown).toBe(20);
    expect(structured.next_step).toContain('run_id="run-xyz-789"');
  });
});
