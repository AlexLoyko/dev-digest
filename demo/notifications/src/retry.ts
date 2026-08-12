/**
 * Retry helper — exponential backoff with jitter for transient transport
 * failures.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */
import { config } from './config.js';

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** Errors worth retrying: timeouts and 5xx, never a 4xx. */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as Error & { status?: number }).status;
  if (typeof status === 'number') return status >= 500 || status === 429;
  return /timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(err.message);
}

function delayFor(attempt: number, base: number, max: number): number {
  const exponential = Math.min(base * 2 ** attempt, max);
  // Full jitter: spreads a thundering herd of retries across the window.
  return Math.random() * exponential;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying transient failures with backoff.
 * A non-transient error is rethrown immediately — retrying a 400 just delays
 * the failure and multiplies the load.
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
