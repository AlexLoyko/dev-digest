import type { PrBrief, Risk, ReviewFocusEntry } from '@devdigest/shared';

/**
 * Grounds a model-generated PR brief against the PR's actual changed-file
 * set (AC-5).
 *
 * The brief is produced by an LLM whose input includes attacker-influenceable
 * content (the PR title/description, commit messages, etc. — anything a PR
 * author controls). A crafted description could coax the model into
 * asserting a risk or review-focus entry against a file that was never
 * touched by the PR, e.g. to draw reviewer attention away from the files
 * that actually changed, or to fabricate a reference to a sensitive path
 * that merely sounds plausible. `groundBrief` treats `changedPaths` as the
 * only trustworthy source of truth for "is this file part of the diff?"
 * and drops anything the model asserted outside of it, so a hallucinated or
 * adversarially-steered file reference never reaches storage.
 *
 * NOT reviewer-core's `groundFindings()` — that gate checks quoted evidence
 * inside a review run. This is a changed-path membership check scoped to
 * the PR brief, and must not import from reviewer-core.
 *
 * Pure: no I/O, no Container, no LLM calls.
 */

export interface GroundingDrop {
  kind: 'risk_file_ref' | 'risk' | 'review_focus_entry';
  detail: string;
}

export interface GroundBriefResult {
  brief: PrBrief;
  dropped: GroundingDrop[];
}

export function groundBrief(brief: PrBrief, changedPaths: readonly string[]): GroundBriefResult {
  const changed = new Set(changedPaths);
  const dropped: GroundingDrop[] = [];

  const risks: Risk[] = [];
  for (const risk of brief.risks) {
    const keptRefs = risk.file_refs.filter((ref) => {
      if (changed.has(ref.path)) return true;
      dropped.push({ kind: 'risk_file_ref', detail: ref.path });
      return false;
    });

    if (keptRefs.length === 0) {
      dropped.push({ kind: 'risk', detail: risk.title });
      continue;
    }

    risks.push({ ...risk, file_refs: keptRefs });
  }

  const seenFocusKeys = new Set<string>();
  const reviewFocus: ReviewFocusEntry[] = [];
  for (const entry of brief.review_focus) {
    if (!changed.has(entry.file.path)) {
      dropped.push({ kind: 'review_focus_entry', detail: entry.file.path });
      continue;
    }

    const key = `${entry.file.path}:${entry.file.start_line ?? ''}`;
    if (seenFocusKeys.has(key)) {
      dropped.push({ kind: 'review_focus_entry', detail: key });
      continue;
    }
    seenFocusKeys.add(key);
    reviewFocus.push(entry);
  }

  return {
    brief: {
      ...brief,
      risks,
      review_focus: reviewFocus,
    },
    dropped,
  };
}
