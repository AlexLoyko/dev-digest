/**
 * Bounded, injectable-clock polling wait for a DevDigest review run to reach
 * a terminal status.
 *
 * `runReview()` (`server/src/modules/reviews/service.ts:103`) is
 * fire-and-forget: `POST /pulls/:id/review` returns immediately and the
 * review executes in the background, publishing on an in-memory `runBus`.
 * This module deliberately polls `GET /pulls/:prId/runs` instead of
 * consuming that bus over SSE — see the L04 plan's "Wait strategy: polling,
 * not SSE (decision + justification)" section. In short: polling is
 * hermetically testable with a stubbed `fetch`, the DB row is the actual
 * source of truth (`status`/`error`/`score`), and it survives the documented
 * "RunBus is in-memory — server restart drops all streams" hole because a
 * reaped `failed`/`cancelled` row is simply the next poll's terminal result.
 *
 * Timing out is a normal, expected outcome (R5) — this function NEVER
 * throws on budget exhaustion. The caller (a `src/flows/*` use-case) turns
 * `{ outcome: "timeout" }` into a non-error `{ status: "running", run_id,
 * next_step }` tool response.
 *
 * Two further failure modes are absorbed the same way — as returned
 * outcomes, never thrown exceptions — because this loop runs for up to four
 * minutes against a local dev server the user may be restarting mid-wait:
 *
 * 1. **Transient poll failure.** A single `api.listRuns()` rejection (a
 *    network blip) does not end the wait — it is retried, up to 3
 *    *consecutive* failures, before becoming an `'error'` outcome. Any
 *    successful poll in between resets the counter to zero. Retries consume
 *    wall-clock time exactly like a normal poll (same backoff interval,
 *    same budget check) — they never extend the deadline.
 * 2. **`run_id` absent from the list.** The call can succeed while simply
 *    not containing `runId` (e.g. a row not yet committed, or dropped by a
 *    concurrent reap). If that persists for 3 *consecutive* polls, the wait
 *    gives up with an `'error'` outcome rather than silently spinning to the
 *    full timeout.
 */
import type { RunSummary } from '@devdigest/shared';
import type { ApiClient } from './api-client.js';
import { apiUnreachable, runVanished } from './errors.js';

/** After this many elapsed ms, the poll interval backs off from `pollMs` to `BACKOFF_INTERVAL_MS`. */
const BACKOFF_THRESHOLD_MS = 60_000;

/** Poll interval used once `BACKOFF_THRESHOLD_MS` of elapsed wait time has passed. */
const BACKOFF_INTERVAL_MS = 5_000;

/** Consecutive `api.listRuns()` rejections tolerated before giving up with an `'error'` outcome. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Consecutive successful polls in which `runId` is missing from the list, tolerated before giving up. */
const MAX_CONSECUTIVE_MISSING = 3;

/**
 * The only statuses that end the wait. Everything else — `"running"`, `null`
 * (not yet started/unknown), or any other string a future server version
 * might introduce — is treated as still-running rather than thrown on,
 * because `RunSummary.status` (`@devdigest/shared`) is typed `string | null`,
 * not an enum.
 */
const TERMINAL_STATUSES = new Set<string>(['done', 'failed', 'cancelled']);

export type WaitOutcome = 'done' | 'failed' | 'cancelled' | 'timeout' | 'error';

export interface WaitForRunResult {
  outcome: WaitOutcome;
  /** The last `RunSummary` seen for `runId`, if any was ever found in the list. */
  run?: RunSummary;
  elapsedMs: number;
  /**
   * Present only when `outcome === 'error'` — an actionable-where-possible
   * reason the wait gave up before a terminal status or the budget.
   *
   * For 3 consecutive transient poll failures this reuses `apiUnreachable()`
   * from `errors.ts`: repeated `api.listRuns()` rejections and an
   * unreachable API produce the exact same signal from this loop's point of
   * view, and that builder already names the concrete next step
   * (`./scripts/dev.sh`).
   *
   * For `runId` absent from the list for 3 consecutive *successful* polls,
   * no existing `errors.ts` builder fits: `unknownRunId()` is worded for a
   * run this server never started at all, and `noReviewForRun()` implies
   * the run finished — neither is true here (the run just isn't showing up
   * in the listing). Rather than invent a new error-message family inside
   * this orchestration-layer module, the text stays a minimal, factual
   * statement of what was observed.
   */
  error?: string;
}

