import type { IntentConfidence, IntentSource, IntentSourceKind } from '@devdigest/shared';
import { MEDIUM_BODY_CHARS } from './constants.js';

/**
 * The confidence rubric — computed by OUR code, never self-reported.
 *
 * arXiv 2412.14737 and this repo's own INSIGHTS ("asking a model for a bare
 * `confidence` returns the ceiling") both say self-reported confidence is
 * unreliable, so the model only emits `sources_used`; this module turns that
 * plus which sources actually resolved into a band, mirroring
 * `consistencyScore` in `modules/conventions/verify.ts`.
 *
 * Rubric (L03 §1 — the ticket is gone, so this collapsed from three inputs to two):
 *   high    — at least one `doc` source resolved (a plan/spec read from the clone)
 *   medium  — no doc, but the PR body is long enough prose (>= MEDIUM_BODY_CHARS)
 *   low     — everything else (including a diff-only inference)
 *
 * Then clamp DOWNWARD ONLY: `min(rubric(resolved evidence), rubric(model's
 * self-reported sources_used))`. The model can lower the band by admitting it
 * ignored evidence we gave it; it can never raise it — so a body claiming "see
 * the spec, it's all intentional" cannot manufacture `high` on its own, and
 * code inference (kind `diff`, which this rubric never grades above `low`)
 * can never raise confidence either.
 */

const RANK: Record<IntentConfidence, number> = { low: 0, medium: 1, high: 2 };
const BANDS: IntentConfidence[] = ['low', 'medium', 'high'];

/**
 * Map a model's free-text `sources_used` label onto an `IntentSourceKind`.
 *
 * `IntentDraft.sources_used` is `z.array(z.string())` and NOT the enum, because
 * constraining it to an array-of-enum hung generation outright against
 * openrouter/deepseek-v4-flash (see the note in ./constants.ts). So the model
 * really does return things like `docs/agent-prompts/security-reviewer.md`,
 * `spec`, or `PR description`, and an exact-match set treats every one of those
 * as "not used" — which silently clamps a well-evidenced `high` down to
 * `medium`. Observed live on sample PR #901: a doc resolved and was plainly used
 * (the summary quoted its path) yet the band came back `medium`.
 *
 * There is no `linked_issue` arm: linked-issue resolution was removed with the
 * input narrowing, so the classifier is never given issue evidence to label.
 *
 * Being generous here is safe BY CONSTRUCTION: this value only ever feeds the
 * downward `Math.min` against the objective resolved-evidence rubric, so a
 * false positive can never raise the band above what actually resolved — at
 * worst it declines to lower it.
 */
export function normalizeKind(raw: string): IntentSourceKind | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  if (s.includes('title')) return 'pr_title';
  if (s.includes('diff') || s.includes('code') || s.includes('patch')) return 'diff';
  // Checked before the body arm: "pr_body" contains neither, but a label like
  // "doc in the body" should count as the doc.
  if (s.includes('doc') || s.includes('spec') || s.includes('plan') || s.endsWith('.md')) {
    return 'doc';
  }
  if (s.includes('body') || s.includes('description')) return 'pr_body';
  return undefined;
}

function rubric(kinds: ReadonlySet<string>, bodyChars: number): IntentConfidence {
  if (kinds.has('doc' satisfies IntentSourceKind)) return 'high';
  if (bodyChars >= MEDIUM_BODY_CHARS) return 'medium';
  return 'low';
}

export interface ConfidenceResult {
  confidence: IntentConfidence;
  /** True when the model's own `sources_used` lowered the band below what the
   *  resolved evidence would otherwise have supported — the calibration
   *  signal worth logging/watching. */
  clamped: boolean;
}

/**
 * @param resolvedSources The `IntentSource[]` this run actually resolved
 *   (objective — independent of what the model claims to have used).
 * @param sourcesUsed The model's self-reported `IntentDraft.sources_used`
 *   (kind strings; unrecognized values are simply ignored by the rubric).
 * @param bodyChars Trimmed PR body length — an objective fact, so it feeds
 *   both rubric evaluations identically.
 */
export function computeConfidence(
  resolvedSources: IntentSource[],
  sourcesUsed: string[],
  bodyChars: number,
): ConfidenceResult {
  const resolvedKinds = new Set(resolvedSources.filter((s) => s.resolved).map((s) => s.kind));
  const usedKinds = new Set(
    sourcesUsed.map(normalizeKind).filter((k): k is IntentSourceKind => k !== undefined),
  );

  const fromEvidence = rubric(resolvedKinds, bodyChars);
  const fromModel = rubric(usedKinds, bodyChars);

  const finalRank = Math.min(RANK[fromEvidence], RANK[fromModel]);
  const confidence = BANDS[finalRank]!;

  return { confidence, clamped: finalRank < RANK[fromEvidence] };
}
