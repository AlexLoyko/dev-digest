/**
 * Smart Diff (L03) — group a PR's changed files into core / wiring / boilerplate
 * and order them so the files worth reading come first.
 *
 * PURE by design: this module takes rows and returns a `SmartDiff`. No container,
 * no DB, no I/O, no model call. Two consequences worth stating, because they are
 * the point rather than a side effect:
 *
 *   1. The grouping is available the instant a PR is imported — it needs only
 *      `path` / `additions` / `deletions`, which arrive with the PR itself. It
 *      does NOT wait for a review, an index, or a classification.
 *   2. It is cheap enough to recompute per request, so nothing is persisted and
 *      there is no cache to invalidate when findings change.
 *
 * `finding_lines` fills in on its own once any agent review completes, because
 * it is derived from the findings already stored for the PR.
 *
 * See `specs/0003-smart-diff.md`.
 */
import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_RE,
  MAX_FINDING_LINE_SPAN,
  SPLIT_TOO_BIG_FILES,
  SPLIT_TOO_BIG_LINES,
  WIRING_RE,
} from './constants.js';

/** The order groups are emitted in — most-worth-reading first. */
const ROLE_ORDER = ['core', 'wiring', 'boilerplate'] as const satisfies readonly SmartDiffRole[];

/** Just the columns of `pr_files` this needs — never the patch. */
export interface SmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
}

/** Just the columns of `findings` this needs. */
export interface SmartDiffFindingInput {
  file: string;
  startLine: number | null;
  endLine: number | null;
}

/**
 * Classify one path. First match wins, and the ORDER is load-bearing:
 * `dist/index.ts` must be boilerplate, not wiring.
 */
export function classifyFile(path: string): SmartDiffRole {
  if (BOILERPLATE_RE.test(path)) return 'boilerplate';
  if (WIRING_RE.test(path)) return 'wiring';
  return 'core';
}

/**
 * The lines one finding marks: `startLine..endLine`, clamped.
 * A null `startLine` anchors to nothing and yields no lines.
 */
function linesFor(f: SmartDiffFindingInput): number[] {
  const start = f.startLine;
  if (start == null) return [];
  // An inverted or absent end collapses to the start line rather than producing
  // an empty span — a finding always marks at least the line it cites.
  const rawEnd = f.endLine == null || f.endLine < start ? start : f.endLine;
  const end = Math.min(rawEnd, start + MAX_FINDING_LINE_SPAN - 1);
  const out: number[] = [];
  for (let n = start; n <= end; n++) out.push(n);
  return out;
}

/** path → sorted, deduped finding lines. */
function findingLinesByPath(findings: SmartDiffFindingInput[]): Map<string, number[]> {
  const acc = new Map<string, Set<number>>();
  for (const f of findings) {
    const lines = linesFor(f);
    if (lines.length === 0) continue;
    let set = acc.get(f.file);
    if (!set) acc.set(f.file, (set = new Set<number>()));
    for (const n of lines) set.add(n);
  }
  return new Map([...acc].map(([path, set]) => [path, [...set].sort((a, b) => a - b)]));
}

/**
 * Reviewer order within a group: what carries findings first, then the biggest
 * change, then path. The path tiebreak is what makes the response deterministic
 * for a given input — and therefore assertable in a test.
 */
function byReviewValue(a: SmartDiffFile, b: SmartDiffFile): number {
  const byFindings = b.finding_lines.length - a.finding_lines.length;
  if (byFindings !== 0) return byFindings;
  const bySize = b.additions + b.deletions - (a.additions + a.deletions);
  if (bySize !== 0) return bySize;
  return a.path.localeCompare(b.path);
}

export function buildSmartDiff(
  files: SmartDiffFileInput[],
  findings: SmartDiffFindingInput[],
): SmartDiff {
  const linesByPath = findingLinesByPath(findings);

  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  let totalLines = 0;

  for (const f of files) {
    totalLines += f.additions + f.deletions;
    const role = classifyFile(f.path);
    const entry: SmartDiffFile = {
      path: f.path,
      // Always explicit: a per-file "what this does" line needs a model, which
      // would defeat the available-on-import property above. See the spec.
      pseudocode_summary: null,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines: linesByPath.get(f.path) ?? [],
    };
    const bucket = byRole.get(role);
    if (bucket) bucket.push(entry);
    else byRole.set(role, [entry]);
  }

  // Fixed role order; a role with no changed files is omitted, not emitted empty.
  const groups: SmartDiffGroup[] = [];
  for (const role of ROLE_ORDER) {
    const bucket = byRole.get(role);
    if (!bucket || bucket.length === 0) continue;
    groups.push({ role, files: bucket.sort(byReviewValue) });
  }

  const tooBig = totalLines > SPLIT_TOO_BIG_LINES || files.length > SPLIT_TOO_BIG_FILES;

  return {
    groups,
    split_suggestion: {
      too_big: tooBig,
      total_lines: totalLines,
      proposed_splits: tooBig
        ? groups.map((g) => ({ name: g.role, files: g.files.map((f) => f.path) }))
        : [],
    },
  };
}
