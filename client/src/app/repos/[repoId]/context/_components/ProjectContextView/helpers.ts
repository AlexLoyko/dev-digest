/**
 * helpers.ts — pure derivations for the Project Context page. Kept out of
 * the component body so they stay unit-testable (see `client/insights/
 * INSIGHTS.md` — "non-trivial derivations go in helpers.ts").
 */
import type { IndexStatus, SpecFile } from "@devdigest/shared";
import { LIST_RENDER_CAP, NOT_CLONED_MARKER, ROOT_META, THREAT_META } from "./constants";

/** EC-1: a repo with no local clone yet is signalled by this sentinel in
 * `index.message` — never rendered, only branched on. */
export function isNotCloned(index: IndexStatus | undefined | null): boolean {
  return index?.message === NOT_CLONED_MARKER;
}

/** Case-insensitive substring match against a document's path. An empty/
 * whitespace-only query matches everything. */
export function filterDocuments(documents: SpecFile[], query: string): SpecFile[] {
  const q = query.trim().toLowerCase();
  if (!q) return documents;
  return documents.filter((doc) => doc.path.toLowerCase().includes(q));
}

export interface CappedList<T> {
  rows: T[];
  total: number;
  truncated: boolean;
}

/** EC-10: bound the rendered list to `cap` rows regardless of how large the
 * (already filtered) input is — the list stays usable on a repo with
 * thousands of matching documents. `total` is the size of the filtered set
 * the "showing X of Y" message reports against, not the unfiltered total. */
export function capForDisplay<T>(items: T[], cap: number = LIST_RENDER_CAP): CappedList<T> {
  return {
    rows: items.length > cap ? items.slice(0, cap) : items,
    total: items.length,
    truncated: items.length > cap,
  };
}

/** Root chip colour + i18n label key for a document's source root. Falls
 * back to a neutral/unlabeled chip for a document with no root (should not
 * happen for a persisted document, but keeps the row renderable). */
export function rootMeta(root: SpecFile["root"]): { c: string; bg: string; labelKey: string } | null {
  if (!root) return null;
  return ROOT_META[root];
}

/** Threat badge colour/icon/i18n label key. A missing/null threat level
 * (not yet scanned, or pre-threat-scan data) reads as "unknown". */
export function threatMeta(level: SpecFile["threat_level"]) {
  return THREAT_META[level ?? "unknown"];
}

/** `used_by_agents` is nullish for a document that has never been attached
 * to any agent — normalize to 0 so callers can compare with `> 0` safely
 * (see the `{count && <X/>}` gotcha in INSIGHTS.md). */
export function usedByAgentsCount(doc: SpecFile): number {
  return doc.used_by_agents ?? 0;
}

/** True when the document was excluded from context assembly (e.g. too
 * large) — drives the "Excluded" marker on its row. */
export function isExcluded(doc: SpecFile): boolean {
  return !!doc.excluded_reason;
}

export interface TokenDisplay {
  /** `null` when the document has no token count yet (not yet scanned). */
  tokens: number | null;
  approximate: boolean;
}

/** Normalizes the `tokens` / `tokens_approximate` pair for display — the
 * `≈` prefix and the `tokensApprox` label are applied by the component only
 * when `approximate` is true. */
export function tokenDisplay(doc: SpecFile): TokenDisplay {
  return { tokens: doc.tokens ?? null, approximate: !!doc.tokens_approximate };
}
