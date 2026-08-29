/**
 * constants.ts — Project Context module: discovery-scope constants and the
 * pure category-derivation rule.
 *
 * Traces to: NFR-2 — "Scale — discovery shall remain bounded on a large
 * repository, excluding dependency and build directories rather than
 * walking them." (plus, since 2026-08-28, every dot-prefixed directory —
 * see `scanner.ts`'s dot-directory rule.)
 * Traces to: AC-1 — every non-excluded `.md` file anywhere in the clone is a
 * candidate document, categorized by `deriveCategory` below.
 */

/**
 * Directory names that, as a path segment, mark a document as belonging to
 * that context-root subtree. Deliberately three names, NOT the five
 * `ContextRoot` category values below — `readme` and `other` are never
 * directory-name matches, only filename/fallback outcomes of
 * `deriveCategory`. Do not widen this array; a repo directory literally
 * named `readme/` or `other/` must not be treated as a category root.
 */
export const CONTEXT_ROOT_DIRS = ['specs', 'docs', 'insights'] as const;

type ContextRootDir = (typeof CONTEXT_ROOT_DIRS)[number];

const CONTEXT_ROOT_SET: ReadonlySet<string> = new Set(CONTEXT_ROOT_DIRS);

/**
 * The full set of category values a discovered context document can be
 * classified into (AC-1: "distinguishing at least docs, specs, insights,
 * and readme, with every other document falling into a residual
 * category"). Wider than `CONTEXT_ROOT_DIRS` on purpose — see that
 * constant's comment.
 */
export const CONTEXT_CATEGORIES = ['specs', 'docs', 'insights', 'readme', 'other'] as const;

export type ContextRoot = (typeof CONTEXT_CATEGORIES)[number];

/**
 * True when `dirName` (a single path segment, matched on basename — never a
 * full path) names one of the three matchable context-root directories.
 */
export function isContextRootDir(dirName: string): dirName is ContextRootDir {
  return CONTEXT_ROOT_SET.has(dirName);
}

/**
 * Derive a discovered document's category purely from its repo-relative
 * path (forward-slash separated, no leading slash, filename last). Pure —
 * no I/O, no filesystem access. Precedence:
 *
 *  1. Walk the path's directory segments outermost-first (repo root down to
 *     the file's immediate parent); the FIRST segment matching
 *     `CONTEXT_ROOT_DIRS` wins. This is the pre-existing "outermost wins"
 *     rule (previously `scanner.ts`'s `activeRoot` walk-state), now applied
 *     over the full path in one pass since there is no more walk-state to
 *     carry it.
 *  2. Else, if the filename (case-insensitive) is `readme.md` → `'readme'`.
 *  3. Else → `'other'`.
 */
export function deriveCategory(relPath: string): ContextRoot {
  const segments = relPath.split('/');
  const dirSegments = segments.slice(0, -1);
  for (const segment of dirSegments) {
    if (isContextRootDir(segment)) return segment;
  }
  const filename = segments[segments.length - 1] ?? '';
  if (filename.toLowerCase() === 'readme.md') return 'readme';
  return 'other';
}
