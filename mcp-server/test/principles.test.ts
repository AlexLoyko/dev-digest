/**
 * T21 — Four-principles audit test (R9).
 *
 * This is the mechanical guarantee that every `devdigest_*` tool satisfies
 * the four tool-design principles from the L04 plan's Overview/Requirements
 * ("outcome, not operation" / "flat arguments" / "concise structured
 * response" / "errors lead somewhere"), for as long as the codebase evolves.
 * One `describe` block per principle, below.
 *
 * Every principle iterates `TOOLS` (imported from `src/tools/index.ts`) or
 * the live `tools/list` result it produces — NEVER a hand-written list of
 * the five tool names — so a sixth tool added later is automatically
 * subjected to the same audit and cannot silently skip it. The one place a
 * tool name appears literally is `argsForTool()` in Principle 3, which
 * builds valid call arguments per tool; a tool with no registered fixture
 * throws loudly there rather than being silently skipped, which still
 * forces whoever adds a sixth tool to wire it into this audit.
 *
 * Per the plan's own instruction for Principle 4 ("drive the real error
 * paths through `createMcpServer` + `createFakeApi` ... rather than calling
 * the builders directly, so the assertion covers what the model actually
 * receives"), every scenario here goes through a real `Client` <->
 * `createMcpServer(...)` pair over `InMemoryTransport` — the same harness
 * pattern `test/tools-list-budget.test.ts` (T20) and `test/flow.test.ts`
 * (T22) use — never `tool.handler(...)` called directly.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/server.js';
import { createApiClient } from '../src/api-client.js';
import { createRunIndex } from '../src/run-index.js';
import type { McpConfig } from '../src/config.js';
import { TOOLS } from '../src/tools/index.js';
import { createFakeApi, REPO_API_ID } from './fake-api.js';
import type { FakeApiOverrides } from './fake-api.js';

// ---- Shared test harness -----------------------------------------------

/** A fresh, isolated dir per harness — never the real `~/.devdigest/mcp/run-index.json`. */
function tempRunIndexDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'mcp-principles-test-'));
}

/** Small-budget config so timeout/backoff scenarios run in real milliseconds, not the 240s default. */
function testConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  return {
    apiUrl: 'http://127.0.0.1:3001',
    runTimeoutMs: 5_000,
    pollIntervalMs: 5,
    maxFindings: 20,
    debug: undefined,
    apiToken: undefined,
    ...overrides,
  };
}

interface HarnessOptions {
  fakeApiOverrides?: FakeApiOverrides;
  configOverrides?: Partial<McpConfig>;
  /** Overrides the fetch the API client uses; defaults to the fake API's own stub. */
  fetchOverride?: typeof globalThis.fetch;
}

interface Harness {
  client: Client;
}

/**
 * Builds a real `createMcpServer(...)` wired to a fake (or deliberately
 * broken) API, connected to a real MCP `Client` over `InMemoryTransport` —
 * no network, no real filesystem outside a throwaway temp dir. Every test
 * below drives its scenario exclusively through `client.callTool`/
 * `client.listTools`, exactly what a real MCP client (Claude Code) would see.
 */
async function buildHarness(options: HarnessOptions = {}): Promise<Harness> {
  const fakeApi = createFakeApi(options.fakeApiOverrides);
  const config = testConfig(options.configOverrides);
  const api = createApiClient({ config, fetch: options.fetchOverride ?? fakeApi.fetch });
  const server = createMcpServer({ api, runIndex: createRunIndex({ dir: tempRunIndexDir() }), config });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'principles-test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client };
}

/** A `fetch` that fails every request the way a down/unreachable API process would. */
const UNREACHABLE_FETCH: typeof globalThis.fetch = async () => {
  throw new TypeError('fetch failed');
};

/** Wraps a fake API's `fetch` so only `POST /pulls/:id/review` (starting a run) returns HTTP 429. */
function rateLimitedOnStartReview(fakeApi: ReturnType<typeof createFakeApi>): typeof globalThis.fetch {
  return async (input, init) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : (input as Request).url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && /^\/pulls\/[^/]+\/review$/.test(url.pathname)) {
      return new Response(
        JSON.stringify({ error: { code: 'rate_limited', message: 'Too many review runs.' } }),
        { status: 429 },
      );
    }
    return fakeApi.fetch(input, init);
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asTextContent(content: unknown): { type: string; text: string } {
  return content as { type: string; text: string };
}

