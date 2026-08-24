/**
 * Response formatting, truncation and the `ok()`/`fail()` envelope helpers
 * shared by every `devdigest_*` tool.
 *
 * All third-party-derived strings (finding `title`/`rationale`/`suggestion`,
 * review `summary`, convention `rule`/`evidence_snippet`, blast-radius prior-PR
 * `title`) are routed through `untrusted()`/`untrustedOrNull()` before they
 * reach a tool response — see `untrusted.ts`. This data comes from PR diffs
 * and repo source, so it must be fenced as data, never instructions, before
 * an LLM client reads it. Identifiers extracted from source (file paths,
 * symbol/function names, HTTP route strings) are passed through un-wrapped,
 * same as `Finding.file`/`ConventionCandidate.evidence_path` already do —
 * they are short structural tokens, not narrative prose a model could be
 * redirected by.
 */
import type { Agent, BlastRadiusView, ConventionCandidate, Finding, Severity } from '@devdigest/shared';
import { untrusted, untrustedOrNull } from './untrusted.js';
import type { ToolResult } from './tools/types.js';

/** Matches `config.ts`'s `maxFindings` default — used only when a caller omits `max`. */
export const DEFAULT_MAX_FINDINGS = 20;

/** Lowercase form accepted as the `severity` tool argument (the real enum is UPPERCASE). */
export type SeverityArg = 'critical' | 'warning' | 'suggestion';

/**
 * The subset of `ReviewDto` (`server/src/modules/reviews/helpers.ts`)
 * `formatFindings` actually needs. Declared locally rather than imported —
 * `ReviewDto`/`ReviewDtoFinding` live under `server/src/modules/`, not
 * `@devdigest/shared`, and `mcp-server/` may only import `server/src` via
 * the shared alias. `ReviewDtoFinding extends Finding`, so a real
 * `ReviewDto` is structurally assignable to `ReviewLike` as-is.
 */
export interface ReviewLike {
  verdict: string | null;
  summary: string | null;
  score: number | null;
  findings: Finding[];
}

export interface FormatFindingsOptions {
  responseFormat?: 'concise' | 'detailed';
  severity?: SeverityArg;
  max?: number;
  /**
   * The run id to interpolate into the truncation `next_step` sentence, so
   * the model can call `devdigest_get_findings` with a literal, ready-to-use
   * `run_id="<id>"` argument instead of having to re-derive it from another
   * field. Optional — callers that don't have one yet (or tests) fall back
   * to a keyword-only mention of `run_id`.
   */
  runId?: string;
}

interface FormattedFindingBase {
  severity: Severity;
  category: string;
  title: string;
  file: string;
  lines: string;
}

interface FormattedFindingDetailed extends FormattedFindingBase {
  id: string;
  why: string;
  fix?: string;
  confidence: number;
}

export type FormattedFinding = FormattedFindingBase | FormattedFindingDetailed;

