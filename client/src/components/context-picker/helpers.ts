/* helpers.ts — pure functions for ContextPicker. No React, no i18n: every
   function here is unit-testable by calling it directly (see AC-10 gotcha —
   the token total is a derived sum, computed fresh on every render, never
   stored in useState + useEffect). */
import type { SpecFile } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Display rows
// ---------------------------------------------------------------------------

/** One row to render. `doc` is null when the path is attached but no longer
 *  present in the current document catalog (deleted from the repo) — the
 *  row still renders (via `path`) so the "missing in repo" badge has
 *  something to attach to (EC-7). */
export interface DisplayRow {
  path: string;
  doc: SpecFile | null;
}

/** Attached documents first, in attached order; then the rest of the
 *  catalog in its given order. Never key the resulting list on array
 *  index — always on `path` (it survives reordering/filtering). */
export function buildDisplayRows(
  documents: SpecFile[],
  attachedPaths: string[],
): DisplayRow[] {
  const byPath = new Map(documents.map((d) => [d.path, d]));
  const attachedRows: DisplayRow[] = attachedPaths.map((path) => ({
    path,
    doc: byPath.get(path) ?? null,
  }));
  const attachedSet = new Set(attachedPaths);
  const restRows: DisplayRow[] = documents
    .filter((d) => !attachedSet.has(d.path))
    .map((d) => ({ path: d.path, doc: d }));
  return [...attachedRows, ...restRows];
}

/** Case-insensitive substring filter over the path. */
export function filterDisplayRows(rows: DisplayRow[], query: string): DisplayRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.path.toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Token total (AC-10) — pure sum, recompute every render, never store.
// ---------------------------------------------------------------------------

export function sumAttachedTokens(attachedPaths: string[], documents: SpecFile[]): number {
  const byPath = new Map(documents.map((d) => [d.path, d]));
  return attachedPaths.reduce((total, path) => total + (byPath.get(path)?.tokens ?? 0), 0);
}

/** True when at least one currently-attached document's token count is an
 *  estimate (EC-5) — drives the "≈" prefix on the footer total. */
export function hasApproximateTokens(attachedPaths: string[], documents: SpecFile[]): boolean {
  const byPath = new Map(documents.map((d) => [d.path, d]));
  return attachedPaths.some((path) => byPath.get(path)?.tokens_approximate === true);
}

// ---------------------------------------------------------------------------
// Path display
// ---------------------------------------------------------------------------

/** Splits "docs/foo/bar.md" into a dim directory prefix ("docs/foo/") and
 *  the mono filename ("bar.md"). */
export function splitPathParts(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { dir: "", name: path };
  return { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) };
}

// ---------------------------------------------------------------------------
// Attachment toggling
// ---------------------------------------------------------------------------

/** Newly attached paths append at the end of the existing order — they
 *  don't jump ahead of documents the user already ordered. */
export function toggleAttachment(attachedPaths: string[], path: string): string[] {
  return attachedPaths.includes(path)
    ? attachedPaths.filter((p) => p !== path)
    : [...attachedPaths, path];
}

// ---------------------------------------------------------------------------
// Exclusion (EC-4) — an oversize/unreadable document is excluded from the
// list and from injection, and the exclusion is reported rather than
// silent. Mirrors `ProjectContextView/helpers.ts:isExcluded`.
// ---------------------------------------------------------------------------

/** True when the document was excluded from context assembly. `doc` is
 *  `null` for a path that's attached but missing from the repo entirely
 *  (EC-7) — that's a different case and never counts as excluded. */
export function isExcluded(doc: SpecFile | null): boolean {
  return !!doc?.excluded_reason;
}

/** EC-4: an excluded document can never be *newly* attached — its checkbox
 *  is disabled and toggling it is a no-op. An already-attached document
 *  that has since become excluded (server re-scanned it and it now
 *  exceeds the size/readability limit) stays toggleable so it can still be
 *  removed — disabling here would strand it in the attached set with no
 *  way to detach it. */
export function canAttach(row: DisplayRow, isAttached: boolean): boolean {
  return isAttached || !isExcluded(row.doc);
}

// ---------------------------------------------------------------------------
// Keyboard-operable reordering (NFR-4)
// ---------------------------------------------------------------------------

export type MoveDirection = "up" | "down";

export interface MoveResult {
  paths: string[];
  /** 1-based position of the moved path after the move — feeds the
   *  aria-live `orderAnnouncement` message. */
  position: number;
  total: number;
}

/** Swaps `path` with its neighbour in the given direction. Returns null at
 *  a list boundary so the caller can no-op (no state change, no
 *  announcement). Used by the handle's keyboard ArrowUp/ArrowDown path
 *  (single-step nudge) — see `reorderAttachedPath` below for the
 *  arbitrary-distance move drag-and-drop needs. */
export function moveAttachedPath(
  attachedPaths: string[],
  path: string,
  direction: MoveDirection,
): MoveResult | null {
  const from = attachedPaths.indexOf(path);
  if (from === -1) return null;
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= attachedPaths.length) return null;
  // Bounds are proven above (`from` from indexOf, `to` range-checked) —
  // non-null assertions are safe here under noUncheckedIndexedAccess.
  const next = [...attachedPaths];
  const tmp = next[from]!;
  next[from] = next[to]!;
  next[to] = tmp;
  return { paths: next, position: to + 1, total: next.length };
}

/** Moves `fromPath` to sit at `toPath`'s current index — the drag-and-drop
 *  drop primitive. Unlike `moveAttachedPath`'s single-step neighbour swap,
 *  this covers an arbitrary-distance move in one gesture (dropping a row
 *  three places up moves it three places, not one). Returns null when
 *  either path isn't currently attached, or when dropped on itself
 *  (no-op — nothing to announce). */
export function reorderAttachedPath(
  attachedPaths: string[],
  fromPath: string,
  toPath: string,
): MoveResult | null {
  if (fromPath === toPath) return null;
  const from = attachedPaths.indexOf(fromPath);
  const to = attachedPaths.indexOf(toPath);
  if (from === -1 || to === -1) return null;
  const next = [...attachedPaths];
  next.splice(from, 1);
  next.splice(to, 0, fromPath);
  return { paths: next, position: next.indexOf(fromPath) + 1, total: next.length };
}

// ---------------------------------------------------------------------------
// Threat level
// ---------------------------------------------------------------------------

export type ThreatLevel = NonNullable<SpecFile["threat_level"]>;

export function resolveThreatLevel(doc: Pick<SpecFile, "threat_level">): ThreatLevel {
  return doc.threat_level ?? "unknown";
}

/** CSS var per threat level — colour only, never the sole signal (the
 *  catalogue-driven text label always renders alongside it). */
export function threatColor(level: ThreatLevel): string {
  switch (level) {
    case "dangerous":
      return "var(--crit)";
    case "suspicious":
      return "var(--warn)";
    case "safe":
      return "var(--ok)";
    default:
      return "var(--text-muted)";
  }
}