/**
 * `client.callTool()`'s real SDK return type is a union with a legacy
 * `{ toolResult: unknown }` compatibility branch that has no `content`
 * property — only every member's shared `[x: string]: unknown` index
 * signature covers it, so an un-narrowed property access on `.content` (or
 * `.structuredContent`) types as `unknown` rather than erroring. Every tool
 * in this package only ever returns the modern `{ content, isError?,
 * structuredContent? }` shape (`format.ts`'s `ok()`/`fail()`), so callers in
 * this file narrow to that shape once, right after awaiting, via this helper.
 */
interface SimpleToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<SimpleToolCallResult> {
  const result = await client.callTool({ name, arguments: args });
  return result as unknown as SimpleToolCallResult;
}

// =========================================================================
// Principle 1 — Outcome, not operation
// =========================================================================

describe('Principle 1 — outcome, not operation', () => {
  it('registers exactly the five documented tools, in the exact registry order (prompt-cache-stable)', () => {
    expect(TOOLS.map((tool) => tool.name)).toEqual([
      'devdigest_list_agents',
      'devdigest_run_agent_on_pr',
      'devdigest_get_findings',
      'devdigest_get_conventions',
      'devdigest_get_blast_radius',
    ]);
  });

  it('no tool name exposes a step-verb operation (create/start/poll/fetch_run/wait) instead of an outcome', () => {
    const stepVerbName = /^devdigest_(create|start|poll|fetch_run|wait)/;
    for (const tool of TOOLS) {
      expect(tool.name, tool.name).not.toMatch(stepVerbName);
    }
  });

  it("devdigest_run_agent_on_pr's description explicitly tells the model not to poll", () => {
    const tool = TOOLS.find((candidate) => candidate.name === 'devdigest_run_agent_on_pr');
    expect(tool).toBeDefined();
    expect(tool!.description.toLowerCase()).toContain('do not poll');
  });

  it(
    'a full run_agent_on_pr call against the fake API finishes in exactly ONE client.callTool ' +
      'round trip with finished findings — the model never orchestrates create -> wait -> collect',
    async () => {
      const { client } = await buildHarness({ fakeApiOverrides: { runStatuses: ['done'] } });
      const callToolSpy = vi.spyOn(client, 'callTool');

      const result = await client.callTool({
        name: 'devdigest_run_agent_on_pr',
        arguments: { repo: 'acme/api', pr: 482, agent_id: 'General' },
      });

      expect(callToolSpy).toHaveBeenCalledTimes(1);
      expect(result.isError).not.toBe(true);
      const payload = result.structuredContent as Record<string, unknown>;
      expect(payload.status).toBe('done');
      expect(Array.isArray(payload.findings)).toBe(true);
      expect((payload.findings as unknown[]).length).toBeGreaterThan(0);
    },
  );
});

// =========================================================================
// Principle 2 — Flat arguments
// =========================================================================

describe('Principle 2 — flat arguments', () => {
  const PRIMITIVE_TYPES = new Set(['string', 'integer', 'number', 'boolean']);
  let tools: Tool[];

  beforeAll(async () => {
    const { client } = await buildHarness();
    ({ tools } = await client.listTools());
  });

  it('discovers all five registered tools dynamically via the real tools/list result', () => {
    expect(tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());
  });

  it('every input property is a flat primitive (or an enum of primitives), never nested, always documented', () => {
    for (const tool of tools) {
      const inputSchema = tool.inputSchema as Record<string, unknown>;
      const properties = isPlainObject(inputSchema.properties) ? inputSchema.properties : {};

      for (const [propName, rawPropSchema] of Object.entries(properties)) {
        const label = `${tool.name}.${propName}`;
        expect(isPlainObject(rawPropSchema), label).toBe(true);
        const propSchema = rawPropSchema as Record<string, unknown>;

        // Flat: the declared JSON-Schema `type` is one of the four
        // primitives — enums (response_format, severity) still declare
        // `type: "string"` alongside their `enum` array, so this check
        // covers both plain fields and enum fields uniformly.
        expect(PRIMITIVE_TYPES.has(propSchema.type as string), label).toBe(true);

        // Never nested: no sub-object/sub-array shape, no schema composition.
        expect(propSchema.properties, label).toBeUndefined();
        expect(propSchema.items, label).toBeUndefined();
        expect('oneOf' in propSchema, label).toBe(false);
        expect('anyOf' in propSchema, label).toBe(false);
        expect('allOf' in propSchema, label).toBe(false);
        expect('$ref' in propSchema, label).toBe(false);

        // Always documented: tool search matches on argument descriptions,
        // so an undocumented argument is invisible to discovery.
        expect(typeof propSchema.description, label).toBe('string');
        expect((propSchema.description as string).length, label).toBeGreaterThan(0);
      }
    }
  });
});

