/**
 * Single-flight coalescing for in-flight async work keyed by a string.
 *
 * IN-PROCESS ONLY. Backed by a plain `Map<string, Promise<T>>` held in this
 * process's memory — a server restart (or running more than one API
 * instance) drops all in-flight entries with no persistence and no
 * cross-process coordination. This is the same limitation `RunBus`
 * (server/src/platform/sse.ts) already has and `server/insights/gotchas.md`
 * already records ("RunBus is in-memory — server restart drops all
 * streams"). Do not treat this as a durable lock: it only prevents duplicate
 * concurrent work within a single running process.
 *
 * This is a NEW pattern in the codebase — there is no existing single-flight
 * primitive elsewhere to copy or extend. It exists because it is one of only
 * two spend controls the brief-generation spec claims (AC-8): while a
 * generation for a given PR state is in flight, a second call for that same
 * key must not start a second (paid) model call, and must instead resolve
 * with the result of the call already running. Treat this as
 * security-relevant (OWASP A06 — insecure design / missing spend control),
 * not a mere convenience de-duplication.
 */
export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * Run `fn()` for `key`, coalescing concurrent callers.
   *
   * If a call for `key` is already in flight, this returns the SAME promise
   * — `fn` is not invoked again, and all callers resolve/reject together
   * with the identical outcome. Once the in-flight call settles (resolves
   * OR rejects), the key is released so the next call for that key starts a
   * fresh `fn()` invocation. Releasing on rejection (not just on success) is
   * deliberate: a rejection must not permanently poison the key and block
   * all future generations for that PR state.
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = fn().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);
    return promise;
  }
}
