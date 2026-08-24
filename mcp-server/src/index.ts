/**
 * stdio entry point (T18).
 *
 * !!! `stdout` IS THE JSON-RPC CHANNEL. Never write to it directly and never
 * !!! call the `console` object's "log"/"info"/"warn" methods anywhere in
 * !!! this process — HERE OR IN ANY IMPORTED MODULE. A single stray write to
 * !!! stdout corrupts the framed JSON-RPC stream and the server silently
 * !!! stops responding — this is the failure mode that looks like "the MCP
 * !!! server hangs". All diagnostics go to `stderr` (the "error" console
 * !!! method) only, and only when the caller wants them (e.g. gated behind
 * !!! `DEVDIGEST_MCP_DEBUG`).
 *
 * This file does exactly one thing: build the server via `createMcpServer()`
 * and connect a `StdioServerTransport`. No business logic lives here.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  const shutdown = (): void => {
    void server
      .close()
      .catch(() => {
        // best-effort close — the process is exiting either way.
      })
      .finally(() => {
        process.exit(0);
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`devdigest-mcp failed to start: ${message}\n`);
  process.exit(1);
});
