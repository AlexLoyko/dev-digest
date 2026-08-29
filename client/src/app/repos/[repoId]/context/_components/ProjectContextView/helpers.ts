/**
 * helpers.ts — pure derivations for the Project Context page. Kept out of
 * the component body so they stay unit-testable (see `client/insights/
 * INSIGHTS.md` — "non-trivial derivations go in helpers.ts").
 */
import type { IndexStatus, SpecFile } from "@devdigest/shared";
import { LIST_RENDER_CAP, NOT_CLONED_MARKER } from "./constants";

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

/** `used_by_agents` is nullish for a document that has never been attached
 * to any agent — normalize to 0 so callers can compare with `> 0` safely
 * (see the `{count && <X/>}` gotcha in INSIGHTS.md). */
export function usedByAgentsCount(doc: SpecFile): number {
  return doc.used_by_agents ?? 0;
}

/** Sums `tokens` across all listed documents for the list footer's running
 * total. Documents with no token count yet (not scanned) contribute 0 — the
 * total is a best-effort figure, not a guarantee every document was counted. */
export function sumTokens(documents: SpecFile[]): number {
  return documents.reduce((sum, doc) => sum + (doc.tokens ?? 0), 0);
}

/** Whole minutes elapsed between `scannedAt` and `now` (defaults to
 * `new Date()`, injectable for tests), floored and clamped to ≥ 0. Returns
 * `null` when there's no scan yet (`scannedAt` nullish or unparsable) — the
 * caller decides how the footer renders that case. */
export function minutesSinceScan(scannedAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!scannedAt) return null;
  const scannedMs = new Date(scannedAt).getTime();
  if (Number.isNaN(scannedMs)) return null;
  return Math.max(0, Math.floor((now.getTime() - scannedMs) / 60_000));
}

/** Formats `minutesSinceScan`'s output as a short relative unit — "0m",
 * "45m", "3h", "2d". No i18n key exists for relative-time formatting (see
 * the Project Context implementation report); this is a deliberately
 * minimal, mostly-language-neutral abbreviation used only until one is
 * added. Kept pure/exported so it's independently testable. */
export function formatMinutesAgo(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
