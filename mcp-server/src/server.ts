/**
 * `createMcpServer(deps)` — the server assembly factory (T17).
 *
 * Wires the five `TOOLS` (T16, registered in array order — `tools/list`
 * order is registration order, and that order must never be re-sorted, see
 * `tools/index.ts`) onto a real `McpServer`, with `INSTRUCTIONS` (T17)
 * attached as the server-level `instructions`.
 *
 * Every tool handler runs inside exactly ONE error boundary, right here —
 * not per-tool. Per-tool try/catch was rejected: letting a handler's throw
 * escape to the SDK turns it into a JSON-RPC *protocol* error (the MCP spec
 * reserves that channel for "unknown tool" / malformed-request cases), which
 * is not what a model calling `devdigest_run_agent_on_pr` against, say, an
 * unreachable API should see — it should see an ordinary `isError: true`
 * result with actionable text it can act on (retry, ask the user to start
 * the API, pick a different agent_id, etc). A `ToolError` (the expected,
 * already-actionable failure shape used throughout this package) becomes
 * `fail(err.text)` verbatim; anything else (a genuine bug, or an adapter
 * throwing a bare `Error`) becomes a generic-but-still-actionable message
 * rather than being swallowed or left to crash the process.
 *
 * `deps` is `Partial<ToolDeps>` purely so tests can substitute a subset —
 * typically just `api` (pointed at `test/fake-api.ts`) — while every field
 * left unset is built the normal way from `loadConfig()`. The `resolver` is
 * always derived from the *effective* `api` (the caller's override if given,
 * the real HTTP client otherwise) rather than built independently, so
 * `createMcpServer({ api: fakeApi })` alone is enough to make every tool
 * that resolves a repo/PR/agent use the fake end to end.
 *
 * `now`/`sleep` follow the same override-or-default rule: unset, they
 * resolve to real `Date.now`/a real `setTimeout`-backed sleep (production is
 * unchanged); a caller (e.g. a fake-clock test) can override either
 * independently and it flows through `resolveDeps()` -> `ToolDeps` ->
 * `src/flows/run-review.ts` -> `waitForRun()` (`wait.ts`), so a test can
 * exercise the full bounded-wait budget without starting a single real
 * timer.
 */
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createApiClient, type ApiClient } from './api-client.js';
import { loadConfig } from './config.js';
import { ToolError } from './errors.js';
import { INSTRUCTIONS } from './instructions.js';
import { createResolver, type Resolver } from './resolve.js';
import { createRunIndex, type RunIndex } from './run-index.js';
import { fail } from './format.js';
import { TOOLS } from './tools/index.js';
import type { ToolDeps } from './tools/types.js';

const SERVER_NAME = 'devdigest';
/** Tracks `package.json`'s `version` field — update both together. */
const SERVER_VERSION = '0.0.0';

/**
 * `run-index.ts`'s own header comment documents this exact path as "by
 * convention `~/.devdigest/mcp/run-index.json`" and leaves the directory
 * choice to the caller — this is that one caller-owned decision.
 */
function defaultRunIndexDir(): string {
  return path.join(os.homedir(), '.devdigest', 'mcp');
}

/**
 * Tool names whose responses can legitimately be large (a full findings
 * list). Optionally hinting `anthropic/maxResultSizeChars` lets a supporting
 * client raise its own truncation ceiling for just these two, rather than
 * uniformly for all five. Verified against the pinned SDK (`registerTool`'s
 * config type includes an optional `_meta?: Record<string, unknown>`,
 * `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:156`) —
 * if a future SDK upgrade ever rejects unknown `_meta` keys, drop this and
 * note it in `mcp-server/insights/gotchas.md`.
 */
const LARGE_RESULT_TOOLS = new Set(['devdigest_run_agent_on_pr', 'devdigest_get_findings']);
const LARGE_RESULT_META = { 'anthropic/maxResultSizeChars': 60_000 };

/**
 * Real `setTimeout`-backed sleep — `ToolDeps.sleep`'s production default.
 * Mirrors `wait.ts`'s own (unexported) `defaultSleep`; duplicated rather than
 * imported because `wait.ts`'s injection contract already defaults `sleep`
 * internally when it receives `undefined` — this copy exists solely so
 * `ToolDeps` (and therefore `resolveDeps()` below) can hand every tool a
 * concrete, always-present function instead of leaving the field `undefined`
 * for handlers that might read it directly.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Builds any `ToolDeps` field the caller did not override, from `loadConfig()`. */
function resolveDeps(overrides: Partial<ToolDeps>): ToolDeps {
  const config = overrides.config ?? loadConfig();
  const api = (overrides.api ?? createApiClient({ config })) as ApiClient;
  const resolver = (overrides.resolver ?? createResolver(api)) as Resolver;
  const runIndex = (overrides.runIndex ??
    createRunIndex({ dir: defaultRunIndexDir(), debug: Boolean(config.debug) })) as RunIndex;
  // Production default: real Date.now / a real setTimeout-backed sleep — see
  // types.ts's ToolDeps doc comment. Tests (e.g. test/flow.test.ts's R5
  // scenario) override both with a fake clock via `createMcpServer({ now,
  // sleep, ... })` so wait.ts's bounded-wait loop never starts a real timer.
  const now = overrides.now ?? Date.now;
  const sleep = overrides.sleep ?? defaultSleep;

  return { api, resolver, runIndex, config, now, sleep };
}

/** The one error boundary every tool call runs through — see file header. */
async function invokeTool(
  tool: (typeof TOOLS)[number],
  args: Record<string, unknown>,
  deps: ToolDeps,
): Promise<CallToolResult> {
  try {
    return await tool.handler(args, deps);
  } catch (err) {
    if (err instanceof ToolError) {
      return fail(err.text);
    }
    const message = err instanceof Error ? err.message : String(err);
    return fail(
      `${message}. The DevDigest API may be misconfigured; ask the user to check ./scripts/dev.sh output, then retry.`,
    );
  }
}

export function createMcpServer(deps: Partial<ToolDeps> = {}): McpServer {
  const fullDeps = resolveDeps(deps);

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputShape,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
        ...(LARGE_RESULT_TOOLS.has(tool.name) ? { _meta: LARGE_RESULT_META } : {}),
      },
      (args) => invokeTool(tool, args as Record<string, unknown>, fullDeps),
    );
  }

  return server;
}
