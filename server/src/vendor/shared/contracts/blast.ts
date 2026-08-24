import { z } from 'zod';

/**
 * Blast radius VIEW contract — response shape of `GET /pulls/:id/blast`.
 *
 * Distinct from `BlastRadius` in `brief.ts` (the PR-brief LLM-composed summary,
 * kept as-is for the MCP stub / `PrBrief`). This is the `blast/` module's own
 * richer, index-derived view: per-symbol capped caller lists, depth-tagged
 * downstream endpoints/crons, an explicit full/partial/degraded state, and the
 * SHA each set of line numbers was indexed against (never the PR head SHA —
 * callers are almost never in files the PR touched).
 */

export const BlastState = z.enum(['full', 'partial', 'degraded']);
export type BlastState = z.infer<typeof BlastState>;

export const BlastReason = z.enum([
  'ok',
  'flag_off',
  'not_indexed',
  'index_partial',
  'index_failed',
  'no_symbols',
  'no_clone',
]);
export type BlastReason = z.infer<typeof BlastReason>;

export const BlastCallerView = z.object({
  file: z.string(),
  symbol: z.string(),
  line: z.number().int(),
  rank: z.number(),
});
export type BlastCallerView = z.infer<typeof BlastCallerView>;

/** A downstream HTTP endpoint or cron/job reachable from a changed symbol. */
export const BlastFactRef = z.object({
  label: z.string(),
  file: z.string(),
  /** 0 = declared in the changed file itself, 1/2 = BFS hops via the import graph. */
  depth: z.number().int(),
});
export type BlastFactRef = z.infer<typeof BlastFactRef>;

export const BlastSymbolNode = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
  callers: z.array(BlastCallerView),
  /** Pre-truncation caller count (before the per-symbol cap is applied). */
  caller_total: z.number().int(),
  callers_truncated: z.boolean(),
  endpoints: z.array(BlastFactRef),
  crons: z.array(BlastFactRef),
  /** Pre-truncation distinct counts (before the combined endpoints+crons cap). */
  endpoint_total: z.number().int(),
  cron_total: z.number().int(),
  facts_truncated: z.boolean(),
});
export type BlastSymbolNode = z.infer<typeof BlastSymbolNode>;

export const BlastPriorPr = z.object({
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  status: z.string(),
  updated_at: z.string().nullable(),
  files_overlap: z.array(z.string()),
});
export type BlastPriorPr = z.infer<typeof BlastPriorPr>;

export const BlastRadiusView = z.object({
  pr_id: z.string(),
  repo_full_name: z.string(),
  /** SHA the indexer last parsed — line numbers in `symbols`/`callers` are against THIS commit. */
  indexed_sha: z.string().nullable(),
  head_sha: z.string(),
  state: BlastState,
  reason: BlastReason,
  explanation: z.string(),
  symbols: z.array(BlastSymbolNode),
  counts: z.object({
    symbols: z.number().int(),
    callers: z.number().int(),
    endpoints: z.number().int(),
    crons: z.number().int(),
  }),
  prior_prs: z.array(BlastPriorPr),
});
export type BlastRadiusView = z.infer<typeof BlastRadiusView>;
