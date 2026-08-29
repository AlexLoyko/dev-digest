import type { CSSProperties } from "react";

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
  sourceRootLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-secondary)",
    flexShrink: 0,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  tokenCount: { fontSize: 11, color: "var(--text-muted)", flexShrink: 0, whiteSpace: "nowrap" } satisfies CSSProperties,
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
  chipRow: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 } satisfies CSSProperties,
  reorderGroup: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 } satisfies CSSProperties,
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

/** Reorder button — disabled at list boundaries. */
export function reorderBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: "inline-grid",
    placeItems: "center",
    width: 22,
    height: 22,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "transparent",
    color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
    opacity: disabled ? 0.4 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
    flexShrink: 0,
  };
}

/** Reorder buttons stay real, tabbable elements at all times (NFR-4 — Tab
 *  must reach them even before hover/focus). `revealed` only fades them in
 *  visually on row hover or when one of them holds focus — matching the
 *  reference's drag-handle-only look while the buttons keep working. */
export function reorderGroupRevealStyle(revealed: boolean): CSSProperties {
  return { opacity: revealed ? 1 : 0, transition: "opacity .12s" };
}
