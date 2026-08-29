import type { CSSProperties } from "react";
import type { SpecFile } from "@devdigest/shared";

/** Category colour lookup, keyed by `SpecFile["root"]` — a new root value
 *  later is a one-line addition here, not a new conditional in the
 *  component. Picks the closest existing design tokens rather than a new
 *  one: `docs`→`--ok` (green — NOT `--success`, that token doesn't exist,
 *  see insights/gotchas.md), `insights`→`--warn` (amber/orange),
 *  `specs`→`--sugg` (named for "suggestion" severity but its hex value is
 *  the palette's blue), `readme`/`other`→`--text-secondary` (the row's
 *  previous single colour; kept for the two neutral categories because at
 *  this row's 12px/500-weight it reads noticeably clearer against
 *  `--bg-elevated` in dark theme than `--text-muted`, which dips under
 *  WCAG AA (~3.15:1) at that size — `--text-secondary` is ~5.99:1). */
export const sourceRootColor: Record<SpecFile["root"], string> = {
  docs: "var(--ok)",
  insights: "var(--warn)",
  specs: "var(--sugg)",
  readme: "var(--text-secondary)",
  other: "var(--text-secondary)",
};

/** Co-located styles for ContextPicker. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 } satisfies CSSProperties,
  headerLeft: { display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  helper: { fontSize: 12, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  filterInput: {
    width: 220,
    flexShrink: 0,
    padding: "6px 10px",
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    fontSize: 13,
    color: "var(--text-primary)",
    boxSizing: "border-box",
  } satisfies CSSProperties,
  filterCount: { display: "block", textAlign: "right", fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 6, padding: 0, margin: 0, listStyle: "none" } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 20 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  dragHandle: {
    display: "inline-grid",
    placeItems: "center",
    flexShrink: 0,
    width: 16,
    height: 22,
    color: "var(--text-muted)",
    cursor: "grab",
  } satisfies CSSProperties,
  checkbox: { flexShrink: 0, cursor: "pointer" } satisfies CSSProperties,
  pathWrap: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  } satisfies CSSProperties,
  dirPrefix: {
    color: "var(--text-muted)",
    fontSize: 12,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  filename: {
    color: "var(--text-primary)",
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  // Fixed-width column so the category text ("specs", "docs", "insights",
  // "readme", "other" — see messages/en/context.json `sourceRoot.*`) lands
  // at the same x on every row instead of drifting with word length.
  // "insights" (8 chars) is the widest of the five, hence 8ch; left-aligned
  // is the span's default text alignment, so no explicit textAlign needed.
  sourceRootLabel: {
    fontSize: 12,
    fontWeight: 500,
    flexShrink: 0,
    whiteSpace: "nowrap",
    minWidth: "8ch",
  } satisfies CSSProperties,
  // Fixed-width, right-aligned column so the digits (and trailing "t") of
  // "426t" and "12129t" end at the same x. Token counts run to 5 digits in
  // this repo, plus the optional "≈" approximation marker rendered inside
  // this same span — worst case "≈12129t" is 7 characters, hence 7ch.
  tokenCount: {
    fontSize: 11,
    color: "var(--text-muted)",
    flexShrink: 0,
    whiteSpace: "nowrap",
    minWidth: "7ch",
    textAlign: "right",
  } satisfies CSSProperties,
  previewBlock: {
    marginTop: 8,
    padding: 10,
    borderRadius: 6,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    fontSize: 12,
    fontFamily: "var(--font-mono, monospace)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 220,
    overflow: "auto",
  } satisfies CSSProperties,
  rowGroup: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 } satisfies CSSProperties,
  // `chipRow` no longer carries a reorder-buttons slot (drag/keyboard
  // reorder now lives entirely on the leading handle, outside `chipRow`,
  // where its width is reserved identically for attached and unattached
  // rows — see `dragHandle` below). Nothing inside `chipRow` differs by
  // attachment state anymore, so its own width — and therefore
  // sourceRootLabel/tokenCount/Preview's shared starting x — stays
  // consistent across every row regardless of attachment.
  chipRow: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingTop: 8,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  footerTotal: { fontSize: 12, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
} as const;

/** The drag handle for an attached row — a real `<button>` (draggable +
 *  keyboard-operable, NFR-4), reset to look like the old decorative span
 *  (`dragHandle` above) plus grabbed/dragging feedback. Same box size as
 *  the inert unattached-row span so the column never shifts on attach. */
export function dragHandleButtonStyle(grabbed: boolean, dragging: boolean): CSSProperties {
  return {
    display: "inline-grid",
    placeItems: "center",
    flexShrink: 0,
    width: 16,
    height: 22,
    padding: 0,
    border: "none",
    borderRadius: 4,
    background: grabbed ? "var(--accent-bg)" : "transparent",
    color: grabbed ? "var(--accent)" : "var(--text-muted)",
    cursor: dragging ? "grabbing" : "grab",
    opacity: dragging ? 0.5 : 1,
  };
}

/** Visual drop-target feedback on the row currently under a dragged handle. */
export function rowDragOverStyle(isDragOver: boolean): CSSProperties {
  return isDragOver ? { borderColor: "var(--accent)", background: "var(--accent-bg)" } : {};
}
