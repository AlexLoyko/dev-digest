import { describe, it, expect, vi } from 'vitest';
import { SingleFlight } from '../src/modules/brief/single-flight.js';

/** A promise plus its externally-callable resolve/reject, for controlling
 *  exactly when an in-flight `run()` call settles. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleFlight', () => {
  it('coalesces concurrent calls for the same key into one fn invocation, all resolving identically', async () => {
    const sf = new SingleFlight();
    const d = deferred<{ value: number }>();
    const fn = vi.fn(() => d.promise);

    const calls = [
      sf.run('k', fn),
      sf.run('k', fn),
      sf.run('k', fn),
      sf.run('k', fn),
      sf.run('k', fn),
    ];

    expect(fn).toHaveBeenCalledTimes(1);

    const result = { value: 42 };
    d.resolve(result);

    const settled = await Promise.all(calls);
    for (const value of settled) {
      expect(value).toBe(result);
    }
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('releases the key after settling, so a subsequent call invokes fn again', async () => {
    const sf = new SingleFlight();
    const first = vi.fn(async () => 'first');
    const second = vi.fn(async () => 'second');

    await expect(sf.run('k', first)).resolves.toBe('first');
    expect(first).toHaveBeenCalledTimes(1);

    await expect(sf.run('k', second)).resolves.toBe('second');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('rejects all waiters when fn rejects, and releases the key afterward', async () => {
    const sf = new SingleFlight();
    const d = deferred<never>();
    const fn = vi.fn(() => d.promise);
    const err = new Error('boom');

    const calls = [sf.run('k', fn), sf.run('k', fn), sf.run('k', fn)];
    expect(fn).toHaveBeenCalledTimes(1);

    d.reject(err);

    for (const call of calls) {
      await expect(call).rejects.toBe(err);
    }

    // Key released after rejection: a sixth call for the same key runs fn again.
    const retry = vi.fn(async () => 'recovered');
    await expect(sf.run('k', retry)).resolves.toBe('recovered');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('does not coalesce calls for different keys', async () => {
    const sf = new SingleFlight();
    const fnA = vi.fn(async () => 'a');
    const fnB = vi.fn(async () => 'b');

    const [a, b] = await Promise.all([sf.run('a', fnA), sf.run('b', fnB)]);

    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });
});
