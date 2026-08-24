/**
 * End-to-end tool flow over `InMemoryTransport` (T22).
 *
 * This is the ONLY test in `mcp-server/` that assembles the real server
 * (`createMcpServer`, T17) and drives it through a real MCP `Client`
 * (`@modelcontextprotocol/sdk`), over `InMemoryTransport.createLinkedPair()`
 * — never real stdio. Every other test in this package calls a tool's
 * `handler()` directly or stubs `fetch`; this file is where the *wiring*
 * itself (registry order, dependency resolution, schema round-trips through
 * the SDK's own Zod→JSON-Schema conversion, `_meta`, annotations) gets
 * proven, exactly as a Claude Code session driving this server would
 * experience it.
 *
 * Covers, walking the documented happy path exactly as a user would:
 *  - `devdigest_list_agents` -> pick an enabled agent -> `devdigest_run_agent_on_pr`
 *    -> `devdigest_get_findings` (re-read + severity filter) -> `devdigest_get_conventions`
 *    -> `devdigest_get_blast_radius`.
 *  - R5 — a run that never terminates within the wait budget returns the
 *    non-error `{status: "running", run_id, next_step}` envelope, and that
 *    `run_id` then works end to end with `devdigest_get_findings` once the
 *    fake API reports the run as done.
 *  - R6 — `devdigest_get_findings` with a `run_id` this server never issued
 *    is `isError: true`, naming `devdigest_run_agent_on_pr` as the fix.
 *  - R11 — findings and conventions the CLIENT receives carry the
 *    `<untrusted source="...">` wrapper (asserted on the wire value, not on
 *    `format.ts` in isolation, so a future formatter refactor that drops the
 *    wrapping fails here too).
 *  - R10a — every tool's structuredContent (success case) validates against
 *    its own real, SDK-serialized `outputSchema` via Ajv (2020-12); every
 *    tool's `isError` case still carries an actionable `TextContent` block.
 *
 * Timing: most scenarios here use tiny-but-real `setTimeout`-backed sleeps —
 * `fastConfigEnv()`'s single-digit-millisecond `DEVDIGEST_MCP_POLL_INTERVAL_MS`
 * keeps them well under a second even though the wait loop's real timer
 * fires. The R5 timeout scenario is the one case where that would be a
 * flakiness vector (it must reach the FULL budget, i.e. exhaust every real
 * sleep in the loop, to prove the timeout path at all) — as of this
 * hardening pass, `wait.ts`'s injectable `now`/`sleep` are threaded all the
 * way through `ToolDeps` (`src/tools/types.ts`) and `createMcpServer()`
 * (`server.ts`) via `src/flows/run-review.ts`, so that one test instead
 * injects a fake clock/sleep pair through `createMcpServer({ now, sleep })`
 * — the whole budget elapses on the microtask queue, never a real timer.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/server.js';
import { createApiClient } from '../src/api-client.js';
import { createRunIndex } from '../src/run-index.js';
import { loadConfig } from '../src/config.js';
import type { McpConfig } from '../src/config.js';
import {
  createFakeApi,
  PR_482_ID,
  REPO_API_ID,
  type FakeApi,
  type FakeApiOverrides,
} from './fake-api.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * `pollIntervalMs` is always tiny (5ms) so the wait loop's real
 * `setTimeout`-backed sleeps cost single-digit milliseconds regardless of
 * how many polls a scenario needs — see the file header's "Timing" note.
 * `runTimeoutMs` is overridable per test: a few seconds for the happy path
 * (comfortably above the 3 scripted polls), a handful of milliseconds for
 * the R5 timeout test.
 */
function fastConfigEnv(runTimeoutMs: number): NodeJS.ProcessEnv {
  return {
    DEVDIGEST_API_URL: 'http://127.0.0.1:3001',
    DEVDIGEST_MCP_RUN_TIMEOUT_MS: String(runTimeoutMs),
    DEVDIGEST_MCP_POLL_INTERVAL_MS: '5',
  };
}

/**
 * A deterministic fake clock + sleep for the R5 timeout scenario, injected
 * through `createMcpServer({ now, sleep, ... })` (`ToolDeps`, threaded into
 * `wait.ts`'s `waitForRun()` by `src/flows/run-review.ts`). `sleep(ms)`
 * advances the virtual clock by exactly `ms` and resolves on the next
 * microtask — no real timer is ever started, so the wait loop can exhaust a
 * realistic, non-tiny budget (tens of virtual seconds, at a realistic poll
 * interval) in the time it takes the promise chain to unwind, with zero real
 * elapsed time and zero risk of racing an actual `setTimeout`.
 */
function createFakeClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let elapsed = 0;
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms;
      await Promise.resolve();
    },
  };
}

/**
 * `client.callTool()`'s real return type is a large Zod-inferred union
 * (plain `CallToolResult` or, for task-augmented calls, a `CreateTaskResult`
 * shape with no `content`/`structuredContent` at all) — none of the five
 * `devdigest_*` tools use task augmentation, so every call in this file
 * resolves to the plain shape. Declared narrowly here (rather than importing
 * the SDK's own `CallToolResult` from `types.js`, which is not assignable
 * from `callTool()`'s broader inferred return type without an intermediate
 * cast) so every call site gets one, centralized cast instead of repeating
 * `as unknown as ...` throughout the file.
 */
interface ToolCallResult {
  isError?: boolean;
  structuredContent?: unknown;
  content: { type: string; text: string }[];
}

async function callTool(
  client: Client,
  params: { name: string; arguments?: Record<string, unknown> },
): Promise<ToolCallResult> {
  const result = await client.callTool(params);
  return result as unknown as ToolCallResult;
}

interface Harness {
  client: Client;
  fakeApi: FakeApi;
  tools: Tool[];
}

const cleanupDirs: string[] = [];

/**
 * Assembles the REAL server (`createMcpServer`) wired to a fake HTTP layer,
 * connects a real `Client` over `InMemoryTransport`, and calls `listTools()`
 * once — this both hands back the real, SDK-serialized `Tool[]` (needed for
 * the Ajv outputSchema checks below) and populates the SDK client's own
 * internal output-schema validator cache, so `client.callTool()` throws on
 * its own if a handler's `structuredContent` doesn't match its declared
 * `outputSchema` — a second, independent safety net on top of this file's
 * explicit Ajv assertions.
 */
async function setup(
  runTimeoutMs = 5000,
  apiOverrides?: FakeApiOverrides,
): Promise<Harness> {
  const config = loadConfig(fastConfigEnv(runTimeoutMs));
  const fakeApi = createFakeApi(apiOverrides);
  const api = createApiClient({ config, fetch: fakeApi.fetch });
  const runIndexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devdigest-mcp-flow-test-'));
  cleanupDirs.push(runIndexDir);
  const runIndex = createRunIndex({ dir: runIndexDir });

  const server = createMcpServer({ api, config, runIndex });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'flow-test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const { tools } = await client.listTools();
  return { client, fakeApi, tools };
}

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R10a — Ajv (2020-12) validation of the real, SDK-serialized outputSchema
// ---------------------------------------------------------------------------

const ajv = new Ajv2020({ strict: false, allErrors: true });
const validators = new Map<string, ValidateFunction>();

/**
 * Compiles (and caches) an Ajv validator for a tool's real `outputSchema`,
 * as reported by `client.listTools()` — never the hand-written Zod shape —
 * so a schema that drifts from what the SDK actually serializes fails here.
 *
 * The SDK's Zod→JSON-Schema conversion stamps a draft-07 `$schema` marker
 * (`http://json-schema.org/draft-07/schema#`) even though every keyword it
 * actually emits for these tools (`type`, `properties`, `items`, `enum`,
 * `const`, `required`, `additionalProperties`) is valid under 2020-12 too —
 * `Ajv2020` just doesn't ship the draft-07 meta-schema to resolve that `$ref`
 * against, so it must be stripped before compiling (verified empirically:
 * compiling the untouched schema fails with `no schema with key or ref
 * "http://json-schema.org/draft-07/schema#"`; stripping `$schema` and
 * recompiling with `Ajv2020` succeeds for all five tools).
 */
function outputValidatorFor(tools: Tool[], name: string): ValidateFunction {
  const cached = validators.get(name);
  if (cached) {
    return cached;
  }
  const tool = tools.find((t) => t.name === name);
  if (!tool?.outputSchema) {
    throw new Error(`No outputSchema found for ${name} in the real tools/list result`);
  }
  const schema = { ...(tool.outputSchema as Record<string, unknown>) };
  delete schema.$schema;
  const validator = ajv.compile(schema);
  validators.set(name, validator);
  return validator;
}

/**
 * R10a, success branch: `structuredContent` is present, the serialized
 * `TextContent` block round-trips to the exact same value, and
 * `structuredContent` validates against the tool's real `outputSchema`.
 */
