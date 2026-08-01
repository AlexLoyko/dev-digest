import type { CSSProperties } from "react";

/** Co-located styles for RunCostBadge's two variants. */
export const s = {
  /** PR-list column cell: tabular figures so the column reads as a money column. */
  cell: {
    fontSize: 12.5,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
  /** Timeline usage line: sits inside the muted, mono, right-aligned meta column. */
  inline: {
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
  /** No cost data — muted, so an em dash never reads as a real amount. */
  muted: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
};
