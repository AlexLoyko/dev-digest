import type { UnifiedDiff } from '@devdigest/shared';
import { MAX_DIGEST_FILES } from './constants.js';

/**
 * The code digest — source 4 of the classifier's exactly-four inputs (L03
 * plan §1, "Narrow the classifier inputs"): the changed-file list built from
 * hunk headers, path plus `+adds/-dels`. Nothing else — no hunk content, no
 * diff body, ever reaches the model. Always produced, never conditional.
 *
 * Bounded to `MAX_DIGEST_FILES` so a PR with an unbounded file count cannot
 * blow the prompt budget; the overflow is noted, not silently dropped.
 *
 * PURE: takes the `UnifiedDiff` the caller already loaded, does no I/O, and
 * never reads `diff.raw` (the full diff text) — only the per-file summary
 * fields (`path`/`additions`/`deletions`) that `UnifiedDiff.files` already
 * carries from the hunk headers.
 */
export function buildCodeDigest(diff: UnifiedDiff): string {
  const lines: string[] = ['Changed files:'];
  const files = diff.files.slice(0, MAX_DIGEST_FILES);
  for (const f of files) {
    lines.push(`+${f.additions}/-${f.deletions}  ${f.path}`);
  }

  const overflow = diff.files.length - files.length;
  if (overflow > 0) {
    lines.push(`… and ${overflow} more files`);
  }

  return lines.join('\n');
}
