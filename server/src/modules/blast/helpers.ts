/**
 * blast — pure helpers. No DB, no I/O. Unit-testable in isolation; the
 * service (`service.ts`) is the only orchestrator that wires these to real
 * repository calls.
 */
import type { BlastCallerView, BlastFactRef } from '@devdigest/shared';
import type { CallerRow, SymbolInFileRow, FileEdgeRow, FileFactsRow } from './repository.js';

/**
 * Enclosing top-level (bare-name) symbol for a reference line: the row with
 * the largest `line <= line` among rows whose `name` does NOT contain `.`
 * (qualified `Class.method` dual-emits are excluded). `null` if none match —
 * callers fall back to the file's basename.
 */
export function enclosingSymbol(
  rows: { name: string; line: number | null }[],
  line: number,
): string | null {
  const candidates = rows.filter(
    (r) => !r.name.includes('.') && r.line != null && r.line <= line,
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.line as number) - (a.line as number));
  return candidates[0]!.name;
}

export interface CallerGroup {
  callers: BlastCallerView[];
  callerTotal: number;
  truncated: boolean;
}

/**
 * Group raw caller rows by `(declFile, toSymbol)` — i.e. by the changed
 * symbol they reach — sort each group by `rank` DESC then `fromPath` ASC,
 * cap at `cap`, and resolve each caller's enclosing symbol name.
 *
 * Keyed by `${declFile}::${toSymbol}` so the service can look a group up by
 * a changed symbol's `(file, name)` pair directly.
 *
 * This is where the repo-intel global-slice bug is fixed: the cap is applied
 * PER GROUP (per changed symbol), not once across every row in `rows`.
 */
export function groupAndCapCallers(
  rows: CallerRow[],
  symbolsByFile: Map<string, SymbolInFileRow[]>,
  cap: number,
): Map<string, CallerGroup> {
  const grouped = new Map<string, CallerRow[]>();
  for (const r of rows) {
    const key = `${r.declFile}::${r.toSymbol}`;
    const arr = grouped.get(key);
    if (arr) arr.push(r);
    else grouped.set(key, [r]);
  }

  const result = new Map<string, CallerGroup>();
  for (const [key, groupRows] of grouped) {
    const sorted = [...groupRows].sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return a.fromPath.localeCompare(b.fromPath);
    });
    const callerTotal = sorted.length;
    const capped = sorted.slice(0, cap);
    const callers: BlastCallerView[] = capped.map((r) => {
      const fileSymbols = symbolsByFile.get(r.fromPath) ?? [];
      const symbol =
        enclosingSymbol(fileSymbols, r.line) ?? r.fromPath.split('/').pop() ?? r.fromPath;
      return { file: r.fromPath, symbol, line: r.line, rank: r.rank };
    });
    result.set(key, { callers, callerTotal, truncated: callerTotal > cap });
  }
  return result;
}

/**
 * Reverse BFS over the import graph: from `seed` files, walk "who imports
 * this file" up to `depth` hops. Returns a Map from file path → minimum
 * depth reached (0 = a seed file itself). Terminates on cycles via the
 * `result` map doubling as the visited set — a file already recorded is
 * never re-queued.
 */
export async function reverseBfs(
  seed: string[],
  depth: number,
  importersOf: (files: string[]) => Promise<FileEdgeRow[]>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const f of seed) result.set(f, 0);

  let frontier = [...seed];
  for (let d = 1; d <= depth && frontier.length > 0; d += 1) {
    const edges = await importersOf(frontier);
    const next: string[] = [];
    for (const e of edges) {
      if (!result.has(e.fromFile)) {
        result.set(e.fromFile, d);
        next.push(e.fromFile);
      }
    }
    frontier = next;
  }
  return result;
}

export interface FactGroup {
  /** Capped, for the symbol node's display arrays. */
  endpoints: BlastFactRef[];
  crons: BlastFactRef[];
  /** Pre-cap TRUE distinct counts — mirrors CallerGroup's callerTotal. */
  endpointTotal: number;
  cronTotal: number;
  /** True when (endpointTotal + cronTotal) exceeds maxFactsTotal. */
  truncated: boolean;
  /**
   * Every distinct label reached (uncapped), for the SERVICE to union across
   * symbols when computing the top-level `counts.endpoints`/`counts.crons` —
   * summing each symbol's post-cap array length would both undercount (a
   * label past the cap is dropped from every symbol that reaches it) and, for
   * two symbols sharing an import path, double-count the same label twice.
   */
  allEndpointLabels: string[];
  allCronLabels: string[];
}

/**
 * Attribute endpoints/crons to ONE changed symbol: reverse-BFS seeded from
 * the symbol's OWN declaration file (not all changed files at once — that
 * would misattribute facts across symbols that share no import path), then
 * pull facts for every file reached within `maxDepth` hops.
 *
 * Dedupes by label, keeping the MINIMUM depth if a fact is reachable via
 * multiple paths. Caps the DISPLAY arrays (`endpoints`/`crons`) at
 * `maxFactsTotal` combined, closest (lowest-depth) facts first — same
 * per-group-cap-with-reported-total shape as `groupAndCapCallers`, so the
 * service can build an honest `counts.endpoints`/`counts.crons` instead of
 * silently summing already-truncated arrays.
 */
export async function attributeFacts(
  symbolFile: string,
  maxDepth: number,
  maxFactsTotal: number,
  importersOf: (files: string[]) => Promise<FileEdgeRow[]>,
  factsFor: (files: string[]) => Promise<FileFactsRow[]>,
): Promise<FactGroup> {
  const depthMap = await reverseBfs([symbolFile], maxDepth, importersOf);
  const files = [...depthMap.keys()];
  const facts = await factsFor(files);

  const endpointsByLabel = new Map<string, BlastFactRef>();
  const cronsByLabel = new Map<string, BlastFactRef>();

  for (const f of facts) {
    const depth = depthMap.get(f.filePath) ?? maxDepth;
    for (const label of f.endpoints) {
      const existing = endpointsByLabel.get(label);
      if (!existing || depth < existing.depth) {
        endpointsByLabel.set(label, { label, file: f.filePath, depth });
      }
    }
    for (const label of f.crons) {
      const existing = cronsByLabel.get(label);
      if (!existing || depth < existing.depth) {
        cronsByLabel.set(label, { label, file: f.filePath, depth });
      }
    }
  }

  type Tagged = BlastFactRef & { kind: 'endpoint' | 'cron' };
  const combined: Tagged[] = [
    ...[...endpointsByLabel.values()].map((e) => ({ ...e, kind: 'endpoint' as const })),
    ...[...cronsByLabel.values()].map((c) => ({ ...c, kind: 'cron' as const })),
  ].sort((a, b) => a.depth - b.depth);

  const total = combined.length;
  const capped = combined.slice(0, maxFactsTotal);
  const endpoints = capped
    .filter((c) => c.kind === 'endpoint')
    .map(({ label, file, depth }) => ({ label, file, depth }));
  const crons = capped
    .filter((c) => c.kind === 'cron')
    .map(({ label, file, depth }) => ({ label, file, depth }));

  return {
    endpoints,
    crons,
    endpointTotal: endpointsByLabel.size,
    cronTotal: cronsByLabel.size,
    truncated: total > maxFactsTotal,
    allEndpointLabels: [...endpointsByLabel.keys()],
    allCronLabels: [...cronsByLabel.keys()],
  };
}
