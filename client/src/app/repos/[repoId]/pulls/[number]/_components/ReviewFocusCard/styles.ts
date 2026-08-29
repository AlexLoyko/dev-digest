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
} as const;
