import { describe, it, expect } from 'vitest';
import { selectLatestCompletedRun, type AgentRunWithReview } from '../src/modules/brief/latest-run.js';

function run(partial: Partial<AgentRunWithReview>): AgentRunWithReview {
  return {
    run_id: 'run-1',
    ran_at: '2026-08-01T00:00:00Z',
    status: 'done',
    score: 80,
    cost_usd: 0.05,
    tokens_in: 1000,
    tokens_out: 200,
    findings_count: 3,
    blockers: 1,
    agent_name: 'Security Reviewer',
    verdict: 'approve',
    ...partial,
  };
}

describe('selectLatestCompletedRun', () => {
  it('returns null when the only row is a failed run (EC-5)', () => {
    const rows = [run({ status: 'failed', verdict: null, score: null, cost_usd: null })];

    expect(selectLatestCompletedRun(rows)).toBeNull();
  });

  it('returns null when the only row is a cancelled run (EC-5)', () => {
    const rows = [run({ status: 'cancelled', verdict: null })];

    expect(selectLatestCompletedRun(rows)).toBeNull();
  });

  it('returns null when a "done" row has no verdict', () => {
    const rows = [run({ status: 'done', verdict: null })];

    expect(selectLatestCompletedRun(rows)).toBeNull();
  });

  it('returns null when a "done" row has a corrupt/out-of-enum verdict', () => {
    const rows = [run({ status: 'done', verdict: 'garbage' })];

    expect(selectLatestCompletedRun(rows)).toBeNull();
  });

  it('picks the successful run out of one failed + one successful, regardless of order', () => {
    const failed = run({ run_id: 'run-failed', status: 'failed', verdict: null, ran_at: '2026-08-02T00:00:00Z' });
    const success = run({ run_id: 'run-success', status: 'done', verdict: 'request_changes', ran_at: '2026-08-01T00:00:00Z' });

    expect(selectLatestCompletedRun([failed, success])?.run_id).toBe('run-success');
    expect(selectLatestCompletedRun([success, failed])?.run_id).toBe('run-success');
  });

  it('picks the newer ran_at between two successful runs', () => {
    const older = run({ run_id: 'run-older', ran_at: '2026-08-01T00:00:00Z' });
    const newer = run({ run_id: 'run-newer', ran_at: '2026-08-05T00:00:00Z' });

    expect(selectLatestCompletedRun([older, newer])?.run_id).toBe('run-newer');
    expect(selectLatestCompletedRun([newer, older])?.run_id).toBe('run-newer');
  });

  it('never lets a failed run zero out score or cost on the winning result', () => {
    const failedNewer = run({
      run_id: 'run-failed',
      status: 'failed',
      verdict: null,
      score: null,
      cost_usd: null,
      ran_at: '2026-08-09T00:00:00Z',
    });
    const successOlder = run({
      run_id: 'run-success',
      status: 'done',
      verdict: 'comment',
      score: 92,
      cost_usd: 0.12,
      ran_at: '2026-08-01T00:00:00Z',
    });

    const result = selectLatestCompletedRun([failedNewer, successOlder]);

    expect(result?.run_id).toBe('run-success');
    expect(result?.score).toBe(92);
    expect(result?.cost_usd).toBe(0.12);
  });

  it('passes score/cost_usd/tokens_in/tokens_out through as null, never coerced to 0', () => {
    const rows = [
      run({
        score: null,
        cost_usd: null,
        tokens_in: null,
        tokens_out: null,
      }),
    ];

    const result = selectLatestCompletedRun(rows);

    expect(result).not.toBeNull();
    expect(result?.score).toBeNull();
    expect(result?.cost_usd).toBeNull();
    expect(result?.tokens_in).toBeNull();
    expect(result?.tokens_out).toBeNull();
  });

  it('returns null for an empty row set', () => {
    expect(selectLatestCompletedRun([])).toBeNull();
  });

  it('passes through findings_count, blockers, agent_name and verdict for the winning run', () => {
    const rows = [
      run({
        findings_count: 7,
        blockers: 2,
        agent_name: 'QA Bot',
        verdict: 'request_changes',
      }),
    ];

    const result = selectLatestCompletedRun(rows);

    expect(result).toEqual({
      run_id: 'run-1',
      verdict: 'request_changes',
      findings_count: 7,
      blockers: 2,
      score: 80,
      cost_usd: 0.05,
      tokens_in: 1000,
      tokens_out: 200,
      agent_name: 'QA Bot',
    });
  });
});
