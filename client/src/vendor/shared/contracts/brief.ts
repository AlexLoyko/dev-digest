import { z } from 'zod';
import { Verdict } from './findings';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

// A grounded pointer into one of the PR's changed files. `start_line` /
// `end_line` are omitted (not null) when a risk or review-focus entry
// applies to the whole file rather than a specific range.
export const BriefFileRef = z.object({
  path: z.string(),
  start_line: z.number().int().optional(),
  end_line: z.number().int().optional(),
});
export type BriefFileRef = z.infer<typeof BriefFileRef>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(BriefFileRef).min(1),
});
export type Risk = z.infer<typeof Risk>;

// Orphaned placeholder — no longer referenced by PrBrief (see PrBrief.risks
// below, which is `array(Risk)` directly). Left in place per R-2; do not
// delete or repurpose without checking for other consumers.
export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Review focus (pr_brief.json) ----
export const ReviewFocusEntry = z.object({
  file: BriefFileRef,
  reason: z.string(),
});
export type ReviewFocusEntry = z.infer<typeof ReviewFocusEntry>;

// ---- Composed PR Brief (pr_brief.json) ----
// AC-4: exactly one risk level from a fixed ordered set (RiskSeverity);
// every risk carries a title, an explanation, and at least one grounded
// file reference (Risk.file_refs.min(1)).
export const PrBrief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusEntry),
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- Brief degradation (AC-14 / AC-15) ----
// One shared mechanism for "reduced" (token-budget shedding, R-3) and
// "omitted" (an input was simply absent, e.g. no linked issue) inputs.
export const BriefDegradedInput = z.enum([
  'intent',
  'blast',
  'linked_issue',
  'pr_description',
  'changed_files',
  'project_context',
]);
export type BriefDegradedInput = z.infer<typeof BriefDegradedInput>;

export const BriefDegradation = z.object({
  input: BriefDegradedInput,
  action: z.enum(['reduced', 'omitted']),
  detail: z.string().optional(),
});
export type BriefDegradation = z.infer<typeof BriefDegradation>;

// ---- Brief generation metadata (AC-10) ----
// The brief's OWN generation cost/tokens — distinct from `BriefLatestRun`'s
// numbers below, which come from a separate agent run against the same PR.
export const BriefMeta = z.object({
  head_sha: z.string(),
  generated_at: z.string(),
  provider: z.string(),
  model: z.string(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number(),
  duration_ms: z.number().int(),
  input_tokens_measured: z.boolean(),
  degraded: z.array(BriefDegradation),
});
export type BriefMeta = z.infer<typeof BriefMeta>;

// ---- Stored brief envelope (persisted inside pr_brief.json, R-1) ----
export const StoredBrief = BriefMeta.extend({
  schema_version: z.literal(1),
  brief: PrBrief,
});
export type StoredBrief = z.infer<typeof StoredBrief>;

// ---- Latest completed agent run (R-5: assembled server-side, read live) ----
// A completed run always has a verdict, findings_count and blockers (a
// failed/cancelled run is excluded entirely upstream — selectLatestCompletedRun
// returns null instead, see BriefResponse.latest_run below). score / cost_usd /
// tokens_in / tokens_out are nullable, not defaulted to 0: the underlying
// columns can genuinely be null (e.g. cost/tokens not tracked for a provider),
// and coercing to 0 would misrepresent an unmeasured value as a measured one.
export const BriefLatestRun = z.object({
  run_id: z.string(),
  verdict: Verdict,
  findings_count: z.number().int(),
  blockers: z.number().int(),
  score: z.number().nullable(),
  cost_usd: z.number().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  agent_name: z.string(),
});
export type BriefLatestRun = z.infer<typeof BriefLatestRun>;

// ---- Brief HTTP response (GET /pulls/:id/brief) ----
// `latest_run` is always present (never omitted) and is explicitly `null`
// when no completed run exists yet, or the only run failed (EC-5) — the
// client renders a "no review run yet" state from that null, not an absence.
//
// AC-23: `brief`/`meta` are `.nullable()` (not `.optional()`/`.nullish()`), so
// the "no brief generated yet" state is a present key carrying an explicit
// null, matching the deliberate `BriefLatestRun` convention above — the
// client renders its "generate a brief" card from that null, not an absence.
// `meta` describes a generation that, in this state, has not happened, so it
// is null exactly when `brief` is null. `latest_run` stays independently
// nullable: a PR can have no brief AND no completed run, or no brief but a
// completed run.
export const BriefResponse = z.object({
  brief: PrBrief.nullable(),
  meta: BriefMeta.nullable(),
  stale: z.boolean(),
  latest_run: BriefLatestRun.nullable(),
});
export type BriefResponse = z.infer<typeof BriefResponse>;

// ---- Blast Radius HTTP response (GET /pulls/:id/blast) ----
// Note: two parallel type families exist intentionally:
//   repo-intel/types.ts: BlastResult, BlastChangedSymbol, BlastCallerRow — INTERNAL, server only
//   brief.ts (below):    BlastRadiusResult + prefixed types — HTTP CONTRACT, client + MCP
// BlastService maps internal → contract before returning.
export const BlastDegradedReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const BlastChangedSymbol = z.object({
  file: z.string(),
  name: z.string(),
  kind: z.string(),
});
export type BlastChangedSymbol = z.infer<typeof BlastChangedSymbol>;

export const BlastCallerRow = z.object({
  file: z.string(),
  symbol: z.string(),
  viaSymbol: z.string(),
  line: z.number().int(),
  rank: z.number().int(),
});
export type BlastCallerRow = z.infer<typeof BlastCallerRow>;

export const PriorPr = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  openedAt: z.string().nullable(),
  status: z.string(),
});
export type PriorPr = z.infer<typeof PriorPr>;

export const BlastRadiusResult = z.object({
  changedSymbols: z.array(BlastChangedSymbol),
  callers: z.array(BlastCallerRow),
  impactedEndpoints: z.array(z.string()),
  factsByFile: z
    .record(
      z.object({
        endpoints: z.array(z.string()),
        crons: z.array(z.string()),
      }),
    )
    .optional(),
  degraded: z.boolean().optional(),
  reason: BlastDegradedReason.optional(),
  priorPrs: z.array(PriorPr).optional(),
  summary: z.string().optional(),
});
export type BlastRadiusResult = z.infer<typeof BlastRadiusResult>;
