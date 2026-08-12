import type { CSSProperties } from "react";

/** Co-located styles for the Smart Diff view. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 22 } satisfies CSSProperties,

  // ---- split nudge ----
  splitBanner: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: "12px 14px",
    border: "1px solid var(--warn)",
    borderRadius: 7,
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  splitTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  splitBody: { fontSize: 12, color: "var(--text-secondary)", marginTop: 2 } satisfies CSSProperties,
  splitList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  } satisfies CSSProperties,
  /** Each proposed split is its own bounded chip — a plain gap between them
      reads as one run-on sentence ("core · 20 files wiring · 5 files"). */
  splitChip: {
    padding: "2px 8px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  // ---- role section ----
  group: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "0 2px",
  } satisfies CSSProperties,
  groupLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  groupDesc: { fontSize: 12, color: "var(--text-muted)", flex: 1 } satisfies CSSProperties,
  groupCount: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,

  // ---- file card ----
  fileList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileHeaderRow: {
    display: "flex",
    alignItems: "center",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
    flex: 1,
    minWidth: 0,
    border: "none",
    background: "transparent",
    textAlign: "left",
  } satisfies CSSProperties,
  fileLink: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    padding: "10px 12px",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,

  // ---- decorated lines ----
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
} as const;

/** A coloured dot — role marker in a section header, severity dot on a file. */
export function dot(color: string, size = 8): CSSProperties {
  return { width: size, height: size, borderRadius: 2, background: color, flexShrink: 0 };
}

export function chevron(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
    flexShrink: 0,
  };
}

/**
 * A diff row. `edge` paints the severity bar on the left gutter — the bar is
 * what makes a flagged line findable while scrolling, independent of the chip.
 *
 * Per-side longhands rather than the `borderLeft` shorthand. Nothing else here
 * sets a border, so the shorthand would work today — this keeps the row immune
 * to the conflict described in INSIGHTS.md 2026-08-12 if one is ever added.
 */
export function lineRow(kind: string, edge?: string): CSSProperties {
  const background =
    kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return {
    display: "flex",
    alignItems: "stretch",
    fontSize: 13,
    lineHeight: "20px",
    background,
    borderLeftStyle: "solid",
    borderLeftWidth: 3,
    borderLeftColor: edge ?? "transparent",
  };
}

export function lineSign(kind: string): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color:
      kind === "add"
        ? "var(--code-add-text)"
        : kind === "del"
          ? "var(--code-del-text)"
          : "var(--text-muted)",
    flexShrink: 0,
  };
}

/** The inline severity chip — a button, because it navigates to the finding. */
export function chip(color: string, bg: string): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    alignSelf: "center",
    marginRight: 10,
    padding: "0 6px",
    border: "none",
    borderRadius: 4,
    background: bg,
    color,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: "16px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
}