function expectSuccessConformsToSchema(tools: Tool[], name: string, result: ToolCallResult): void {
  expect(result.isError).toBeUndefined();
  expect(result.structuredContent).toBeDefined();

  const textBlock = result.content[0] as { type: string; text: string };
  expect(textBlock.type).toBe('text');
  expect(JSON.parse(textBlock.text)).toEqual(result.structuredContent);

  const validate = outputValidatorFor(tools, name);
  const valid = validate(result.structuredContent);
  expect(valid, ajv.errorsText(validate.errors ?? [])).toBe(true);
}

/**
 * R10a, error branch: `isError: true` with an actionable `TextContent`
 * block. `fail()` (`format.ts`) never sets `structuredContent` on an error
 * result — matching the MCP spec's own carve-out (the SDK's client-side
 * validator only requires `structuredContent` "unless it's an error",
 * verified against `@modelcontextprotocol/sdk@1.30.0`'s `callTool()`) — so
 * this helper asserts that absence explicitly rather than skipping the
 * check.
 */
function expectActionableError(result: ToolCallResult, mustContain: string): void {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  const textBlock = result.content[0] as { type: string; text: string };
  expect(textBlock.type).toBe('text');
  expect(textBlock.text).toContain(mustContain);
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('devdigest MCP server — end-to-end flow (T22)', () => {
  it(
    'happy path: list_agents -> run_agent_on_pr -> get_findings -> get_conventions -> get_blast_radius',
    async () => {
      const { client, fakeApi, tools } = await setup();

      // 1. devdigest_list_agents -> pick an enabled agent's id.
      const listResult = await callTool(client, { name: 'devdigest_list_agents', arguments: {} });
      expectSuccessConformsToSchema(tools, 'devdigest_list_agents', listResult);
      const agents = (listResult.structuredContent as { agents: { id: string; name: string; enabled: boolean }[] })
        .agents;
      const enabledAgent = agents.find((agent) => agent.enabled);
      expect(enabledAgent).toBeDefined();
      expect(enabledAgent!.name).toBe('General');

      // 2. devdigest_run_agent_on_pr("acme/api", 482, <that id>) -> scripted
      // status running, running, done -> findings returned.
      const runResult = await callTool(client, {
        name: 'devdigest_run_agent_on_pr',
        arguments: {
          repo: 'acme/api',
          pr: 482,
          agent_id: enabledAgent!.id,
          response_format: 'detailed',
        },
      });
      expectSuccessConformsToSchema(tools, 'devdigest_run_agent_on_pr', runResult);
      const runPayload = runResult.structuredContent as Record<string, unknown>;
      expect(runPayload.status).toBe('done');
      expect(runPayload.verdict).toBe('request_changes');
      expect(runPayload.findings_total).toBe(47);
      const runFindings = runPayload.findings as { title: string; why?: string }[];
      expect(runFindings.length).toBeGreaterThan(0);

      // R11: prompt-injection hardening reaches the CLIENT, not just format.ts.
      for (const finding of runFindings) {
        expect(finding.title).toMatch(/^<untrusted source="finding-title">\n/);
        expect(finding.title).toContain('</untrusted>');
        expect(finding.why).toMatch(/^<untrusted source="finding-rationale">\n/);
      }

      const runId = runPayload.run_id as string;
      expect(typeof runId).toBe('string');

      // 3. devdigest_get_findings(<run_id>) — same run, re-read and
      // severity-filtered (5 of the 47 fixture findings are CRITICAL).
      const findingsResult = await callTool(client, {
        name: 'devdigest_get_findings',
        arguments: { run_id: runId, severity: 'critical' },
      });
      expectSuccessConformsToSchema(tools, 'devdigest_get_findings', findingsResult);
      const findingsPayload = findingsResult.structuredContent as Record<string, unknown>;
      expect(findingsPayload.status).toBe('done');
      expect(findingsPayload.run_id).toBe(runId);
      expect(findingsPayload.severity_filter).toBe('critical');
      expect(findingsPayload.findings_total).toBe(5);
      const narrowedFindings = findingsPayload.findings as { severity: string }[];
      expect(narrowedFindings.length).toBe(5);
      expect(narrowedFindings.every((finding) => finding.severity === 'CRITICAL')).toBe(true);

      // devdigest_get_conventions("acme/api")
      const conventionsResult = await callTool(client, {
        name: 'devdigest_get_conventions',
        arguments: { repo: 'acme/api' },
      });
      expectSuccessConformsToSchema(tools, 'devdigest_get_conventions', conventionsResult);
      const conventionsPayload = conventionsResult.structuredContent as Record<string, unknown>;
      expect(conventionsPayload.repo).toBe('acme/api');
      const rules = conventionsPayload.conventions as { rule: string }[];
      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.rule).toMatch(/^<untrusted source="convention-rule">\n/);
      }

      // devdigest_get_blast_radius("acme/api", 482) — real impact-map data
      // from the fake API's blast fixture (`test/fake-api.ts::buildBlastRadius`).
      const blastResult = await callTool(client, {
        name: 'devdigest_get_blast_radius',
        arguments: { repo: 'acme/api', pr: 482 },
      });
      expectSuccessConformsToSchema(tools, 'devdigest_get_blast_radius', blastResult);
      const blastPayload = blastResult.structuredContent as Record<string, unknown>;
      expect(blastPayload.repo).toBe('acme/api');
      expect(blastPayload.pr).toBe(482);
      expect(blastPayload.state).toBe('full');
      const blastSymbols = blastPayload.symbols as Array<Record<string, unknown>>;
      expect(blastSymbols.length).toBeGreaterThan(0);
      expect(blastSymbols.some((s) => s.name === 'getContext')).toBe(true);

      // Exactly the requests this walkthrough should have issued, no extras:
      // list_agents + run_agent_on_pr's resolve/start/poll/collect + a
      // second get_findings poll/collect (its own fresh listRuns/listReviews,
      // R6's "no repo+PR fallback" design) + get_conventions + get_blast_radius's
      // own blast fetch. Resolver caching (60s TTL) means get_blast_radius's
      // repo+PR resolution never re-hits the fake API — its own repo/pulls
      // lookups were already cached by step 2.
      const calledPaths = fakeApi.calls.map((call) => `${call.method} ${call.path}`);
      expect(calledPaths).toEqual([
        'GET /agents',
        'GET /repos',
        `GET /repos/${REPO_API_ID}/pulls`,
        'GET /agents',
        `POST /pulls/${PR_482_ID}/review`,
        `GET /pulls/${PR_482_ID}/runs`,
        `GET /pulls/${PR_482_ID}/runs`,
        `GET /pulls/${PR_482_ID}/runs`,
        `GET /pulls/${PR_482_ID}/reviews`,
        `GET /pulls/${PR_482_ID}/runs`,
        `GET /pulls/${PR_482_ID}/reviews`,
        `GET /repos/${REPO_API_ID}/conventions`,
        `GET /pulls/${PR_482_ID}/blast`,
      ]);
    },
  );

  // -------------------------------------------------------------------------
  // R5 — bounded-wait timeout hands off a usable run_id
  // -------------------------------------------------------------------------

  it('R5: a run that never terminates within the budget hands off a usable run_id to get_findings', async () => {
    // A realistic (non-tiny) budget and poll interval — the fake clock/sleep
    // below make the wait loop exhaust this virtually, with zero real
    // elapsed time, rather than needing a tiny real-millisecond config to
    // keep the test fast. `setRunStatus(['running'])` — a single-element
    // script — means every poll (however many happen before the budget
    // elapses) keeps reporting 'running', so the wait can never resolve to
    // 'done' on its own.
    const config: McpConfig = {
      apiUrl: 'http://127.0.0.1:3001',
      runTimeoutMs: 20_000,
      pollIntervalMs: 2_000,
      maxFindings: 20,
      debug: undefined,
      apiToken: undefined,
    };
    const fakeApi = createFakeApi();
    fakeApi.setRunStatus(['running']);
    const api = createApiClient({ config, fetch: fakeApi.fetch });
    const runIndexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devdigest-mcp-flow-test-'));
    cleanupDirs.push(runIndexDir);
    const runIndex = createRunIndex({ dir: runIndexDir });
    const { now, sleep } = createFakeClock();

    const server = createMcpServer({ api, config, runIndex, now, sleep });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'flow-test-client-r5', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const { tools } = await client.listTools();

    const runResult = await callTool(client, {
      name: 'devdigest_run_agent_on_pr',
      arguments: { repo: 'acme/api', pr: 482, agent_id: 'General' },
    });

    // Non-error (R5) — a bounded-wait timeout is an expected outcome, not a
    // failure — and it validates against run_agent_on_pr's own outputSchema
    // like any other successful call.
    expectSuccessConformsToSchema(tools, 'devdigest_run_agent_on_pr', runResult);
    const runPayload = runResult.structuredContent as Record<string, unknown>;
    expect(runPayload.status).toBe('running');
    expect(runPayload.next_step).toContain('devdigest_get_findings');
    const runId = runPayload.run_id as string;
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);

    // Prove the hand-off actually works end to end: the fake API now reports
    // the SAME run_id as done, and devdigest_get_findings — called with only
    // the run_id this response handed back — returns the finished findings.
    fakeApi.setRunStatus(['done']);
    const findingsResult = await callTool(client, {
      name: 'devdigest_get_findings',
      arguments: { run_id: runId },
    });
    expectSuccessConformsToSchema(tools, 'devdigest_get_findings', findingsResult);
    const findingsPayload = findingsResult.structuredContent as Record<string, unknown>;
    expect(findingsPayload.status).toBe('done');
    expect(findingsPayload.run_id).toBe(runId);
    expect(findingsPayload.findings_total).toBe(47);
  });

  // -------------------------------------------------------------------------
  // R6 — get_findings takes only run_id; an unknown one is an honest error
  // -------------------------------------------------------------------------

  it('R6: get_findings with a run_id this server never issued is isError, naming run_agent_on_pr', async () => {
    const { client, tools } = await setup();

    const result = await callTool(client, {
      name: 'devdigest_get_findings',
      arguments: { run_id: 'a-run-id-this-server-never-started' },
    });

    expectActionableError(result, 'devdigest_run_agent_on_pr');
    // Sanity: an isError result for a tool WITH an outputSchema does not
    // trip the SDK client's own automatic output-schema validation (it only
    // applies to the structuredContent branch — see expectActionableError's
    // doc comment) — reaching this line at all proves callTool() didn't throw.
    void tools;
  });

  // -------------------------------------------------------------------------
  // R10a — isError branch, one representative failure per tool
  // -------------------------------------------------------------------------

  it('R10a: every tool still returns an actionable isError result on failure, never a bare structuredContent-less crash', async () => {
    const { client: client1 } = await setup();
    expectActionableError(
      await callTool(client1, {
        name: 'devdigest_run_agent_on_pr',
        arguments: { repo: 'nope/nope', pr: 1, agent_id: 'General' },
      }),
      'not in DevDigest',
    );

    const { client: client2 } = await setup();
    expectActionableError(
      await callTool(client2, {
        name: 'devdigest_get_conventions',
        arguments: { repo: 'nope/nope' },
      }),
      'not in DevDigest',
    );

    const { client: client3 } = await setup();
    expectActionableError(
      await callTool(client3, {
        name: 'devdigest_get_blast_radius',
        arguments: { repo: 'nope/nope', pr: 1 },
      }),
      'not in DevDigest',
    );

    // devdigest_list_agents has no arguments to make "unknown" — its only
    // failure mode is the API itself being unreachable.
    const config = loadConfig(fastConfigEnv(5000));
    const unreachableFetch: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const api = createApiClient({ config, fetch: unreachableFetch });
    const server4 = createMcpServer({ api, config });
    const [clientTransport4, serverTransport4] = InMemoryTransport.createLinkedPair();
    const client4 = new Client({ name: 'flow-test-client-4', version: '0.0.0' });
    await Promise.all([client4.connect(clientTransport4), server4.connect(serverTransport4)]);
    await client4.listTools();
    expectActionableError(
      await callTool(client4, { name: 'devdigest_list_agents', arguments: {} }),
      './scripts/dev.sh',
    );
  });

  // -------------------------------------------------------------------------
  // Bonus finding: unknown tool name on the pinned SDK version
  // -------------------------------------------------------------------------

  /**
   * The L04 plan's T22 action bullet expected `client.callTool({name:
   * 'devdigest_nope'})` to reject at the JSON-RPC PROTOCOL level. On the
   * pinned `@modelcontextprotocol/sdk@1.30.0`, it does not: `McpServer`'s
   * `CallToolRequestSchema` handler (`server/mcp.js`) catches its own
   * internal `Tool ${name} not found` `McpError` (except for the unrelated
   * `UrlElicitationRequired` code) and converts it into an ordinary
   * `CallToolResult` with `isError: true` — the SAME shape as a domain-level
   * failure like an unknown repo, just with SDK-generated wording instead of
   * one of this package's `errors.ts` builders. `client.callTool()` resolves
   * normally; it does not throw. Verified directly against the real
   * assembled server (not asserted from documentation) — this is exactly
   * the kind of plan/SDK-version mismatch this end-to-end test exists to
   * catch, so it is asserted here rather than silently reverted to the
   * plan's original (incorrect, for this SDK version) expectation.
   */
  it('an unknown tool name comes back as an ordinary isError result on this SDK version, not a protocol-level rejection', async () => {
    const { client } = await setup();

    const result = await callTool(client, { name: 'devdigest_nope', arguments: {} });

    expect(result.isError).toBe(true);
    const textBlock = result.content[0] as { type: string; text: string };
    expect(textBlock.text).toContain('devdigest_nope');
  });
});
