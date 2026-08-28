/**
 * constants.ts — Project Context module: discovery-scope constants.
 *
 * Traces to: NFR-2 — "Scale — discovery shall remain bounded on a large
 * repository, excluding dependency and build directories rather than
 * walking them."
 */

/**
 * Directory names that mark the root of a context-document subtree. Confirmed
 * with the user 2026-08-28: the discovery scope is the glob
 * `**\/{specs,docs,insights}/**\/*.md` — a directory named `specs`, `docs`,
 * or `insights` at ANY depth in the clone, with every `.md` file nested below
 * it (at any further depth) in scope. This is deliberately NOT anchored to
 * repo root — `src/specs/nested/a.md` is in scope with root `'specs'`.
 */
export const CONTEXT_ROOT_DIRS = ['specs', 'docs', 'insights'] as const;

export type ContextRoot = (typeof CONTEXT_ROOT_DIRS)[number];

const CONTEXT_ROOT_SET: ReadonlySet<string> = new Set(CONTEXT_ROOT_DIRS);

/**
 * The depth predicate for context-document discovery: true when `dirName`
 * (a single path segment, matched on basename — never a full path) names a
 * context-root directory. The walker applies this at every directory it
 * visits, so a match at any depth turns the predicate on for everything
 * nested below it (see scanner.ts's `activeRoot` propagation).
 */
export function isContextRootDir(dirName: string): dirName is ContextRoot {
  return CONTEXT_ROOT_SET.has(dirName);
}
