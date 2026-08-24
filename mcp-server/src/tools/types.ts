/**
 * Shared type contract for every `devdigest_*` tool (T11–T15) and for the
 * registry that assembles them (T16/T17).
 *
 * This file is intentionally decoupled from the concrete adapters it will
 * eventually be wired to (`api-client.ts` / T5, `resolve.ts` / T7,
 * `run-index.ts` / T8) because those land concurrently with this task.
 * `ToolDeps` therefore types those three fields as `unknown` placeholders —
 * each tool file narrows the field it actually uses via a local cast/import
 * once its dependency lands, rather than this file importing modules that
 * may not exist yet at typecheck time.
 */
import type { ZodRawShape, z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpConfig } from '../config.js';

/** The MCP result shape every tool handler (and `ok()`/`fail()` in `format.ts`) returns. */
export type ToolResult = CallToolResult;

/**
 * `ToolAnnotations` (R15) — the spec's hint fields a tool declares about its
 * own behaviour (read-only, destructive, idempotent, open-world). These are
 * hints for the client's UI/permission prompts only, never a security
 * boundary (see the plan's "Tool annotations (R15)" section) — the real
 * guard is that reader tools issue only `GET` requests server-side.
 *
 * Declared locally (rather than re-exported from the SDK's own
 * `ToolAnnotations`) so this contract states exactly the four fields this
 * project uses, independent of SDK version churn.
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Dependencies injected into every tool handler. `api`, `resolver` and
 * `runIndex` are typed `unknown` here on purpose (see file header) — each
 * consuming tool file imports the concrete type from its own dependency's
 * module and narrows via a local cast. `config` is safe to type precisely:
 * `config.ts` is already implemented and owned by no concurrent task.
 */
export interface ToolDeps {
  /** `createApiClient(...)` return value from `api-client.ts` (T5). */
  api: unknown;
  /** `createResolver(...)` return value from `resolve.ts` (T7). */
  resolver: unknown;
  /** `createRunIndex(...)` return value from `run-index.ts` (T8). */
  runIndex: unknown;
  config: McpConfig;
  /**
   * Injected clock for `wait.ts`'s bounded-wait loop (forwarded by
   * `src/flows/run-review.ts` into `waitForRun(...)`). Optional so existing
   * `ToolDeps` literals built without it keep compiling; `createMcpServer`
   * (`server.ts`) always fills this in with real `Date.now` when the caller
   * doesn't override it — production behaviour is unchanged either way.
   * Tests (e.g. `test/flow.test.ts`'s R5 scenario) inject a fake clock here
   * so the wait loop's full budget elapses without any real wall-clock time.
   */
  now?: () => number;
  /**
   * Injected sleep for `wait.ts`'s bounded-wait loop (forwarded the same way
   * as `now` above). Optional for the same reason; `createMcpServer` defaults
   * it to a real `setTimeout`-backed sleep.
   */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * One `devdigest_*` tool. `inputShape` and `outputSchema` are both
 * `ZodRawShape` (a plain object of Zod schemas, e.g. `{ repo: z.string() }`)
 * — the same shape the MCP SDK's `server.registerTool(name, { inputSchema,
 * outputSchema, annotations }, handler)` expects for both fields (R10a:
 * every tool declares an `outputSchema`, so its response can be returned as
 * `structuredContent` and validated by SDK-aware clients).
 */
export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputShape: Shape;
  outputSchema: ZodRawShape;
  annotations: ToolAnnotations;
  handler(args: z.infer<z.ZodObject<Shape>>, deps: ToolDeps): Promise<ToolResult>;
}
