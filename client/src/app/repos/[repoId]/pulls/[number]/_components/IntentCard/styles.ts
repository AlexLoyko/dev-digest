import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. Full-width, single-column vertical flow —
    IN SCOPE / OUT OF SCOPE are stacked sections, not a side-by-side grid, so
    long items can wrap as full sentences without cramming into a half-width
    column. */
export const s = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  loading: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  /** Left-bordered blockquote — a vertical rule down the left edge, not a
      quote-marked sentence. All-longhand border props (never mix the `border`
      shorthand with `borderLeft` on the same style object — React warns). */
  summary: {
    margin: 0,
    paddingLeft: 14,
    borderLeftStyle: "solid",
    borderLeftWidth: 3,
    borderLeftColor: "var(--border-strong)",
    fontSize: 14,
    fontStyle: "italic",
    color: "var(--text-secondary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  scopeSection: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  scopeHeading: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  scopeList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  scopeItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  scopeItemOut: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  scopeIcon: {
    marginTop: 2,
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
