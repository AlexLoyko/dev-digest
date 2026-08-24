import { describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../config.js';
import { createApiClient } from '../api-client.js';
import { apiUnreachable } from '../errors.js';
import { ok } from '../format.js';
import { createFakeApi } from '../../test/fake-api.js';
import { listAgentsTool } from './list-agents.js';
import type { ToolDeps } from './types.js';

const EXACT_DESCRIPTION =
  'List the code-review agents configured in DevDigest as (id, name, model, enabled). ' +
  'Call this first to get a valid `agent_id` for devdigest_run_agent_on_pr. Takes no arguments.';

const config = loadConfig({ DEVDIGEST_API_URL: 'http://127.0.0.1:3001' });

function buildDeps(apiOverride: ToolDeps['api']): ToolDeps {
  return { api: apiOverride, resolver: undefined, runIndex: undefined, config };
}

describe('devdigest_list_agents — declaration', () => {
  it('carries the exact verbatim description', () => {
    expect(listAgentsTool.name).toBe('devdigest_list_agents');
    expect(listAgentsTool.description).toBe(EXACT_DESCRIPTION);
  });

  it('declares the canonical empty (no-params) input shape', () => {
    expect(Object.keys(listAgentsTool.inputShape)).toEqual([]);
  });

  it('declares R15 annotations — readOnlyHint/openWorldHint only, no destructive/idempotent hints', () => {
    expect(listAgentsTool.annotations.readOnlyHint).toBe(true);
    expect(listAgentsTool.annotations.openWorldHint).toBe(false);
    expect(listAgentsTool.annotations).not.toHaveProperty('destructiveHint');
    expect(listAgentsTool.annotations).not.toHaveProperty('idempotentHint');
  });

  it('declares a non-empty outputSchema (R10a)', () => {
    expect(Object.keys(listAgentsTool.outputSchema)).toEqual(
      expect.arrayContaining(['agents']),
    );
  });

  /**
   * Round-trips the tool declaration through a real MCP server/client pair
   * (in-memory transport, no network) to inspect the JSON Schema the SDK
   * actually produces for the empty input shape — the "canonical no-params
   * form" cited in the L04 plan ("The five tools (exact contracts)": `{"type
   * ":"object","additionalProperties":false}`).
   *
   * The `properties: {}` / `type: 'object'` assertions hold on the pinned
   * `@modelcontextprotocol/sdk@1.30.0`: the tool takes no arguments and the
   * SDK reports it as a bare object schema either way. `additionalProperties`
   * is asserted only when present, rather than required, because this SDK
   * version routes a zero-key raw shape through `zod/v4-mini`'s `object({})`
   * for JSON Schema conversion, which omits `additionalProperties` instead of
   * declaring it `false` (unlike the vendored v3 `zod-to-json-schema`
   * converter used for every non-empty shape) — see the comment above
   * `INPUT_SHAPE` in `list-agents.ts` and `mcp-server/insights/gotchas.md`
   * for the full trace. Either way, the wire schema accepts no properties, so
   * the tool takes no arguments regardless of that SDK-version detail.
   */
  it('renders as a no-arguments schema when registered with the real MCP SDK', async () => {
    const server = new McpServer({ name: 'list-agents-test', version: '0.0.0' });
    server.registerTool(
      listAgentsTool.name,
      {
        description: listAgentsTool.description,
        inputSchema: listAgentsTool.inputShape,
        outputSchema: listAgentsTool.outputSchema,
        annotations: listAgentsTool.annotations,
      },
      async () => ok({ agents: [] }),
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'list-agents-test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === listAgentsTool.name);
    expect(tool).toBeDefined();

    const inputSchema = tool!.inputSchema as Record<string, unknown>;
    expect(inputSchema.type).toBe('object');
    expect(inputSchema.properties).toEqual({});
    if ('additionalProperties' in inputSchema) {
      expect(inputSchema.additionalProperties).toBe(false);
    }

    expect(tool!.outputSchema).toBeDefined();
    expect(tool!.annotations?.readOnlyHint).toBe(true);
    expect(tool!.annotations?.openWorldHint).toBe(false);
    expect(tool!.annotations).not.toHaveProperty('destructiveHint');
    expect(tool!.annotations).not.toHaveProperty('idempotentHint');
  });
});

describe('devdigest_list_agents — handler', () => {
  it('happy path: projects each agent to exactly (id, name, model, enabled), in that key order', async () => {
    const fakeApi = createFakeApi();
    const api = createApiClient({ config, fetch: fakeApi.fetch });

    const result = await listAgentsTool.handler({}, buildDeps(api));

    expect(result.isError).toBeUndefined();
    const payload = result.structuredContent as { agents: Record<string, unknown>[] };
    expect(payload.agents.length).toBeGreaterThan(0);
    for (const agent of payload.agents) {
      expect(Object.keys(agent)).toEqual(['id', 'name', 'model', 'enabled']);
    }
    expect(payload).not.toHaveProperty('next_step');

    // The serialized TextContent block must mirror structuredContent exactly.
    const textBlock = result.content[0] as { type: string; text: string };
    expect(textBlock.type).toBe('text');
    expect(JSON.parse(textBlock.text)).toEqual(payload);
  });

  it('empty list is a non-error response with an actionable next_step', async () => {
    const fakeApi = createFakeApi({ agents: [] });
    const api = createApiClient({ config, fetch: fakeApi.fetch });

    const result = await listAgentsTool.handler({}, buildDeps(api));

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      agents: [],
      next_step:
        'No reviewer agents are configured. Create one in the DevDigest UI at ' +
        'http://localhost:3000/agents, then call devdigest_list_agents again.',
    });
  });

  it('API unreachable surfaces isError with the exact apiUnreachable() text', async () => {
    const unreachableFetch: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const api = createApiClient({ config, fetch: unreachableFetch });

    const result = await listAgentsTool.handler({}, buildDeps(api));

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: apiUnreachable() }]);
    expect(result.structuredContent).toBeUndefined();
  });
});
