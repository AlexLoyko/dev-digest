import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----

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
 * What a PR is trying to do, and what it deliberately is not.
 *
 * `type`/`confidence`/`sources` are REQUIRED: an intent that cannot say how well
 * evidenced it is, or what it was derived from, is precisely the thing this
 * contract exists to prevent. `confidence` is computed by the server from which
 * sources resolved — the model never self-reports it.
 */
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  type: IntentType,
  confidence: IntentConfidence,
  sources: z.array(IntentSource),
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

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

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

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
