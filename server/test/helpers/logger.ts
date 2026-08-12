import { vi } from 'vitest';

/**
 * Capturing fake for the structural `Logger` services take (pino-compatible
 * `(obj, msg)`), so a test can assert on ONE log line by its message instead of
 * indexing into `mock.calls`.
 *
 * Declares its own logger shape rather than importing `Logger` from
 * `modules/intent/constants.ts` — the same deliberate duplication documented
 * there, so `reviews` tests can use this helper too.
 *
 * Hermetic: no DB import, so it stays out of the `.it.test.ts` lane.
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogCall {
  level: LogLevel;
  obj: Record<string, unknown>;
  msg?: string;
}

export interface FakeLogger {
  logger: Record<LogLevel, ReturnType<typeof vi.fn>>;
  calls: LogCall[];
  /** Every captured call whose message matches exactly. */
  byMessage(msg: string): LogCall[];
  /** Asserts exactly one call with that message and returns it. */
  only(msg: string): LogCall;
  /** All captured payloads as one JSON blob — for "did X leak into a log" assertions. */
  serialized(): string;
}

export function createFakeLogger(): FakeLogger {
  const calls: LogCall[] = [];

  const capture = (level: LogLevel) =>
    vi.fn((obj: unknown, msg?: string) => {
      calls.push({ level, obj: (obj ?? {}) as Record<string, unknown>, msg });
    });

  const byMessage = (msg: string) => calls.filter((c) => c.msg === msg);

  return {
    logger: { info: capture('info'), warn: capture('warn'), error: capture('error'), debug: capture('debug') },
    calls,
    byMessage,
    only(msg: string): LogCall {
      const found = byMessage(msg);
      if (found.length !== 1) {
        throw new Error(
          `expected exactly one "${msg}" log line, got ${found.length}. ` +
            `Captured messages: ${calls.map((c) => c.msg).join(', ') || '(none)'}`,
        );
      }
      return found[0]!;
    },
    serialized: () => JSON.stringify(calls),
  };
}
