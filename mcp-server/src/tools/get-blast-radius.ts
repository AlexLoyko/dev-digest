/**
 * `devdigest_get_blast_radius` — PR impact map: which symbols this PR's diff
 * redeclares, who calls them (file:line, capped per symbol), and which HTTP
 * endpoints/cron jobs are reachable downstream via the import graph.
 *
 * Backed by `GET /pulls/:id/blast` (`server/src/modules/blast/`), which reads
 * the repo-intel persistent code index — never the diff or an LLM. Data is
 * either real (derived from the index) or explicitly marked degraded via
 * `state`/`reason`; nothing here is ever fabricated.
 *
 * Same resolve-then-call shape as `devdigest_get_conventions`: resolve
 * `repo`/`pr` through the injected `Resolver` (so an unknown repo/PR produces
 * the same actionable error text every other tool produces), then one
 * `api.getBlast(prId)` call, then `formatBlastRadius()` (format.ts) shapes
 * the response — capping shown symbols/callers for token economy while
 * `counts`/`caller_total`/`facts_truncated` always report the TRUE numbers,
 * same discipline the Studio UI's own Blast Radius card follows.
 *
 * Prompt-injection hardening (R11): a prior PR's `title` is third-party free
 * text, routed through `untrusted()` inside `formatBlastRadius`. Everything
 * else (file paths, symbol/route names) is a structural identifier, left
 * unwrapped — same treatment `Finding.file`/`ConventionCandidate.evidence_path`
 * already get.
 */
import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import { ToolError } from '../errors.js';
import { fail, formatBlastRadius, ok } from '../format.js';
import type { Resolver } from '../resolve.js';
import type { ToolDef, ToolDeps } from './types.js';

const inputShape = {
  repo: z
    .string()
    .describe('Repository as "owner/name", exactly as it is registered in DevDigest — e.g. "acme/api".'),
  pr: z.number().int().describe('Pull request number as shown on GitHub, e.g. 482.'),
};

type Input = z.infer<z.ZodObject<typeof inputShape>>;

/** `FormattedBlastCaller` (format.ts), written inline — no `$ref` (R10a). */
const blastCallerShape = z.object({
  file: z.string(),
  symbol: z.string(),
  line: z.number().int(),
});

/** `FormattedBlastSymbol` (format.ts), written inline — no `$ref` (R10a). */
const blastSymbolShape = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
  caller_total: z.number().int(),
  callers: z.array(blastCallerShape),
  callers_truncated: z.boolean(),
  endpoints: z.array(z.string()),
  crons: z.array(z.string()),
});

/** `FormattedBlastPriorPr` (format.ts), written inline — no `$ref` (R10a). */
const blastPriorPrShape = z.object({
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  files_overlap_count: z.number().int(),
});

const outputSchema = {
  repo: z.string(),
  pr: z.number().int(),
  state: z.enum(['full', 'partial', 'degraded']),
  // 'no_clone' omitted — a reserved BlastReason value `mapIndexState`
  // (server/src/modules/blast/service.ts) never actually returns today.
  reason: z.enum(['ok', 'flag_off', 'not_indexed', 'index_partial', 'index_failed', 'no_symbols']),
  explanation: z.string(),
  indexed_sha: z.string().nullable(),
  head_sha: z.string(),
  counts: z.object({
    symbols: z.number().int(),
    callers: z.number().int(),
    endpoints: z.number().int(),
    crons: z.number().int(),
  }),
  symbols: z.array(blastSymbolShape),
  prior_prs: z.array(blastPriorPrShape),
  next_step: z.string().optional(),
};

const annotations = {
  readOnlyHint: true,
  openWorldHint: false,
};

/** Extracts the already-built, actionable message from a caught error (mirrors `get-conventions.ts`'s `errText`). */
function errText(err: unknown): string {
  if (err instanceof ToolError) {
    return err.text;
  }
  return err instanceof Error ? err.message : String(err);
}

async function handler(args: Input, deps: ToolDeps) {
  const api = deps.api as ApiClient;
  const resolver = deps.resolver as Resolver;

  let repoFullName: string;
  let prId: string;
  try {
    const repo = await resolver.resolveRepo(args.repo);
    const pr = await resolver.resolvePr(repo.id, args.pr);
    repoFullName = repo.full_name;
    prId = pr.id;
  } catch (err) {
    return fail(errText(err));
  }

  let blast;
  try {
    blast = await api.getBlast(prId);
  } catch (err) {
    return fail(errText(err));
  }

  const formatted = formatBlastRadius(blast);

  return ok({
    repo: repoFullName,
    pr: args.pr,
    ...formatted,
  });
}

export const getBlastRadiusTool: ToolDef<typeof inputShape> = {
  name: 'devdigest_get_blast_radius',
  description:
    "PR impact map: this PR's changed symbols, their callers, and downstream HTTP " +
    'endpoints/cron jobs, from the code index. Degrades explicitly (never fabricates) when ' +
    'the repo is not indexed.',
  inputShape,
  outputSchema,
  annotations,
  handler,
};
