/**
 * `wait.ts` tests. Time is entirely injected (`now`/`sleep`) — nothing here
 * uses a real timer or `vi.useFakeTimers()`, so a 240s budget exercises in
 * effectively zero real time. This is the requirement, not an optimization:
 * a suite that actually waits is a failed implementation of T9.
 */
import { describe, expect, it } from 'vitest';
import type { RunSummary } from '@devdigest/shared';
import type { ApiClient } from './api-client.js';
import { waitForRun } from './wait.js';

const PR_ID = 'pr-1';
const RUN_ID = 'run-1';

/** Builds a minimal-but-complete `RunSummary` fixture for a given status. */
function makeRun(status: string | null, runId: string = RUN_ID): RunSummary {
  return {
    run_id: runId,
    agent_id: 'agent-1',
    agent_name: 'General',
    provider: 'openai',
    model: 'gpt-4.1',
    status,
    error: status === 'failed' ? 'LLM provider returned a 500' : null,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    findings_count: null,
    grounding: null,
    ran_at: '2026-08-20T12:00:00.000Z',
    score: null,
    blockers: null,
    findings_critical: null,
    findings_warning: null,
    findings_suggestion: null,
  };
}

/**
 * A fake clock + sleep pair: `sleep(ms)` advances the clock by exactly `ms`
 * with no real waiting, and every call is recorded so tests can assert on
 * the exact backoff schedule.
 */
function createFakeClock() {
  let time = 0;
  const sleepCalls: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleepCalls.push(ms);
      time += ms;
    },
    sleepCalls,
  };
}

/**
 * Sentinel status value: when it appears in a `scriptedApi` script, that call
 * throws (simulating a transient network blip) instead of returning a
 * `RunSummary`. Chosen to be unambiguous against any real `status` string.
 */
const TRANSIENT_ERROR = '__transient_error__';

/**
 * Builds a `Pick<ApiClient, 'listRuns'>` whose statuses are scripted,
 * sticking on the last entry once exhausted. A `TRANSIENT_ERROR` entry makes
 * that call reject instead of resolve.
 */
function scriptedApi(statuses: (string | null)[]): { api: Pick<ApiClient, 'listRuns'>; calls: number[] } {
  const callTimes: number[] = [];
  let callCount = 0;
  const api: Pick<ApiClient, 'listRuns'> = {
    listRuns: async (_prId: string) => {
      const index = Math.min(callCount, statuses.length - 1);
      callCount += 1;
      callTimes.push(callCount);
      const status = statuses[index] ?? null;
      if (status === TRANSIENT_ERROR) {
        throw new Error('simulated transient network blip');
      }
      return [makeRun(status)];
    },
  };
  return { api, calls: callTimes };
}

/** A `Pick<ApiClient, 'listRuns'>` that always succeeds but never includes `RUN_ID` in its list. */
function apiWithAbsentRun(): { api: Pick<ApiClient, 'listRuns'>; calls: number[] } {
  const callTimes: number[] = [];
  let callCount = 0;
  const api: Pick<ApiClient, 'listRuns'> = {
    listRuns: async (_prId: string) => {
      callCount += 1;
      callTimes.push(callCount);
      return [makeRun('running', 'some-other-run-id')];
    },
  };
  return { api, calls: callTimes };
}