// =========================================================================
// Principle 3 — Concise structured response
// =========================================================================

describe('Principle 3 — concise structured response', () => {
  /** Never allowed to leak into ANY tool response, concise or detailed. */
  const ALWAYS_FORBIDDEN = ['system_prompt', 'raw_output', 'review_id'];
  /** Allowed only in `response_format: "detailed"` — must not leak into the concise default. */
  const CONCISE_ONLY_FORBIDDEN = ['evidence_snippet'];
  const FINDINGS_TOOLS = new Set(['devdigest_run_agent_on_pr', 'devdigest_get_findings']);

  let client: Client;
  let runId: string;

  beforeAll(async () => {
    ({ client } = await buildHarness({ fakeApiOverrides: { runStatuses: ['done'] } }));

    // Seed a finished run so devdigest_get_findings has a real run_id to read.
    const started = await client.callTool({
      name: 'devdigest_run_agent_on_pr',
      arguments: { repo: 'acme/api', pr: 482, agent_id: 'General' },
    });
    runId = (started.structuredContent as Record<string, unknown>).run_id as string;
    expect(runId).toBeTruthy();
  });

  /**
   * Valid, concise (`response_format` omitted -> defaults to "concise")
   * arguments per tool. A tool with no entry here throws loudly rather than
   * being silently skipped by `it.each` below — this is the one place a
   * new (sixth) tool must be wired in by hand, since only ITS author knows
   * what a valid call looks like; the audit itself still runs over every
   * entry in `TOOLS` dynamically.
   */
  function argsForTool(toolName: string): Record<string, unknown> {
    switch (toolName) {
      case 'devdigest_list_agents':
        return {};
      case 'devdigest_run_agent_on_pr':
        return { repo: 'acme/api', pr: 482, agent_id: 'General' };
      case 'devdigest_get_findings':
        return { run_id: runId };
      case 'devdigest_get_conventions':
        return { repo: 'acme/api' };
      case 'devdigest_get_blast_radius':
        return { repo: 'acme/api', pr: 482 };
      default:
        throw new Error(
          `principles.test.ts (Principle 3): no fixture arguments registered for tool "${toolName}". ` +
            'A new tool must be wired into argsForTool() so the concise-response audit stays exhaustive.',
        );
    }
  }

  it.each(TOOLS.map((tool) => tool.name))(
    '%s: concise response is small, valid JSON, with no internal fields leaked',
    async (toolName) => {
      const result = await callTool(client, toolName, argsForTool(toolName));

      expect(result.isError, toolName).not.toBe(true);
      const text = asTextContent(result.content[0]).text;

      let parsed: unknown;
      expect(() => {
        parsed = JSON.parse(text);
      }, toolName).not.toThrow();

      // < 20000 chars (~5k tokens) even for the 47-finding fixture, truncated to 20.
      expect(text.length, toolName).toBeLessThan(20_000);

      for (const forbidden of [...ALWAYS_FORBIDDEN, ...CONCISE_ONLY_FORBIDDEN]) {
        expect(text, `${toolName} must not leak "${forbidden}"`).not.toContain(forbidden);
      }

      if (FINDINGS_TOOLS.has(toolName)) {
        const payload = parsed as Record<string, unknown>;
        expect(payload, toolName).toHaveProperty('verdict');
        expect(Array.isArray(payload.findings), toolName).toBe(true);
      }
    },
  );
});

// =========================================================================
// Principle 4 — Errors lead somewhere
// =========================================================================

