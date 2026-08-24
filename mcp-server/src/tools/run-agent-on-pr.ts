/**
 * `devdigest_run_agent_on_pr` — the only write tool. Reviews a GitHub pull
 * request with a DevDigest agent and returns the finished verdict and
 * findings in one call: it starts the review, waits for it to finish (bounded,
 * R5), and collects the results.
 *
 * Per the L04 plan's "Architecture changes" (Three-Step Rule, applied to the
 * MCP transport) and this task's own instructions, this file is a **thin
 * handler and nothing more**: (1) declare the flat Zod input shape, (2) call
 * exactly one flow function — `runReview()` from `flows/run-review.ts`
 * (T10a), which already owns resolve -> start -> record -> wait -> collect,
 * and (3) map the returned `RunOutcome` through `ok()`/`fail()`. This file
 * never reaches into the injected dependency bag's individual adapters
 * (the HTTP client, the identifier resolver, the run index) or the bounded
 * wait helper directly — if a second flow call or a branch the flow doesn't
 * express turns out to be needed, that means `runReview()` is
 * under-specified and should be fixed there, not worked around in this file.
 */
import { z } from 'zod';
import { runReview } from '../flows/run-review.js';
import { fail, formatFindings, ok } from '../format.js';
import type { ToolDef, ToolDeps } from './types.js';

const inputShape = {
  repo: z
    .string()
    .describe(
      'Repository as "owner/name", exactly as it is registered in DevDigest — e.g. "acme/api".',
    ),
  pr: z.number().int().describe('Pull request number as shown on GitHub, e.g. 482.'),
  agent_id: z
    .string()
    .describe(
      "Id of the reviewer agent, from devdigest_list_agents. The agent's name is accepted too — e.g. \"Security\".",
    ),
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
 * Flat, `$ref`-free output shape (R10a) shared conceptually with
 * `devdigest_get_findings`'s envelope: `status` discriminates `"done"` from
 * `"running"` via optional fields, never `oneOf` (the plan's explicit
 * instruction for this shared envelope). The finding object is written
 * inline rather than factored into a `$ref`, matching every other tool in
 * this package.
 */
const outputSchema = {
  status: z.enum(['done', 'running']),
  repo: z.string(),
  pr: z.number().int(),
  agent_id: z.string(),
  agent_name: z.string(),
  run_id: z.string(),
  verdict: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  summary: z.string().nullable().optional(),
  findings_total: z.number().int().optional(),
  findings_shown: z.number().int().optional(),
  findings: z
    .array(
      z.object({
        severity: z.string(),
        category: z.string(),
        title: z.string(),
        file: z.string(),
        lines: z.string(),
        id: z.string().optional(),
        why: z.string().optional(),
        fix: z.string().optional(),
        confidence: z.number().optional(),
      }),
    )
    .optional(),
  /** Present only on the "budget exhausted" (running) response. */
  elapsed_s: z.number().int().optional(),
  next_step: z.string().optional(),
};

async function handler(args: Input, deps: ToolDeps) {
  const outcome = await runReview(deps, { repo: args.repo, pr: args.pr, agentId: args.agent_id });

  if (outcome.status === 'failed') {
    return fail(outcome.text);
  }

  if (outcome.status === 'running') {
    // NON-error (R5): a bounded-wait timeout is an expected outcome, not a
    // failure. `next_step` names a concrete follow-up call with the actual
    // run_id interpolated, per the plan's verbatim example.
    return ok({
      status: 'running',
      repo: outcome.repo,
      pr: outcome.pr,
      agent_id: outcome.agentId,
      agent_name: outcome.agentName,
      run_id: outcome.runId,
      elapsed_s: outcome.elapsedS,
      next_step:
        `The review is still running after ${outcome.elapsedS}s. Wait about a minute, then call ` +
        `devdigest_get_findings with run_id="${outcome.runId}" to get the result. Do not start another run.`,
    });
  }

  // outcome.status === 'done'
  const formatted = formatFindings(outcome.review, {
    responseFormat: args.response_format,
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
  });
}

export const runAgentOnPrTool: ToolDef<typeof inputShape> = {
  name: 'devdigest_run_agent_on_pr',
  description:
    'Review a GitHub pull request with a DevDigest agent and return the finished verdict and ' +
    'findings. Does the whole job in one call: starts the review, waits for it to finish, and ' +
    'collects the results — do not poll. Use for requests like "review PR 482", "check this PR ' +
    'for bugs or security problems before merge".',
  inputShape,
  outputSchema,
  annotations: {
    readOnlyHint: false,
    // Explicit — the spec default for destructiveHint is `true`. This tool
    // only ever inserts an agent_run row plus its review and findings; it
    // never deletes or overwrites anything.
    destructiveHint: false,
    // Declared even though `false` is the spec default: calling this twice
    // with identical arguments starts TWO reviews and burns two LLM
    // budgets — the single most consequential fact about this tool.
    idempotentHint: false,
    // Reaches GitHub for the diff and an LLM provider for the analysis.
    openWorldHint: true,
  },
  handler,
};
