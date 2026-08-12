import { MIN_CONFIDENCE, MIN_SUBSTRING_NEEDLE } from './constants.js';
import { isSafeRepoPath } from '../_shared/repo-path.js';

export { isSafeRepoPath } from '../_shared/repo-path.js';

/**
 * Evidence gate for convention candidates — the conventions analogue of
 * reviewer-core's citation-grounding gate (`grounding.ts`), same
 * `kept` / `dropped[{reason}]` shape.
 *
 * PURE and synchronous by design: it takes an already-populated
 * `Map<path, text>`, so the one disk-touching step (resolving a path the model
 * cited but we never sampled) happens in the service BEFORE this runs. That
 * keeps every rule here unit-testable without a filesystem.
 *
 * A candidate must clear three stages:
 *   1. the path is safe AND the file exists (present in the map)
 *   2. the cited snippet actually occurs in that file
 *   3. its real line span is recomputed from the match — the model's claimed
 *      line numbers are never trusted, only replaced
 */

export interface RawCandidate {
  category: string;
  rule: string;
  evidence_path: string;
  evidence_start_line: number;
  evidence_end_line: number;
  evidence_snippet: string;
  /** Distinct sampled files the model says FOLLOW the rule. */
  occurrences_seen: number;
  /** Sampled files the model says do it a DIFFERENT way. */
  counterexamples_seen: number;
  /** A sampled eslint/tsconfig/prettier config mechanically enforces it. */
  enforced_by_config: boolean;
  /** Consistency 0..1, model-scored against the rubric. */
  confidence: number;
}

export interface VerifiedCandidate extends RawCandidate {
  /** Recomputed from the snippet match, overriding whatever the model claimed. */
  evidence_start_line: number;
  evidence_end_line: number;
}

export type DropReason =
  | 'unsafe_path'
  | 'file_not_found'
  | 'snippet_not_found'
  | 'low_confidence'
  | 'duplicate_rule';

export interface VerifyResult {
  kept: VerifiedCandidate[];
  dropped: { rule: string; path: string; reason: DropReason }[];
}

/**
 * The consistency score, clamped to the model's OWN stated evidence.
 *
 * The model stays the scorer — this only ever lowers a score that contradicts
 * the counts it just wrote (claiming 1.0 while admitting 3 counterexamples).
 * Config-enforced rules are exempt: a lint rule holds repo-wide even if the
 * handful of sampled files happen to show exceptions.
 *
 * Never raises a score, so a model that scores itself harshly is left alone.
 */
export function consistencyScore(c: RawCandidate): number {
  const claimed = Number.isFinite(c.confidence) ? Math.min(1, Math.max(0, c.confidence)) : 0;
  if (c.enforced_by_config) return claimed;

  const following = Math.max(0, c.occurrences_seen);
  const observed = following + Math.max(0, c.counterexamples_seen);
  if (observed === 0) return claimed;

  return Math.min(claimed, following / observed);
}

/** Enough substance to be evidence: long enough, and carrying a real identifier. */
function isSpecificEnough(needle: string): boolean {
  return needle.length >= MIN_SUBSTRING_NEEDLE && /[A-Za-z0-9_]{3,}/.test(needle);
}

/** Trim + collapse internal whitespace, so indentation drift never fails a match. */
function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

/**
 * Locate `snippet` inside `fileText` and return its real 1-based line span.
 *
 * Matches on whitespace-normalized, blank-stripped lines on BOTH sides, so a
 * snippet that dropped a blank line or re-indented still grounds. Falls back to
 * a substring match for single-line snippets, which models often quote partially.
 */
export function findSnippetLines(
  fileText: string,
  snippet: string,
): { start: number; end: number } | null {
  const fileEntries = fileText
    .split('\n')
    .map((line, i) => ({ line: i + 1, norm: normalizeLine(line) }))
    .filter((e) => e.norm.length > 0);

  const snipLines = snippet
    .split('\n')
    .map(normalizeLine)
    .filter((l) => l.length > 0);

  if (snipLines.length === 0 || fileEntries.length === 0) return null;

  // A single trivial line is not evidence however it matches — `}` or `const`
  // occurs in almost any file, so a fabricated rule could ground itself on
  // noise. Multi-line snippets are specific enough by construction.
  if (snipLines.length === 1 && !isSpecificEnough(snipLines[0]!)) return null;

  for (let i = 0; i + snipLines.length <= fileEntries.length; i++) {
    let matched = true;
    for (let j = 0; j < snipLines.length; j++) {
      if (fileEntries[i + j]!.norm !== snipLines[j]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return { start: fileEntries[i]!.line, end: fileEntries[i + snipLines.length - 1]!.line };
    }
  }

  // Single-line snippets are often a partial quote of a longer line. Already
  // known specific enough by the guard above.
  if (snipLines.length === 1) {
    const hit = fileEntries.find((e) => e.norm.includes(snipLines[0]!));
    if (hit) return { start: hit.line, end: hit.line };
  }

  return null;
}

/**
 * Drop every candidate whose evidence cannot be proven against `files`.
 * `files` maps repo-relative path → full file text.
 */
export function verifyEvidence(
  candidates: RawCandidate[],
  files: Map<string, string>,
): VerifyResult {
  const kept: VerifiedCandidate[] = [];
  const dropped: VerifyResult['dropped'] = [];
  const seenRules = new Set<string>();

  for (const c of candidates) {
    const path = c.evidence_path;
    const drop = (reason: DropReason) => dropped.push({ rule: c.rule, path, reason });

    // Stage 1 — path safety, then existence. Order matters: an unsafe path is
    // never even looked up.
    if (!isSafeRepoPath(path)) {
      drop('unsafe_path');
      continue;
    }
    const text = files.get(path);
    if (text === undefined) {
      drop('file_not_found');
      continue;
    }

    // Stage 2 + 3 — the cited code must exist, and its real location wins.
    const span = findSnippetLines(text, c.evidence_snippet);
    if (!span) {
      drop('snippet_not_found');
      continue;
    }

    if (!(c.confidence >= MIN_CONFIDENCE)) {
      drop('low_confidence');
      continue;
    }

    const ruleKey = normalizeLine(c.rule).toLowerCase();
    if (seenRules.has(ruleKey)) {
      drop('duplicate_rule');
      continue;
    }
    seenRules.add(ruleKey);

    kept.push({ ...c, evidence_start_line: span.start, evidence_end_line: span.end });
  }

  return { kept, dropped };
}
