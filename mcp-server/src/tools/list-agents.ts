/**
 * `devdigest_list_agents` — the entry-point tool a model calls first to get a
 * valid `agent_id` for `devdigest_run_agent_on_pr`. Read-only, no arguments.
 *
 * See the L04 plan, "The five tools (exact contracts)" → "1.
 * devdigest_list_agents", and R14 (exactly `(id, name, model, enabled)` per
 * agent, in that key order — `formatAgents` in `format.ts` owns the
 * projection).
 */
import { z } from 'zod';
import type { Agent } from '@devdigest/shared';
import type { ApiClient } from '../api-client.js';
import { ToolError } from '../errors.js';
import { fail, formatAgents, ok } from '../format.js';
import type { ToolDef } from './types.js';

/**
 * Canonical "no-params" input shape — an empty `ZodRawShape`. Per the plan
 * ("The five tools (exact contracts)"), this is meant to render as
 * `{"type":"object","additionalProperties":false}` once registered with the
 * MCP SDK. Empirically (verified against the pinned `@modelcontextprotocol
 * /sdk@1.30.0`), a zero-key raw shape is special-cased by the SDK's
 * `objectFromShape()` to `zod/v4-mini`'s `object({})`, whose `toJSONSchema()`
 * omits `additionalProperties` entirely rather than declaring it `false` (the
 * vendored v3 `zod-to-json-schema` converter — used for every *non-empty*
 * shape — does declare it `false` by default). The wire result is therefore
 * `{"type":"object","properties":{}}`, not the literal string the plan
 * quotes. This is an SDK-version quirk on the empty-shape path only; it does
 * not change what arguments the tool accepts (still none), so `inputShape`
 * stays `{}` here — see `mcp-server/insights/gotchas.md` for the full trace
 * and `list-agents.test.ts` for the round-trip assertion.
 */
const INPUT_SHAPE = {};

const OUTPUT_SHAPE = {
  agents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      model: z.string(),
      enabled: z.boolean(),
    }),
  ),
  /** Present only on the empty-list non-error response. */
  next_step: z.string().optional(),
};

export const listAgentsTool: ToolDef<typeof INPUT_SHAPE> = {
  name: 'devdigest_list_agents',
  description:
    'List the code-review agents configured in DevDigest as (id, name, model, enabled). ' +
    'Call this first to get a valid `agent_id` for devdigest_run_agent_on_pr. Takes no arguments.',
  inputShape: INPUT_SHAPE,
  outputSchema: OUTPUT_SHAPE,
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  async handler(_args, deps) {
    const api = deps.api as ApiClient;

    let agents: Agent[];
    try {
      agents = await api.listAgents();
    } catch (err) {
      if (err instanceof ToolError) {
        return fail(err.text);
      }
      // Anything else is unexpected — let `server.ts`'s outer catch (T17)
      // convert it into a generic actionable failure rather than swallowing
      // it here as if it were `apiUnreachable()`.
      throw err;
    }

    const formatted = formatAgents(agents);

    if (formatted.length === 0) {
      return ok({
        agents: [],
        next_step:
          'No reviewer agents are configured. Create one in the DevDigest UI at ' +
          'http://localhost:3000/agents, then call devdigest_list_agents again.',
      });
    }

    return ok({ agents: formatted });
  },
};
