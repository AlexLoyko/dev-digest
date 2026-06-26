/**
 * devdigest_get_blast_radius — STUB tool.
 *
 * Accepted inputs are intentionally ignored. The handler never throws and
 * makes no HTTP calls. Returns a well-formed non-error result so the calling
 * agent treats the stub as a known limitation rather than a failure.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolOk } from '../format.js';

// ---------------------------------------------------------------------------
// Input schema — fields are accepted but ignored (STUB)
// ---------------------------------------------------------------------------

const inputSchema = {
  repo: z
    .string()
    .optional()
    .describe("(Accepted but ignored — stub.) Repository as 'owner/name'."),
  pr: z
    .number()
    .int()
    .optional()
    .describe('(Accepted but ignored — stub.) Pull request number.'),
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerGetBlastRadius(server: McpServer): void {
  server.registerTool(
    'devdigest_get_blast_radius',
    {
      description:
        "STUB — not yet implemented. Intended to map which files and symbols a PR's changes affect. Returns a placeholder, not real data. Do not rely on its output and do not block your report on it — note the limitation and continue.",
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    // Handler: no I/O, never throws — returns a fixed non-error payload
    (_args) => {
      return toolOk({
        status: 'not_implemented',
        message:
          'Blast radius not yet available — proceed without it, note the limitation.',
      });
    },
  );
}
