/**
 * `run_id -> PR context` index for @devdigest/mcp-server.
 *
 * `devdigest_get_findings` (R6) accepts only a `run_id`, but findings are
 * reachable only through `GET /pulls/:prId/reviews` — `RunTrace` carries no
 * `pr_id` and there is no `GET /runs/:id` route (see
 * `docs/plans/l04-devdigest-mcp.md`, "Run index (why it exists)"). Rather than
 * add a route to `server/` (breaking the "thin HTTP-client adapter" rule),
 * `devdigest_run_agent_on_pr` records the mapping here, and `devdigest_get_findings`
 * looks it up. An unknown `run_id` is then a genuine, honest error.
 *
 * This index must survive an MCP process restart, so it is an in-memory `Map`
 * backed by a JSON file (by convention `~/.devdigest/mcp/run-index.json` —
 * the caller decides the exact `dir`; this module only ever writes the one
 * file `run-index.json` inside the `dir` it is given). `~/.devdigest/` already
 * holds `secrets.json` at mode `0600` — this module never reads or touches
 * that file, and only ever creates/writes inside its own `dir`.
 *
 * Every filesystem operation here is fail-soft: a read error (missing file,
 * corrupted JSON, wrong shape) yields an empty index, never a thrown
 * exception. A write error is swallowed. A broken cache file must never crash
 * the MCP server — worst case the index degrades to empty and every
 * `run_id` looks "unknown", which is the same honest, actionable error this
 * module exists to produce in the first place.
 *
 * Debug logging (of swallowed read/write errors) goes to **stderr only** —
 * `stdout` is the JSON-RPC channel for the stdio transport, and a single
 * `console.log` there would corrupt the protocol stream. `debug` is an
 * injected flag rather than a `process.env` read: `mcp-server/src/config.ts`
 * is documented as the only file in this package that reads `process.env`.
 */
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';

/** File name written inside the injected `dir`. */
const INDEX_FILENAME = 'run-index.json';

/** LRU cap (by `started_at`) — see "Run index" in the L04 plan. */
const MAX_ENTRIES = 200;

/** `~/.devdigest/mcp` itself must not be group/world-readable. */
const DIR_MODE = 0o700;

/** The index file carries run/PR identifiers — same discipline as `secrets.json`. */
const FILE_MODE = 0o600;

export interface RunIndexEntry {
  run_id: string;
  pr_id: string;
  repo: string;
  pr: number;
  agent_id: string;
  agent_name: string;
  /** Epoch milliseconds. Drives LRU eviction — oldest `started_at` is evicted first. */
  started_at: number;
}

export interface RunIndex {
  /** Records (or overwrites) the PR context for a `run_id`, evicting the oldest entry past the 200-entry cap. */
  put(entry: RunIndexEntry): void;
  /** Looks up the PR context for a `run_id`. `undefined` means "unknown run_id". */
  get(runId: string): RunIndexEntry | undefined;
  /** Current number of entries held in the index. */
  size(): number;
}

export interface CreateRunIndexOptions {
  /** Directory the index file lives in. Created recursively (mode 0700) if missing. Callers own the real path — tests must always pass a temp dir. */
  dir: string;
  /** When true, swallowed read/write errors are logged to stderr. Defaults to false. */
  debug?: boolean;
}

function debugLog(debug: boolean | undefined, message: string): void {
  if (!debug) {
    return;
  }
  // stderr only — stdout is the stdio JSON-RPC transport channel.
  process.stderr.write(`[mcp-server:run-index] ${message}\n`);
}

function isRunIndexEntry(value: unknown): value is RunIndexEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.run_id === 'string' &&
    typeof candidate.pr_id === 'string' &&
    typeof candidate.repo === 'string' &&
    typeof candidate.pr === 'number' &&
    typeof candidate.agent_id === 'string' &&
    typeof candidate.agent_name === 'string' &&
    typeof candidate.started_at === 'number'
  );
}

/**
 * Reads and parses the index file into entries. Fail-soft: any error (file
 * missing, invalid JSON, wrong top-level shape, invalid entries) yields an
 * empty array rather than throwing. Entries that individually fail
 * validation are dropped rather than poisoning the whole load.
 */
function loadEntries(filePath: string, debug: boolean | undefined): RunIndexEntry[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    // Includes ENOENT (no cache file yet) — that's a normal, silent case.
    debugLog(debug, `read failed for ${filePath}: ${String(err)}`);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    debugLog(debug, `corrupted JSON in ${filePath}, starting with an empty index: ${String(err)}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    debugLog(debug, `unexpected top-level shape in ${filePath} (expected array), starting with an empty index`);
    return [];
  }

  return parsed.filter(isRunIndexEntry);
}

/**
 * Persists the given entries to the index file, best-effort. Ensures the
 * directory exists first. Any failure (permissions, disk full, etc.) is
 * swallowed and debug-logged — a write failure must never surface to the
 * caller, since the run just started successfully regardless.
 */
function saveEntries(dir: string, filePath: string, entries: RunIndexEntry[], debug: boolean | undefined): void {
  try {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  } catch (err) {
    debugLog(debug, `failed to create directory ${dir}: ${String(err)}`);
    return;
  }

  try {
    writeFileSync(filePath, JSON.stringify(entries), { mode: FILE_MODE });
    // `writeFileSync`'s `mode` option only governs permissions at file
    // *creation* time; an existing file (e.g. left over with a looser mode
    // by something else) is not guaranteed to be re-chmod'd. Force it
    // explicitly so the 0600 guarantee holds on every write, not just the
    // first one.
    chmodSync(filePath, FILE_MODE);
  } catch (err) {
    debugLog(debug, `failed to write ${filePath}: ${String(err)}`);
  }
}

/**
 * Creates a run index backed by `<dir>/run-index.json`. Loads existing
 * entries (if any, and if valid) synchronously at construction time, then
 * serves `get`/`put`/`size` from an in-memory `Map` for the lifetime of the
 * process, persisting to disk on every `put`.
 */
export function createRunIndex({ dir, debug }: CreateRunIndexOptions): RunIndex {
  const filePath = path.join(dir, INDEX_FILENAME);
  const entries = loadEntries(filePath, debug);

  const map = new Map<string, RunIndexEntry>();
  for (const entry of entries) {
    map.set(entry.run_id, entry);
  }

  function persist(): void {
    saveEntries(dir, filePath, Array.from(map.values()), debug);
  }

  function evictOldestIfOverCap(): void {
    if (map.size <= MAX_ENTRIES) {
      return;
    }
    const sortedByAge = Array.from(map.values()).sort((a, b) => a.started_at - b.started_at);
    const overflow = map.size - MAX_ENTRIES;
    for (let i = 0; i < overflow; i += 1) {
      const oldest = sortedByAge[i];
      if (oldest) {
        map.delete(oldest.run_id);
      }
    }
  }

  return {
    put(entry: RunIndexEntry): void {
      map.set(entry.run_id, entry);
      evictOldestIfOverCap();
      persist();
    },
    get(runId: string): RunIndexEntry | undefined {
      return map.get(runId);
    },
    size(): number {
      return map.size;
    },
  };
}
