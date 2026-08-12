import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

// ---- Intent classification (L03) ------------------------------------------
//
// The evidence trail deliberately does NOT live on `Intent` in `contracts/brief.ts`.
// `Intent` is a PrBrief building block — the bare `intent`/`in_scope`/`out_of_scope`
// triple — and stays parseable on its own. Knowing how well evidenced a
// classification is, and what it was derived from, is a persisted/transport concern
// of the Intent Layer, so it belongs here alongside `PrIntentRecord`.

/** What kind of change the PR claims to be. */
export const IntentType = z.enum([
  'feature',
  'fix',
  'refactor',
  'perf',
  'docs',
  'test',
  'chore',
  'security',
  'build',
  'revert',
]);
export type IntentType = z.infer<typeof IntentType>;

/**
 * How much evidence backed the classification. Computed by the SERVER from which
 * sources actually resolved — never self-reported by the model, which is
 * systematically overconfident. Without a resolved plan/spec doc this can never
 * exceed 'medium'.
 */
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

/**
 * The classifier's four inputs. `doc` is a plan/spec read from the local clone;
 * `diff` is the changed-file list from hunk headers — never hunk content, so a
 * `diff`-only intent is our reading of the change, not a statement of intent.
 */
export const IntentSourceKind = z.enum(['pr_title', 'pr_body', 'doc', 'diff']);
export type IntentSourceKind = z.infer<typeof IntentSourceKind>;

/** One input the classifier tried to use. `resolved: false` means it was linked but
    unreadable (missing token, foreign repo, unsafe path, empty file). */
export const IntentSource = z.object({
  kind: IntentSourceKind,
  /** '#482' | 'docs/plans/0003-x.md' | 'pr#482' */
  ref: z.string(),
  resolved: z.boolean(),
});
export type IntentSource = z.infer<typeof IntentSource>;

/**
 * What a PR is trying to do, what it deliberately is not, and the evidence behind
 * that reading. `type`/`confidence`/`sources` are required HERE — a classification
 * that cannot say how well evidenced it is, or what it was derived from, is
 * precisely the thing this shape exists to prevent. `confidence` is computed by the
 * server from which sources resolved; the model never self-reports it.
 */
export const PrIntent = Intent.extend({
  type: IntentType,
  confidence: IntentConfidence,
  sources: z.array(IntentSource),
});
export type PrIntent = z.infer<typeof PrIntent>;

/**
 * Intent persisted for a PR: the classification plus the pr_id it scopes and the
 * provenance the L03 Intent Layer records. `head_sha` is the cache key — a row
 * whose head_sha differs from the PR's current head is stale and gets recomputed.
 * Nullable throughout because rows predating L03 carry none of it.
 */
export const PrIntentRecord = PrIntent.extend({
  pr_id: z.string(),
  head_sha: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  classified_at: z.string().nullable(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;
