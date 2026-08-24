/**
 * `devdigest_get_findings` — reads the verdict, score and findings of a
 * DevDigest review run that was already started by
 * `devdigest_run_agent_on_pr`. Thin handler (T13) — all orchestration
 * (run-index lookup, status polling, review collection) lives in
 * `readFindings()` (`flows/read-findings.ts`, T10b).
 *
 * Three-step handler only, per the L04 plan's "Architecture changes"
 * section: (1) parse the flat Zod input, (2) call exactly one flow
 * function, (3) map its `RunOutcome` through `ok()`/`fail()`. No
 * `deps.api.*`/`deps.resolver.*`/`deps.runIndex.*` access here — that is
 * what `readFindings()` exists to own.
 *
 * R6 (`run_id` is the ONLY way in — no repo+PR fallback) is enforced inside
 * `readFindings()` itself: an unknown `run_id` comes back as a `'failed'`
 * outcome carrying `unknownRunId()`'s text, which this handler simply
 * forwards via `fail()`. This file must not add a second identifier path.
 */
import { z } from 'zod';
import { readFindings } from '../flows/read-findings.js';
import { fail, formatFindings, ok } from '../format.js';
import type { ToolDef, ToolDeps } from './types.js';

const inputShape = {
  run_id: z.string().describe('Run id returned by devdigest_run_agent_on_pr.'),
  severity: z
    .enum(['critical', 'warning', 'suggestion'])
    .optional()
    .describe('Return only findings of this severity. Omit to get all of them.'),
  response_format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe(
      '"concise" (default) gives severity, title and file location per finding. "detailed" adds ' +
        'the rationale and the suggested fix, and is several times larger — ask for it only when ' +
        'the user wants explanations.',
    ),
};

type Input = z.infer<z.ZodObject<typeof inputShape>>;

/**
 * `FormattedFinding` written inline (concise fields required, detailed
 * fields optional) — no `$ref` (R10a). Shared shape with
 * `devdigest_run_agent_on_pr`'s `outputSchema`, kept independently declared
 * here per the plan's "written inline per tool rather than factored into a
 * `$ref`" instruction.
 */
const findingShape = z.object({
  severity: z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']),
  category: z.string(),
  title: z.string(),
  file: z.string(),
  lines: z.string(),
  id: z.string().optional(),
  why: z.string().optional(),
  fix: z.string().optional(),
  confidence: z.number().optional(),
});

/**
 * Flat, `$ref`-free envelope (R10a) shared with `devdigest_run_agent_on_pr`:
 * `status` discriminates `"done"` from `"running"` via optional fields,
 * never `oneOf`. `severity_filter` is present only when this tool's own
 * `severity` argument was supplied.
 */
const outputSchema = {
  status: z.enum(['done', 'running']),
  repo: z.string().optional(),
  pr: z.number().int().optional(),
  agent_id: z.string().optional(),
  agent_name: z.string().optional(),
  run_id: z.string().optional(),
  verdict: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  summary: z.string().nullable().optional(),
  findings_total: z.number().int().optional(),
  findings_shown: z.number().int().optional(),
  findings: z.array(findingShape).optional(),
  severity_filter: z.string().optional(),
  next_step: z.string().optional(),
};

async function handler(args: Input, deps: ToolDeps) {
  const outcome = await readFindings(deps, { runId: args.run_id });

  if (outcome.status === 'failed') {
    return fail(outcome.text);
  }

  if (outcome.status === 'running') {
    // Non-error (design principle 4) — the exact shape from the plan's
    // "3. devdigest_get_findings" section.
    return ok({
      status: 'running',
      run_id: outcome.runId,
      next_step:
        'The review is still running. Wait about a minute and call devdigest_get_findings with the same run_id.',
    });
  }

  // outcome.status === 'done'
  const formatted = formatFindings(outcome.review, {
    responseFormat: args.response_format,
    severity: args.severity,
    runId: outcome.runId,
  });

  return ok({
    status: 'done',
    repo: outcome.repo,
    pr: outcome.pr,
    agent_id: outcome.agentId,
    agent_name: outcome.agentName,
    run_id: outcome.runId,
    ...formatted,
    ...(args.severity ? { severity_filter: args.severity } : {}),
  });
}

export const getFindingsTool: ToolDef<typeof inputShape> = {
  name: 'devdigest_get_findings',
  description:
    'Get the verdict, score and findings of a DevDigest review run that was already started. ' +
    'Use the run_id returned by devdigest_run_agent_on_pr: to re-read a finished review, to ' +
    'collect one that was still running, or to filter a large result down by severity.',
  inputShape,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  handler,
};
