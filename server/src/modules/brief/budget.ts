/**
 * budget.ts — token-budget shedding for PR Brief generation (AC-14, NFR-2).
 *
 * Onion layer: pure application helper (no I/O, no Container — takes a
 * `Tokenizer` port directly, mirroring `modules/repo-intel/pipeline/repo-map.ts`).
 *
 * `fitToBudget` measures the ACTUAL rendered prompt (via `buildBriefUserMessage`)
 * with `tokenizer.count()` — never a chars/4 heuristic — and, if it exceeds
 * `budget`, sheds inputs in a fixed order until it fits (R-3):
 *
 *   1. project-context documents (v1: always recorded as omitted, unconditionally)
 *   2. changed-file list — rank-ordered prefix (additions+deletions DESC), the
 *      largest fitting prefix found by BINARY SEARCH over prefix length, not
 *      one file at a time (NFR-2: ~13 `count()` calls for a 400-file PR, not 400 —
 *      see `repo-map.ts` for the identical technique)
 *   3. linked-issue body — sliced to `MAX_ISSUE_BODY_CHARS`, then dropped (title kept)
 *   4. blast detail — truncated, then the whole blast summary dropped
 *   5. PR description — sliced to `MAX_PR_DESCRIPTION_CHARS`, then to
 *      `PR_DESCRIPTION_HARD_TRUNCATE_CHARS`, then dropped
 *   6. intent — shed last; it anchors "why" (AC-1)
 *
 * NEVER shed: title, branch, base, author, state (`BriefPrMeta`'s structural
 * fields) or diff stats — those are rendered unconditionally by `prompt.ts`
 * and this module never touches them.
 *
 * Each shedding action that actually changes state appends exactly one
 * `BriefDegradation`. The measured token count of the FINAL candidate is
 * returned so the caller (T8's `service.ts`) can record `input_tokens_measured`
 * without re-measuring.
 */
import type { BriefDegradation } from '@devdigest/shared';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import { buildBriefUserMessage } from './prompt.js';
import type { BriefInputParts, BriefChangedFile } from './types.js';
import { MAX_ISSUE_BODY_CHARS, MAX_PR_DESCRIPTION_CHARS } from './constants.js';

/** Second-stage PR description truncation (after the `MAX_PR_DESCRIPTION_CHARS`
 *  cap `prompt.ts` already applies at render time) — local to this module
 *  since it is a budget-shedding detail, not a shared prompt constant. */
const PR_DESCRIPTION_HARD_TRUNCATE_CHARS = 1000;

/** Truncation length for the "blast detail" shedding step, before the whole
 *  blast summary is dropped. `BriefInputParts.blastSummary` is a single
 *  string (no separate "detail" sub-field), so this is the local constant
 *  that stands in for that intermediate reduction. */
const BLAST_SUMMARY_DETAIL_CHARS = 500;

export interface FitToBudgetResult {
  parts: BriefInputParts;
  degraded: BriefDegradation[];
  /** Measured (never estimated) token count of the final, possibly-shed
   *  candidate — feeds `BriefMeta.input_tokens_measured` / `tokens_in`. */
  tokens: number;
}

/** Measure the actual rendered prompt for `parts` — never a chars/4 heuristic. */
function measure(parts: BriefInputParts, tokenizer: Tokenizer): number {
  return tokenizer.count(buildBriefUserMessage(parts));
}

/**
 * Find the largest rank-ordered prefix of `sortedFiles` (already sorted
 * additions+deletions DESC) whose rendered candidate fits `budget`, via
 * binary search over prefix length — never testing one file at a time.
 */