describe('Principle 4 — errors lead somewhere', () => {
  /**
   * Any directive sentence naming a concrete next action: a `devdigest_*`
   * tool to call, the dev-server startup command, or a localhost URL to
   * open. Mirrors `errors.test.ts`'s own regex — deliberately, since both
   * files independently enforce the same design principle from two angles
   * (unit-level builder output vs. this file's live, end-to-end responses).
   */
  const DIRECTIVE_SENTENCE = /devdigest_[a-z_]+|\.\/scripts\/dev\.sh|http:\/\/localhost:3000/;

  async function callAndExpectError(
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const result = await callTool(client, name, args);
    expect(result.isError, `${name} — expected isError: true`).toBe(true);
    const text = asTextContent(result.content[0]).text;
    expect(text, `${name} — error text must name a concrete next action`).toMatch(DIRECTIVE_SENTENCE);
    return text;
  }

  async function callAndExpectNonError(
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ) {
    const result = await callTool(client, name, args);
    expect(result.isError, `${name} — expected NOT isError`).not.toBe(true);
    return result;
  }

  it('API unreachable -> isError with an actionable message', async () => {
    const { client } = await buildHarness({ fetchOverride: UNREACHABLE_FETCH });
    await callAndExpectError(client, 'devdigest_list_agents', {});
  });

  it('unknown repo -> isError naming the known repositories', async () => {
    const { client } = await buildHarness();
    await callAndExpectError(client, 'devdigest_run_agent_on_pr', {
      repo: 'x/y',
      pr: 1,
      agent_id: 'General',
    });
  });

  it('unknown PR -> isError naming the imported PR numbers', async () => {
    const { client } = await buildHarness();
    await callAndExpectError(client, 'devdigest_run_agent_on_pr', {
      repo: 'acme/api',
      pr: 999_999,
      agent_id: 'General',
    });
  });

  it('unknown agent -> isError pointing at devdigest_list_agents', async () => {
    const { client } = await buildHarness();
    await callAndExpectError(client, 'devdigest_run_agent_on_pr', {
      repo: 'acme/api',
      pr: 482,
      agent_id: 'NoSuchAgent',
    });
  });

  it('disabled agent -> isError pointing at the DevDigest UI', async () => {
    const { client } = await buildHarness();
    await callAndExpectError(client, 'devdigest_run_agent_on_pr', {
      repo: 'acme/api',
      pr: 482,
      agent_id: 'Legacy', // fixture agent with enabled: false
    });
  });

  it('HTTP 429 (rate limited) -> isError telling the model to wait and retry', async () => {
    const fakeApi = createFakeApi();
    const { client } = await buildHarness({ fetchOverride: rateLimitedOnStartReview(fakeApi) });
    await callAndExpectError(client, 'devdigest_run_agent_on_pr', {
      repo: 'acme/api',
      pr: 482,
      agent_id: 'General',
    });
  });

  it('unknown run_id -> isError pointing at devdigest_run_agent_on_pr (R6)', async () => {
    const { client } = await buildHarness();
    await callAndExpectError(client, 'devdigest_get_findings', { run_id: 'never-started' });
  });

  it('run ended failed -> isError with the run error plus a retry instruction', async () => {
    const { client } = await buildHarness({ fakeApiOverrides: { runStatuses: ['failed'] } });
    await callAndExpectError(client, 'devdigest_run_agent_on_pr', {
      repo: 'acme/api',
      pr: 482,
      agent_id: 'General',
    });
  });

  it('inverse: run_agent_on_pr budget timeout is NOT an error (R5)', async () => {
    const { client } = await buildHarness({
      fakeApiOverrides: { runStatuses: ['running'] }, // never reaches a terminal status
      configOverrides: { runTimeoutMs: 30, pollIntervalMs: 5 },
    });
    const result = await callAndExpectNonError(client, 'devdigest_run_agent_on_pr', {
      repo: 'acme/api',
      pr: 482,
      agent_id: 'General',
    });
    expect((result.structuredContent as Record<string, unknown>).status).toBe('running');
  });

  it('inverse: get_findings on a still-running run is NOT an error', async () => {
    const { client } = await buildHarness({
      fakeApiOverrides: { runStatuses: ['running'] },
      configOverrides: { runTimeoutMs: 30, pollIntervalMs: 5 },
    });
    const started = await client.callTool({
      name: 'devdigest_run_agent_on_pr',
      arguments: { repo: 'acme/api', pr: 482, agent_id: 'General' },
    });
    const runId = (started.structuredContent as Record<string, unknown>).run_id as string;

    const result = await callAndExpectNonError(client, 'devdigest_get_findings', { run_id: runId });
    expect((result.structuredContent as Record<string, unknown>).status).toBe('running');
  });

  it('inverse: an empty agent list is NOT an error', async () => {
    const { client } = await buildHarness({ fakeApiOverrides: { agents: [] } });
    const result = await callAndExpectNonError(client, 'devdigest_list_agents', {});
    expect((result.structuredContent as Record<string, unknown>).agents).toEqual([]);
  });

  it('inverse: no conventions extracted yet is NOT an error', async () => {
    const { client } = await buildHarness({
      fakeApiOverrides: { conventions: { [REPO_API_ID]: [] } },
    });
    const result = await callAndExpectNonError(client, 'devdigest_get_conventions', { repo: 'acme/api' });
    expect((result.structuredContent as Record<string, unknown>).conventions).toEqual([]);
  });

  it('inverse: devdigest_get_blast_radius for a known repo/PR is NOT an error', async () => {
    const { client } = await buildHarness();
    const result = await callAndExpectNonError(client, 'devdigest_get_blast_radius', {
      repo: 'acme/api',
      pr: 482,
    });
    expect((result.structuredContent as Record<string, unknown>).state).toBe('full');
  });
});
