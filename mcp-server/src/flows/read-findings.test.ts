import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApiClient } from '../api-client.js';
import type { ReviewDto } from '../api-client.js';
import { createRunIndex, type RunIndex, type RunIndexEntry } from '../run-index.js';
import type { McpConfig } from '../config.js';
import type { ToolDeps } from '../tools/types.js';
import { AGENT_GENERAL_ID, PR_482_ID, RUN_ID, createFakeApi } from '../../test/fake-api.js';
import { readFindings } from './read-findings.js';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'mcp-read-findings-test-'));
}

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

function seedEntry(runIndex: RunIndex, overrides: Partial<RunIndexEntry> = {}): void {
  runIndex.put({
    run_id: RUN_ID,
    pr_id: PR_482_ID,
    repo: 'acme/api',
    pr: 482,
    agent_id: AGENT_GENERAL_ID,
    agent_name: 'General',
    started_at: Date.now(),
    ...overrides,
  });
}

function buildDeps(fakeApi: ReturnType<typeof createFakeApi>, runIndex: RunIndex): ToolDeps {
  const config = testConfig();
  const api = createApiClient({ config, fetch: fakeApi.fetch });
  return { api, resolver: undefined, runIndex, config };
}

describe('readFindings', () => {
  it('unknown run_id -> failed, unknown_run, text names devdigest_run_agent_on_pr (R6)', async () => {
    const fakeApi = createFakeApi();
    const runIndex = createRunIndex({ dir: tempDir() });
    const deps = buildDeps(fakeApi, runIndex);

    const outcome = await readFindings(deps, { runId: 'never-started' });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('unknown_run');
    expect(outcome.text).toContain('devdigest_run_agent_on_pr');
  });

  it('still running -> status "running" with the recorded PR context', async () => {
    const fakeApi = createFakeApi({ runStatuses: ['running'] });
    const runIndex = createRunIndex({ dir: tempDir() });
    seedEntry(runIndex);
    const deps = buildDeps(fakeApi, runIndex);

    const outcome = await readFindings(deps, { runId: RUN_ID });

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
  });

  it('run failed -> failed, run_failed, carries run.error', async () => {
    const fakeApi = createFakeApi({ runStatuses: ['failed'] });
    const runIndex = createRunIndex({ dir: tempDir() });
    seedEntry(runIndex);
    const deps = buildDeps(fakeApi, runIndex);

    const outcome = await readFindings(deps, { runId: RUN_ID });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('run_failed');
    expect(outcome.text).toContain('LLM provider returned a 500');
  });

  it('run cancelled -> failed, run_failed', async () => {
    const fakeApi = createFakeApi({ runStatuses: ['cancelled'] });
    const runIndex = createRunIndex({ dir: tempDir() });
    seedEntry(runIndex);
    const deps = buildDeps(fakeApi, runIndex);

    const outcome = await readFindings(deps, { runId: RUN_ID });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('run_failed');
  });

  it('done -> status "done" with the review matched on run_id', async () => {
    const fakeApi = createFakeApi({ runStatuses: ['done'] });
    const runIndex = createRunIndex({ dir: tempDir() });
    seedEntry(runIndex);
    const deps = buildDeps(fakeApi, runIndex);

    const outcome = await readFindings(deps, { runId: RUN_ID });

    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done') {
      throw new Error('expected status "done"');
    }
    expect(outcome.runId).toBe(RUN_ID);
    expect(outcome.prId).toBe(PR_482_ID);
    expect(outcome.repo).toBe('acme/api');
    expect(outcome.pr).toBe(482);
    expect(outcome.review.run_id).toBe(RUN_ID);
    expect(outcome.review.findings).toHaveLength(47);
  });

  it('done but no review row matches run_id -> failed, no_review', async () => {
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
    const runIndex = createRunIndex({ dir: tempDir() });
    seedEntry(runIndex);
    const deps = buildDeps(fakeApi, runIndex);

    const outcome = await readFindings(deps, { runId: RUN_ID });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') {
      throw new Error('expected status "failed"');
    }
    expect(outcome.kind).toBe('no_review');
    expect(outcome.text).toContain('produced no review');
  });
});