export interface FormattedFindings {
  verdict: string | null;
  score: number | null;
  summary: string | null;
  findings_total: number;
  findings_shown: number;
  findings: FormattedFinding[];
  next_step?: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

function toUpperSeverity(severity: SeverityArg): Severity {
  return severity.toUpperCase() as Severity;
}

function toLowerSeverity(severity: Severity): SeverityArg {
  return severity.toLowerCase() as SeverityArg;
}

/** CRITICAL → WARNING → SUGGESTION, then confidence descending. */
function compareFindings(a: Finding, b: Finding): number {
  const rankDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (rankDiff !== 0) {
    return rankDiff;
  }
  return b.confidence - a.confidence;
}

function formatFinding(finding: Finding, detailed: boolean): FormattedFinding {
  const base: FormattedFindingBase = {
    severity: finding.severity,
    category: finding.category,
    title: untrusted('finding-title', finding.title),
    file: finding.file,
    lines: `${finding.start_line}-${finding.end_line}`,
  };

  if (!detailed) {
    return base;
  }

  const fix = untrustedOrNull('finding-suggestion', finding.suggestion);

  return {
    ...base,
    id: finding.id,
    why: untrusted('finding-rationale', finding.rationale),
    ...(fix !== null ? { fix } : {}),
    confidence: finding.confidence,
  };
}

/**
 * Builds the `{ verdict, score, summary, findings_total, findings_shown,
 * findings, next_step? }` envelope shared by `devdigest_run_agent_on_pr`
 * (done branch) and `devdigest_get_findings`.
 *
 * `next_step` is present only when the result was truncated by `max`, and
 * always names `devdigest_get_findings`, `run_id` and `severity` so the
 * caller knows exactly how to narrow — the model reading it needs a
 * complete, literal next action, not a description of one (design
 * principle 4 — "an error/truncation leads somewhere"). When `options.runId`
 * is supplied, the actual id is interpolated as `run_id="<id>"` so the model
 * can copy the argument value directly, matching the plan's verbatim
 * example (`run_id="…"`) rather than making the model re-derive it from
 * another field in the response.
 */
export function formatFindings(
  review: ReviewLike,
  options: FormatFindingsOptions = {},
): FormattedFindings {
  const responseFormat = options.responseFormat ?? 'concise';
  const detailed = responseFormat === 'detailed';
  const max = options.max ?? DEFAULT_MAX_FINDINGS;

  const filtered = options.severity
    ? review.findings.filter((finding) => finding.severity === toUpperSeverity(options.severity!))
    : review.findings.slice();

  const sorted = filtered.slice().sort(compareFindings);
  const shown = sorted.slice(0, max);

  const result: FormattedFindings = {
    verdict: review.verdict,
    score: review.score,
    summary: untrustedOrNull('review-summary', review.summary),
    findings_total: sorted.length,
    findings_shown: shown.length,
    findings: shown.map((finding) => formatFinding(finding, detailed)),
  };

  if (sorted.length > shown.length) {
    const narrowSeverity = options.severity ?? toLowerSeverity(shown[0]?.severity ?? sorted[0]!.severity);
    const runIdClause = options.runId ? `run_id="${options.runId}"` : 'the same run_id';
    result.next_step =
      `Showing ${shown.length} of ${sorted.length} findings, most severe first. ` +
      `Call devdigest_get_findings with ${runIdClause} and severity="${narrowSeverity}" to narrow, ` +
      'or response_format="detailed" for rationale and fixes.';
  }

  return result;
}

export interface FormattedAgent {
  id: string;
  name: string;
  model: string;
  enabled: boolean;
}

/**
 * Projects each `Agent` (14 fields, including `system_prompt` and
 * `output_schema`) down to exactly `id`, `name`, `model`, `enabled`, in
 * that key order — by explicit picking, never by deleting unwanted keys
 * (R14), so a field added to the `Agent` contract later cannot silently
 * leak into a tool response. A raw `system_prompt` in a tool response is
 * both a token bomb and needless exposure.
 */
export function formatAgents(agents: Agent[]): FormattedAgent[] {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    model: agent.model,
    enabled: agent.enabled,
  }));
}

export interface FormatConventionsOptions {
  responseFormat?: 'concise' | 'detailed';
}

interface FormattedConventionBase {
  rule: string;
  evidence_path: string;
  accepted: boolean;
}

interface FormattedConventionDetailed extends FormattedConventionBase {
  confidence: number;
  evidence_snippet: string;
}

export type FormattedConvention = FormattedConventionBase | FormattedConventionDetailed;

export interface FormattedConventions {
  accepted_count: number;
  pending_count: number;
  conventions: FormattedConvention[];
}

/**
 * `concise` returns accepted rules only; `detailed` adds pending candidates
 * plus `confidence` and `evidence_snippet` (also untrusted-wrapped).
 * `accepted_count`/`pending_count` always reflect the full candidate set,
 * independent of which subset `conventions` shows.
 */
export function formatConventions(
  conventions: ConventionCandidate[],
  options: FormatConventionsOptions = {},
): FormattedConventions {
  const detailed = (options.responseFormat ?? 'concise') === 'detailed';

  const acceptedCount = conventions.filter((c) => c.accepted).length;
  const pendingCount = conventions.filter((c) => !c.accepted).length;
  const visible = detailed ? conventions : conventions.filter((c) => c.accepted);

  return {
    accepted_count: acceptedCount,
    pending_count: pendingCount,
    conventions: visible.map((candidate) => {
      const base: FormattedConventionBase = {
        rule: untrusted('convention-rule', candidate.rule),
        evidence_path: candidate.evidence_path,
        accepted: candidate.accepted,
      };

      if (!detailed) {
        return base;
      }

      return {
        ...base,
        confidence: candidate.confidence,
        evidence_snippet: untrusted('convention-evidence', candidate.evidence_snippet),
      };
    }),
  };
}

/** Per-symbol caller cap for the MCP response — tighter than the HTTP endpoint's
 *  own 20-per-symbol cap, since a response can carry many symbols at once. */
const MAX_CALLERS_SHOWN_PER_SYMBOL = 5;
/** Matches `DEFAULT_MAX_FINDINGS`'s role: caps how many changed symbols are
 *  shown when a PR touches many of them (`counts.symbols` still reports the
 *  true total). */
export const DEFAULT_MAX_BLAST_SYMBOLS = 10;

