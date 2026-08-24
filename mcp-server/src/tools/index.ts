/**
 * The ordered `devdigest_*` tool registry (T16).
 *
 * `TOOLS` is a hand-written literal array — never built by scanning
 * `src/tools/` with `fs.readdir`/glob, because filesystem enumeration order
 * is not guaranteed to be stable across platforms (it can differ between
 * macOS/Linux/Windows and between filesystems). This array's order IS the
 * `tools/list` order (`server.ts` registers each entry in array order, and
 * the MCP SDK preserves registration order in its response), and that order
 * is load-bearing: the MCP spec (2026-07-28) recommends a deterministic
 * `tools/list` result specifically because clients and models that cache
 * tool definitions key that cache on the exact serialized list — reordering
 * the same five tools invalidates the cache for zero behavioural benefit.
 *
 * Order must not be "improved" (e.g. alphabetized) without updating this
 * comment and re-verifying prompt-cache behaviour; it deliberately follows
 * the documented "typical flow" from `instructions.ts`: list agents, run a
 * review, read its findings, then the two standalone readers.
 */
import { listAgentsTool } from './list-agents.js';
import { runAgentOnPrTool } from './run-agent-on-pr.js';
import { getFindingsTool } from './get-findings.js';
import { getConventionsTool } from './get-conventions.js';
import { getBlastRadiusTool } from './get-blast-radius.js';
import type { ToolDef } from './types.js';

export const TOOLS: readonly ToolDef[] = [
  listAgentsTool,
  runAgentOnPrTool,
  getFindingsTool,
  getConventionsTool,
  getBlastRadiusTool,
];
