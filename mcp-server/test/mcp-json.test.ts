/**
 * Hygiene test for the committed `.mcp.json` at the repo root (one level
 * above this package). This file is what an MCP host actually reads to
 * launch `devdigest` as a project-scope stdio server — a typo, a stray
 * secret, or a "helpful" `alwaysLoad` addition here breaks or leaks in
 * production, and none of that would be caught by any other test in this
 * package (they all run with cwd = `mcp-server/`, not the repo root).
 *
 * Repo-root location is resolved via `fileURLToPath` walk-up from this
 * file's own path rather than `process.cwd()`, so the test is correct
 * whether vitest is invoked from `mcp-server/` (the documented way) or the
 * repo root.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// mcp-server/test/ -> mcp-server/ -> repo root
const repoRoot = resolve(here, '..', '..');
const mcpJsonPath = join(repoRoot, '.mcp.json');

const raw = readFileSync(mcpJsonPath, 'utf-8');
const parsed = JSON.parse(raw) as {
  mcpServers?: Record<string, Record<string, unknown>>;
};

describe('.mcp.json (repo root, project scope)', () => {
  it('parses as JSON and declares exactly one server, keyed "devdigest"', () => {
    expect(parsed.mcpServers).toBeDefined();
    const serverKeys = Object.keys(parsed.mcpServers ?? {});
    expect(serverKeys).toEqual(['devdigest']);
  });

  it('uses the stdio transport', () => {
    const server = parsed.mcpServers!.devdigest!;
    expect(server.type).toBe('stdio');
  });

  it(
    'has no `alwaysLoad` key — its absence is deliberate: tool definitions ' +
      'must stay out of the base session context and be discovered by tool ' +
      'search instead. Do not "fix" this by adding one back.',
    () => {
      // String-level check on the raw text (not just the parsed server
      // object) so a nested/misplaced occurrence anywhere in the file is
      // caught too, not just a top-level one on the `devdigest` entry.
      expect(raw).not.toContain('alwaysLoad');
    },
  );

  it('points DEVDIGEST_API_URL at the local API', () => {
    const server = parsed.mcpServers!.devdigest!;
    const env = server.env as Record<string, string>;
    expect(env.DEVDIGEST_API_URL).toBe('http://127.0.0.1:3001');
  });

  it(
    'sets TSX_TSCONFIG_PATH to mcp-server/tsconfig.json — this is load-bearing, ' +
      'not cosmetic. `tsx` resolves `tsconfig.json` by walking up from the ' +
      'SPAWNED PROCESS\'s cwd, not from the entry file\'s directory. An MCP host ' +
      'launches a project-scope server with cwd = repo root, where the nearest ' +
      'tsconfig is not this package\'s — so without this var the ' +
      '`@devdigest/reviewer-core`/`@devdigest/shared` path aliases never ' +
      'resolve and the server dies instantly with ERR_MODULE_NOT_FOUND. This ' +
      "package's own test suite can't catch that failure mode because vitest " +
      'always runs with cwd = mcp-server/. Do not remove this var without ' +
      'verifying the server still boots from a repo-root cwd.',
    () => {
      const server = parsed.mcpServers!.devdigest!;
      const env = server.env as Record<string, string>;
      expect(env.TSX_TSCONFIG_PATH).toBe('mcp-server/tsconfig.json');
    },
  );

  it('contains no secret-shaped values — this file is committed to git', () => {
    const secretPatterns = [
      /sk-[A-Za-z0-9_-]{8,}/,
      /ghp_[A-Za-z0-9]{8,}/,
      /gho_[A-Za-z0-9]{8,}/,
      /Bearer\s+\S+/,
      /api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{8,}/i,
      /password\s*[:=]\s*['"]?\S+/i,
      /token\s*[:=]\s*['"]?[A-Za-z0-9_-]{8,}/i,
    ];
    for (const pattern of secretPatterns) {
      expect(raw).not.toMatch(pattern);
    }
    // Explicit guard: the API auth token env var must never be baked into
    // this committed file.
    expect(raw).not.toContain('DEVDIGEST_API_TOKEN');
  });

  it(
    'resolves `command` and `args[0]` relative to the repo root — that is ' +
      'the cwd the MCP host uses to launch the server — and the command is ' +
      'executable, the entry file exists',
    () => {
      const server = parsed.mcpServers!.devdigest!;
      const command = server.command as string;
      const args = server.args as string[];

      const commandPath = resolve(repoRoot, command);
      expect(existsSync(commandPath)).toBe(true);
      const commandStat = statSync(commandPath);
      // Executable by owner, group, or other.
      expect(commandStat.mode & 0o111).not.toBe(0);

      expect(args.length).toBeGreaterThan(0);
      const entryPath = resolve(repoRoot, args[0]!);
      expect(existsSync(entryPath)).toBe(true);
    },
  );
});