export interface WaitForRunParams {
  api: Pick<ApiClient, 'listRuns'>;
  prId: string;
  runId: string;
  /** Total wait budget in ms (`McpConfig.runTimeoutMs`, default 240000). */
  budgetMs: number;
  /** Poll interval in ms for the first 60s of elapsed wait time (`McpConfig.pollIntervalMs`, default 2000). */
  pollMs: number;
  /** Injected clock — tests fake this so the whole budget can be exercised in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /** Injected sleep — tests fake this so no real waiting happens. Defaults to a real `setTimeout`-backed sleep. */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `GET /pulls/:prId/runs` (via `api.listRuns`) and matches the
 * `RunSummary` whose `run_id === runId`, until that run reaches a terminal
 * status or the budget is exhausted.
 *
 * The budget check happens BEFORE each poll (not after) — this is what caps
 * the total request count for a full `budgetMs` (default 240s) wait at
 * exactly 66: ~30 requests at the `pollMs` (2s) interval for the first 60s,
 * then ~36 more at the 5s backoff interval for the remaining 180s, safely
 * under the API's global 120/min rate limit (see `wait.test.ts`'s
 * request-count assertion and the plan's "Cost is negligible" note).
 */
export async function waitForRun(params: WaitForRunParams): Promise<WaitForRunResult> {
  const { api, prId, runId, budgetMs, pollMs, now = Date.now, sleep = defaultSleep } = params;
  const start = now();
  let lastRun: RunSummary | undefined;
  let consecutiveFailures = 0;
  let consecutiveMissing = 0;

  for (;;) {
    const elapsed = now() - start;
    if (elapsed >= budgetMs) {
      return { outcome: 'timeout', run: lastRun, elapsedMs: elapsed };
    }

    let runs: RunSummary[];
    try {
      runs = await api.listRuns(prId);
    } catch {
      // Transient poll failure (network blip). Retried up to
      // MAX_CONSECUTIVE_FAILURES times — the budget still governs, so the
      // retry falls through to the same backoff sleep as a normal poll
      // rather than getting a free pass on the deadline.
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        return { outcome: 'error', run: lastRun, elapsedMs: elapsed, error: apiUnreachable() };
      }
      const retryInterval = elapsed < BACKOFF_THRESHOLD_MS ? pollMs : BACKOFF_INTERVAL_MS;
      await sleep(Math.min(retryInterval, budgetMs - elapsed));
      continue;
    }
    consecutiveFailures = 0;

    const run = runs.find((candidate) => candidate.run_id === runId);
    if (run) {
      consecutiveMissing = 0;
      lastRun = run;
    } else {
      // The call succeeded but simply doesn't contain runId — distinct from
      // a poll failure above. Tracked with its own consecutive counter so a
      // single missed listing (e.g. a row not yet committed) doesn't end
      // the wait, but a persistent absence does rather than spinning silently
      // to the full timeout.
      consecutiveMissing += 1;
      if (consecutiveMissing >= MAX_CONSECUTIVE_MISSING) {
        return {
          outcome: 'error',
          run: lastRun,
          elapsedMs: elapsed,
          error: runVanished(runId, prId),
        };
      }
    }

    const status = run?.status;
    if (status && TERMINAL_STATUSES.has(status)) {
      return { outcome: status as WaitOutcome, run, elapsedMs: elapsed };
    }

    const interval = elapsed < BACKOFF_THRESHOLD_MS ? pollMs : BACKOFF_INTERVAL_MS;
    await sleep(Math.min(interval, budgetMs - elapsed));
  }
}
