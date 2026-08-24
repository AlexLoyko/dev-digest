/**
 * Typed, non-secret configuration for @devdigest/mcp-server.
 *
 * This is the ONLY file in `mcp-server/` that reads `process.env`. Every other
 * module receives its configuration via `McpConfig`. Nothing read here is a
 * secret — `DEVDIGEST_API_TOKEN` is a future auth seam for a locally-trusted
 * API token, not a credential store (see `mcp-server/docs` / the L04 plan).
 *
 * `server/src/adapters/secrets.ts` documents `LocalSecretsProvider` as the
 * server package's only `process.env` reader — that rule is scoped to
 * `server/`. `mcp-server/` is a separate process with no `Container`, so it
 * has its own single env-reading seam, this file.
 */
import { z } from 'zod';

/**
 * Treats an empty string the same as "unset" before it reaches the Zod
 * schema, so `DEVDIGEST_MCP_RUN_TIMEOUT_MS=""` falls through to `.default()`
 * instead of failing `z.coerce.number()` on an empty string. This repo has
 * already hit this exact bug once — see commit 03d6e03, "treat empty
 * LOG_LEVEL as unset".
 */
function emptyStringAsUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

/**
 * Builds a positive-integer env-var schema with the given default. The
 * empty-string-as-unset preprocessing must wrap the schema that already
 * carries `.default()` — applying `.default()` on top of the preprocess
 * step does not work, because `ZodDefault` only substitutes its default
 * when the *raw* input is `undefined`, before preprocessing runs.
 */
function numericEnvVar(defaultValue: number) {
  return z.preprocess(
    emptyStringAsUndefined,
    z.coerce.number().int().positive().default(defaultValue),
  );
}

function requiredStringEnvVar(defaultValue: string) {
  return z.preprocess(emptyStringAsUndefined, z.string().default(defaultValue));
}

function optionalStringEnvVar() {
  return z.preprocess(emptyStringAsUndefined, z.string().optional());
}

const configSchema = z.object({
  apiUrl: requiredStringEnvVar('http://127.0.0.1:3001'),
  runTimeoutMs: numericEnvVar(240_000),
  pollIntervalMs: numericEnvVar(2_000),
  maxFindings: numericEnvVar(20),
  debug: optionalStringEnvVar(),
  apiToken: optionalStringEnvVar(),
});

export interface McpConfig {
  /** API base URL, e.g. http://127.0.0.1:3001 */
  apiUrl: string;
  /** Bounded wait budget for devdigest_run_agent_on_pr (R5), in milliseconds. */
  runTimeoutMs: number;
  /** Poll interval for the bounded wait loop, in milliseconds. */
  pollIntervalMs: number;
  /** Truncation threshold for findings returned per tool call. */
  maxFindings: number;
  /** Debug logging switch (logs to stderr only). Unset by default. */
  debug: string | undefined;
  /** Future auth seam — unused locally. Unset by default. */
  apiToken: string | undefined;
}

/**
 * Parses the six documented DevDigest MCP env vars into a typed, defaulted
 * `McpConfig`. Pass `env` explicitly in tests; defaults to `process.env`.
 *
 * Throws a Zod error naming the offending variable if a value cannot be
 * coerced to its expected type (e.g. a non-numeric `DEVDIGEST_MCP_MAX_FINDINGS`).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const result = configSchema.safeParse({
    apiUrl: env.DEVDIGEST_API_URL,
    runTimeoutMs: env.DEVDIGEST_MCP_RUN_TIMEOUT_MS,
    pollIntervalMs: env.DEVDIGEST_MCP_POLL_INTERVAL_MS,
    maxFindings: env.DEVDIGEST_MCP_MAX_FINDINGS,
    debug: env.DEVDIGEST_MCP_DEBUG,
    apiToken: env.DEVDIGEST_API_TOKEN,
  });

  if (!result.success) {
    const varNameByField: Record<string, string> = {
      apiUrl: 'DEVDIGEST_API_URL',
      runTimeoutMs: 'DEVDIGEST_MCP_RUN_TIMEOUT_MS',
      pollIntervalMs: 'DEVDIGEST_MCP_POLL_INTERVAL_MS',
      maxFindings: 'DEVDIGEST_MCP_MAX_FINDINGS',
      debug: 'DEVDIGEST_MCP_DEBUG',
      apiToken: 'DEVDIGEST_API_TOKEN',
    };
    const messages = result.error.issues.map((issue) => {
      const field = String(issue.path[0] ?? '');
      const varName = varNameByField[field] ?? field;
      return `${varName}: ${issue.message}`;
    });
    throw new Error(`Invalid DevDigest MCP configuration — ${messages.join('; ')}`);
  }

  // Rebuild as an explicit object literal: Zod's `.optional()` output type
  // marks `debug`/`apiToken` as an optional *key* (`debug?: string`), but
  // `McpConfig` declares them as always-present keys whose value may be
  // `undefined` (`debug: string | undefined`) — this is the shape that
  // satisfies both.
  return {
    apiUrl: result.data.apiUrl,
    runTimeoutMs: result.data.runTimeoutMs,
    pollIntervalMs: result.data.pollIntervalMs,
    maxFindings: result.data.maxFindings,
    debug: result.data.debug,
    apiToken: result.data.apiToken,
  };
}
