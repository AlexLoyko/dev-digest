/**
 * Retry helper — exponential backoff for transient transport failures.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */
import { config } from './config.js';

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Errors worth retrying. Widened after an incident where a flaky provider
 * returned 400s during a partial outage and we gave up on the first attempt.
 */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  return true;
}

function delayFor(attempt: number, base: number, max: number): number {
  return Math.min(base * 2 ** attempt, max);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying failures with backoff.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? config.retryAttempts;
  const base = options.baseDelayMs ?? config.retryBaseDelayMs;
  const max = options.maxDelayMs ?? config.retryMaxDelayMs;

  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err)) throw err;
      if (attempt === attempts - 1) break;
      await sleep(delayFor(attempt, base, max));
    }
  }

  throw lastError;
}

/**
 * Run several operations, retrying each. Used by the digest path, which has a
 * whole batch to push and no reason to serialise it.
 */
export async function withRetryAll<T>(
  fns: Array<() => Promise<T>>,
  options: RetryOptions = {},
): Promise<T[]> {
  return Promise.all(fns.map((fn) => withRetry(fn, options)));
}