export interface FormattedBlastCaller {
  file: string;
  symbol: string;
  line: number;
}

export interface FormattedBlastSymbol {
  name: string;
  file: string;
  kind: string;
  caller_total: number;
  callers: FormattedBlastCaller[];
  callers_truncated: boolean;
  endpoints: string[];
  crons: string[];
}

export interface FormattedBlastPriorPr {
  number: number;
  title: string;
  author: string;
  files_overlap_count: number;
}

export interface FormattedBlastRadius {
  state: BlastRadiusView['state'];
  reason: BlastRadiusView['reason'];
  explanation: string;
  indexed_sha: string | null;
  head_sha: string;
  counts: BlastRadiusView['counts'];
  symbols: FormattedBlastSymbol[];
  prior_prs: FormattedBlastPriorPr[];
  next_step?: string;
}

export interface FormatBlastRadiusOptions {
  max?: number;
}

/** Total downstream reach used to rank which changed symbols matter most. */
function blastImpact(symbol: BlastRadiusView['symbols'][number]): number {
  return symbol.caller_total + symbol.endpoint_total + symbol.cron_total;
}

/**
 * Builds the `{ state, reason, explanation, counts, symbols, prior_prs,
 * next_step? }` envelope for `devdigest_get_blast_radius`.
 *
 * `blast.symbols` (from `GET /pulls/:id/blast`) is already per-symbol capped
 * at 20 callers / 20 endpoints+crons by the API — this formatter applies a
 * SECOND, tighter reduction on top: at most `max` symbols (ranked by total
 * downstream impact, most-reaching first — `RequestContext`-style symbols
 * with zero callers sort last), and at most `MAX_CALLERS_SHOWN_PER_SYMBOL`
 * callers per shown symbol. `caller_total`/`counts` always report the TRUE
 * numbers regardless of what's actually shown, and `callers_truncated` says
 * so explicitly — the exact bug just fixed in the Studio UI's own Blast
 * Radius card (a truncated array with no flag, silently read as complete)
 * does not get reintroduced here. Endpoint/cron facts are flattened to their
 * label strings — `file`/`depth` are dropped to keep the response compact;
 * the full detail is still on the HTTP endpoint for anyone building against
 * it directly. `symbols.length` in the response IS how many are shown; a
 * separate `symbols_shown` counter would only restate it.
 */
export function formatBlastRadius(
  blast: BlastRadiusView,
  options: FormatBlastRadiusOptions = {},
): FormattedBlastRadius {
  const max = options.max ?? DEFAULT_MAX_BLAST_SYMBOLS;

  const sorted = blast.symbols.slice().sort((a, b) => blastImpact(b) - blastImpact(a));
  const shown = sorted.slice(0, max);

  const symbols: FormattedBlastSymbol[] = shown.map((symbol) => {
    const callers = symbol.callers.slice(0, MAX_CALLERS_SHOWN_PER_SYMBOL).map((caller) => ({
      file: caller.file,
      symbol: caller.symbol,
      line: caller.line,
    }));
    return {
      name: symbol.name,
      file: symbol.file,
      kind: symbol.kind,
      caller_total: symbol.caller_total,
      callers,
      callers_truncated: symbol.caller_total > callers.length,
      endpoints: symbol.endpoints.map((fact) => fact.label),
      crons: symbol.crons.map((fact) => fact.label),
    };
  });

  const result: FormattedBlastRadius = {
    state: blast.state,
    reason: blast.reason,
    explanation: blast.explanation,
    indexed_sha: blast.indexed_sha,
    head_sha: blast.head_sha,
    counts: blast.counts,
    symbols,
    prior_prs: blast.prior_prs.map((pr) => ({
      number: pr.number,
      title: untrusted('pr-title', pr.title),
      author: pr.author,
      files_overlap_count: pr.files_overlap.length,
    })),
  };

  if (sorted.length > shown.length) {
    result.next_step =
      `Showing ${shown.length} of ${sorted.length} changed symbols, ranked by total downstream ` +
      'impact (callers + endpoints + crons). There is no narrowing argument yet — if the user ' +
      'cares about a specific symbol not shown here, check the Blast Radius card on the PR’s ' +
      'Overview tab in the Studio UI instead.';
  }

  return result;
}

/**
 * Success envelope (R10a — Structured Content): every tool response carries
 * both the serialized JSON in a `TextContent` block (for clients that only
 * read `content`) and `structuredContent` conforming to the tool's
 * `outputSchema` (for spec-2026-07-28-aware clients).
 */
export function ok(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

/** Error envelope — `text` must always be an actionable, directive sentence (see `errors.ts`). */
export function fail(text: string): ToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}