function bestChangedFilesPrefix(
  base: BriefInputParts,
  sortedFiles: BriefChangedFile[],
  tokenizer: Tokenizer,
  budget: number,
): { prefixLen: number; tokens: number } {
  let lo = 0;
  let hi = sortedFiles.length;
  let bestLen = 0;
  let bestTokens = measure({ ...base, changedFiles: [] }, tokenizer);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tokens = measure({ ...base, changedFiles: sortedFiles.slice(0, mid) }, tokenizer);
    if (tokens <= budget) {
      bestLen = mid;
      bestTokens = tokens;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return { prefixLen: bestLen, tokens: bestTokens };
}

export function fitToBudget(
  parts: BriefInputParts,
  tokenizer: Tokenizer,
  budget: number,
): FitToBudgetResult {
  const degraded: BriefDegradation[] = [];
  let candidate = parts;

  // Step 1 (v1): project-context documents are always recorded as omitted,
  // unconditionally — the field is always `[]` in v1 anyway (see types.ts).
  degraded.push({ input: 'project_context', action: 'omitted' });
  candidate = { ...candidate, projectContextDocs: [] };

  let tokens = measure(candidate, tokenizer);
  if (tokens <= budget) {
    return { parts: candidate, degraded, tokens };
  }

  // Step 2: changed-file list — rank-ordered prefix via binary search.
  if (candidate.changedFiles.length > 0) {
    const sortedFiles = [...candidate.changedFiles].sort(
      (a, b) => b.additions + b.deletions - (a.additions + a.deletions),
    );
    const { prefixLen, tokens: prefixTokens } = bestChangedFilesPrefix(
      candidate,
      sortedFiles,
      tokenizer,
      budget,
    );
    // The full list already failed the check above, so a shed always occurs
    // here (prefixLen < sortedFiles.length).
    candidate = { ...candidate, changedFiles: sortedFiles.slice(0, prefixLen) };
    degraded.push({
      input: 'changed_files',
      action: prefixLen === 0 ? 'omitted' : 'reduced',
      detail: `kept ${prefixLen} of ${sortedFiles.length} changed file(s), ranked by lines changed`,
    });
    tokens = prefixTokens;
  }
  if (tokens <= budget) {
    return { parts: candidate, degraded, tokens };
  }

  // Step 3: linked-issue body — sliced, then dropped. Title always kept.
  if (candidate.linkedIssue?.body) {
    const title = candidate.linkedIssue.title;
    const body = candidate.linkedIssue.body;
    if (body.length > MAX_ISSUE_BODY_CHARS) {
      candidate = { ...candidate, linkedIssue: { title, body: body.slice(0, MAX_ISSUE_BODY_CHARS) } };
      degraded.push({
        input: 'linked_issue',
        action: 'reduced',
        detail: `body truncated to ${MAX_ISSUE_BODY_CHARS} chars`,
      });
      tokens = measure(candidate, tokenizer);
    }
    if (tokens > budget) {
      candidate = { ...candidate, linkedIssue: { title, body: null } };
      degraded.push({ input: 'linked_issue', action: 'omitted', detail: 'body dropped, title kept' });
      tokens = measure(candidate, tokenizer);
    }
  }
  if (tokens <= budget) {
    return { parts: candidate, degraded, tokens };
  }

  // Step 4: blast detail — truncated, then the whole summary dropped.
  if (candidate.blastSummary) {
    if (candidate.blastSummary.length > BLAST_SUMMARY_DETAIL_CHARS) {
      candidate = { ...candidate, blastSummary: candidate.blastSummary.slice(0, BLAST_SUMMARY_DETAIL_CHARS) };
      degraded.push({
        input: 'blast',
        action: 'reduced',
        detail: `truncated to ${BLAST_SUMMARY_DETAIL_CHARS} chars`,
      });
      tokens = measure(candidate, tokenizer);
    }
    if (tokens > budget) {
      candidate = { ...candidate, blastSummary: null };
      degraded.push({ input: 'blast', action: 'omitted' });
      tokens = measure(candidate, tokenizer);
    }
  }
  if (tokens <= budget) {
    return { parts: candidate, degraded, tokens };
  }

  // Step 5: PR description — sliced to MAX_PR_DESCRIPTION_CHARS, then to
  // PR_DESCRIPTION_HARD_TRUNCATE_CHARS, then dropped.
  if (candidate.pr.body) {
    let body = candidate.pr.body;
    if (body.length > MAX_PR_DESCRIPTION_CHARS) {
      body = body.slice(0, MAX_PR_DESCRIPTION_CHARS);
      candidate = { ...candidate, pr: { ...candidate.pr, body } };
      degraded.push({
        input: 'pr_description',
        action: 'reduced',
        detail: `truncated to ${MAX_PR_DESCRIPTION_CHARS} chars`,
      });
      tokens = measure(candidate, tokenizer);
    }
    if (tokens > budget && body.length > PR_DESCRIPTION_HARD_TRUNCATE_CHARS) {
      body = body.slice(0, PR_DESCRIPTION_HARD_TRUNCATE_CHARS);
      candidate = { ...candidate, pr: { ...candidate.pr, body } };
      degraded.push({
        input: 'pr_description',
        action: 'reduced',
        detail: `truncated to ${PR_DESCRIPTION_HARD_TRUNCATE_CHARS} chars`,
      });
      tokens = measure(candidate, tokenizer);
    }
    if (tokens > budget) {
      candidate = { ...candidate, pr: { ...candidate.pr, body: null } };
      degraded.push({ input: 'pr_description', action: 'omitted' });
      tokens = measure(candidate, tokenizer);
    }
  }
  if (tokens <= budget) {
    return { parts: candidate, degraded, tokens };
  }

  // Step 6: intent — shed last, it anchors "why" (AC-1).
  if (candidate.intent) {
    candidate = { ...candidate, intent: null };
    degraded.push({ input: 'intent', action: 'omitted' });
    tokens = measure(candidate, tokenizer);
  }

  return { parts: candidate, degraded, tokens };
}
