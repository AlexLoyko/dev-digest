import type { CSSProperties } from "react";

/** Co-located styles for ReviewFocusCard (extracted from inline styles). */
export const s = {
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  item: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  bullet: {
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
  entryText: {
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  /** The abbreviated-path chip is a label for the reason, not the content —
   *  keep it from growing wider than its text and wrapping mid-path. */
  locationChip: {
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /** Higher-contrast than the surrounding `entryText` (which now only styles
   *  the bullet's em dash): the reason is the row's actual content, the
   *  file location is its label. */
  reason: {
    color: "var(--text-primary)",
  } satisfies CSSProperties,
} as const;
