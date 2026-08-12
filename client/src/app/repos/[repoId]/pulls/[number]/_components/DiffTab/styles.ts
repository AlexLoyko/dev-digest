import type { CSSProperties } from "react";

/** Co-located styles for the Files tab's summary row + view toggle. */
export const s = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    margin: "0 0 14px",
  } satisfies CSSProperties,
  summary: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  segmented: {
    display: "inline-flex",
    gap: 2,
    padding: 2,
    borderRadius: 6,
    background: "var(--bg-hover)",
  } satisfies CSSProperties,
} as const;

/**
 * One half of the segmented control. Not the vendored `Tabs` — that is a
 * page-level underlined tab bar with a bottom border; this is an inline
 * two-state switch inside a section.
 */
export function segment(active: boolean): CSSProperties {
  return {
    padding: "4px 12px",
    border: "none",
    borderRadius: 5,
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
  };
}
