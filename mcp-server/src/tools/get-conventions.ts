/**
 * `devdigest_get_conventions` — reads a repository's coding conventions: the
 * style/design rules DevDigest extracted from that codebase and a human
 * accepted (plus, in `detailed` mode, the still-pending candidates).
 *
 * Unlike `devdigest_get_findings` (T13, which delegates to a `flows/`
 * use-case), this tool's whole sequence is small enough to live in one file,
 * exactly as T14's plan Action describes: resolve `repo` -> `ToolError` from
 * `resolve.ts` becomes `fail(err.text)` -> `api.listConventions(repoId)` ->
 * `formatConventions()` for the normal envelope, or a dedicated non-error
 * "nothing extracted yet" envelope when the repo has zero candidates.
 *
 * This tool is read-only (R15: `readOnlyHint: true`) — it must never call
 * `POST /repos/:repoId/conventions/extract`. Extraction is a write and stays
 * a human-triggered UI action (Conventions -> Scan); this tool only reads
 * whatever has already been extracted and accepted.
 *
 * Prompt-injection hardening (R11): every convention `rule` and
 * `evidence_snippet` is LLM output derived from third-party repository
 * source. `formatConventions()` (format.ts) already routes both through
 * `untrusted()` before they reach this tool's response — `get-conventions.
 * test.ts` asserts that wrapping directly against this tool's output (not
 * just against `format.ts` in isolation), so a future refactor of the
 * formatter that silently drops the wrapping fails here too.
 */
import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import { ToolError } from '../errors.js';
import { fail, formatConventions, ok } from '../format.js';
import type { Resolver } from '../resolve.js';
import type { ToolDef, ToolDeps } from './types.js';

const inputShape = {
  repo: z
    .string()
    .describe(
      'Repository as "owner/name", exactly as it is registered in DevDigest — e.g. "acme/api".',
    ),
  response_format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe(
      '"concise" (default) returns the accepted rules only. "detailed" also returns pending ' +
        'candidate rules with their confidence and evidence.',
    ),
};

type Input = z.infer<z.ZodObject<typeof inputShape>>;

/**
 * Flat, `$ref`-free output shape (R10a). `accepted_count`/`pending_count`
 * and `next_step` are optional rather than expressed via `oneOf` — present
 * on the normal envelope, absent on the "nothing extracted yet" envelope,
 * matching the discriminate-by-optional-field pattern used across every
 * other tool's envelope (`format.ts`'s `FormattedFindings`, `RunOutcome`).
 */
const outputSchema = {
  repo: z.string(),
  accepted_count: z.number().int().optional(),
  pending_count: z.number().int().optional(),
  conventions: z.array(
    z.object({
      rule: z.string(),
      evidence_path: z.string(),
      accepted: z.boolean(),
      confidence: z.number().optional(),
      evidence_snippet: z.string().optional(),
    }),
  ),
  next_step: z.string().optional(),
};

/** Extracts the already-built, actionable message from a caught error (mirrors `run-review.ts`'s `errText`). */
function errText(err: unknown): string {
  if (err instanceof ToolError) {
    return err.text;
  }
  return err instanceof Error ? err.message : String(err);
}

async function handler(args: Input, deps: ToolDeps) {
  const api = deps.api as ApiClient;
  const resolver = deps.resolver as Resolver;

  let repo;
  try {
    repo = await resolver.resolveRepo(args.repo);
  } catch (err) {
    return fail(errText(err));
  }

  let conventions;
  try {
    conventions = await api.listConventions(repo.id);
  } catch (err) {
    return fail(errText(err));
  }

  if (conventions.length === 0) {
    // Non-error (design principle 4): extraction is a write, and this tool
    // never triggers it — the next step is the human-driven UI flow.
    return ok({
      repo: repo.full_name,
      conventions: [],
      next_step:
        `No conventions have been extracted for ${repo.full_name} yet. Ask the user to open ` +
        'http://localhost:3000 → the repo → Conventions → Scan, then call devdigest_get_conventions again.',
    });
  }

  const formatted = formatConventions(conventions, { responseFormat: args.response_format });

  return ok({
    repo: repo.full_name,
    ...formatted,
  });
}

export const getConventionsTool: ToolDef<typeof inputShape> = {
  name: 'devdigest_get_conventions',
  description:
    "Read a repository's coding conventions — the style and design rules DevDigest extracted " +
    'from that codebase and a human accepted. Use before writing or reviewing code in that repo ' +
    'so the result matches the house style.',
  inputShape,
  outputSchema,
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  handler,
};