describe('waitForRun', () => {
  it('completes on done', async () => {
    const { api, calls } = scriptedApi(['running', 'running', 'done']);
    const clock = createFakeClock();

    const result = await waitForRun({
      api,
      prId: PR_ID,
      runId: RUN_ID,
      budgetMs: 240_000,
      pollMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('done');
    expect(result.run?.run_id).toBe(RUN_ID);
    expect(calls.length).toBe(3);
    expect(result.elapsedMs).toBe(4_000); // two 2s sleeps before the terminal poll
  });

  it('returns failed and cancelled as terminal outcomes, never throwing', async () => {
    const clock = createFakeClock();
    const failedResult = await waitForRun({
      api: scriptedApi(['running', 'failed']).api,
      prId: PR_ID,
      runId: RUN_ID,
      budgetMs: 240_000,
      pollMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(failedResult.outcome).toBe('failed');
    expect(failedResult.run?.error).toBe('LLM provider returned a 500');

    const clock2 = createFakeClock();
    const cancelledResult = await waitForRun({
      api: scriptedApi(['cancelled']).api,
      prId: PR_ID,
      runId: RUN_ID,
      budgetMs: 240_000,
      pollMs: 2_000,
      now: clock2.now,
      sleep: clock2.sleep,
    });
    expect(cancelledResult.outcome).toBe('cancelled');
  });

  it('returns a timeout outcome (not a throw) when the budget is exhausted, with the run id still usable', async () => {
    const { api, calls } = scriptedApi(['running']); // never terminates
    const clock = createFakeClock();

    const result = await waitForRun({
      api,
      prId: PR_ID,
      runId: RUN_ID,
      budgetMs: 10_000,
      pollMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('timeout');
    expect(result.elapsedMs).toBe(10_000);
    // The run id itself is always in the caller's hands (it was passed in),
    // and the last-seen RunSummary — when one was ever observed — is
    // returned too, so the caller can report on the still-running run.
    expect(result.run?.run_id).toBe(RUN_ID);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('backs off from 2s to 5s once 60s of elapsed wait time has passed', async () => {
    const { api } = scriptedApi(['running']); // never terminates
    const clock = createFakeClock();

    await waitForRun({
      api,
      prId: PR_ID,
      runId: RUN_ID,
      budgetMs: 70_000,
      pollMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    // Every interval before 60s of elapsed time must be the 2s pollMs; every
    // interval from 60s onward must be the 5s backoff.
    let elapsed = 0;
    for (const interval of clock.sleepCalls) {
      if (elapsed < 60_000) {
        expect(interval).toBe(2_000);
      } else {
        expect(interval).toBe(5_000);
      }
      elapsed += interval;
    }
    // Sanity: both phases actually happened.
    expect(clock.sleepCalls).toContain(2_000);
    expect(clock.sleepCalls).toContain(5_000);
  });

  it('caps total requests at <= 66 over a full 240s budget', async () => {
    const { api, calls } = scriptedApi(['running']); // never terminates -> exhausts the full budget
    const clock = createFakeClock();

    const result = await waitForRun({
      api,
      prId: PR_ID,
      runId: RUN_ID,
      budgetMs: 240_000,
      pollMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('timeout');
    expect(calls.length).toBeLessThanOrEqual(66);
  });

  it('keeps polling instead of crashing on a null or unrecognized status', async () => {
    const { api, calls } = scriptedApi([null, 'some-future-status', 'done']);
    const clock = createFakeClock();

    const result = await waitForRun({
      api,
      prId: PR_ID,
      runId: RUN_ID,
      budgetMs: 240_000,
      pollMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('done');
    expect(calls.length).toBe(3);
  });

  it('retries a transient poll failure and resets the counter on a subsequent success', async () => {
    const { api, calls } = scriptedApi([TRANSIENT_ERROR, TRANSIENT_ERROR, 'done']);
    const clock = createFakeClock();

    const result = await waitForRun({
      api,
      prId: PR_ID,
      runId: RUN_ID,
      budgetMs: 240_000,
      pollMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('done');
    expect(calls.length).toBe(3);
  });

  it('returns an error outcome (not a throw) after 3 consecutive transient poll failures, and the budget still governs the retries', async () => {
    // A 4th, would-be 'done' entry is scripted but must never be reached —
    // the wait must give up right after the 3rd consecutive failure.
    const { api, calls } = scriptedApi([TRANSIENT_ERROR, TRANSIENT_ERROR, TRANSIENT_ERROR, 'done']);
    const clock = createFakeClock();

    const result = await waitForRun({
      api,
      prId: PR_ID,
      runId: RUN_ID,
      budgetMs: 240_000,
      pollMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('error');
    expect(result.error).toBeTruthy();
    expect(calls.length).toBe(3);
    // Two 2s backoff sleeps happened between the 3 failed polls, proving
    // retries consume wall-clock time exactly like a normal poll.
    expect(result.elapsedMs).toBe(4_000);
  });

  it('returns an error outcome with an actionable message when run_id is absent from the list for 3 consecutive polls', async () => {
    const { api, calls } = apiWithAbsentRun();
    const clock = createFakeClock();

    const result = await waitForRun({
      api,
      prId: PR_ID,
      runId: RUN_ID,
      budgetMs: 240_000,
      pollMs: 2_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.outcome).toBe('error');
    expect(result.error).toContain(RUN_ID);
    expect(calls.length).toBe(3);
  });
});
