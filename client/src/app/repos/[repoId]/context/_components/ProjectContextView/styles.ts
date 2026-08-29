import type { CSSProperties } from "react";

/** Co-located styles for the Project Context page. */
export const s = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
  } satisfies CSSProperties,
  header: {
    padding: "24px 32px 16px",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  readOnlyNotice: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 6,
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  headerActions: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
  } satisfies CSSProperties,
  columns: {
    display: "grid",
    gridTemplateColumns: "380px 1fr",
    gap: 20,
    padding: "0 32px 44px",
    minHeight: 0,
    alignItems: "start",
  } satisfies CSSProperties,
  listCol: {
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  filterInput: {
    margin: 12,
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,
  showing: {
    padding: "0 16px 8px",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    maxHeight: "calc(100vh - 260px)",
    overflowY: "auto",
  } satisfies CSSProperties,
  /** Plain row — file icon + mono path only. No chips (source-root, threat,
   * usage, tokens) — those either moved (usage → viewer header) or were
   * dropped from this layout entirely (see the implementation report). */
  row: (active: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 16px",
    borderTop: "1px solid var(--border)",
    borderLeft: "none",
    borderRight: "none",
    borderBottom: "none",
    cursor: "pointer",
    background: active ? "var(--accent-bg)" : "transparent",
    textAlign: "left",
    width: "100%",
  }),
  rowIcon: (active: boolean): CSSProperties => ({
    color: active ? "var(--accent-text)" : "var(--text-muted)",
    flexShrink: 0,
    display: "flex",
  }),
  rowPath: (active: boolean): CSSProperties => ({
    fontSize: 12.5,
    color: active ? "var(--accent-text)" : "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  }),
  /** Summary footer under the list — document count, token total, and (when
   * `scanned_at` is present) a relative "refreshed" timestamp segment — see
   * `ProjectContextView.tsx` for the omission rule. */
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "10px 16px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  footerDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--ok)",
    flexShrink: 0,
  } satisfies CSSProperties,
  viewerCol: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 24,
    minHeight: 300,
  } satisfies CSSProperties,
  /** Viewer header — mono path on the left, "Used by N agents" on the
   * right, opposite sides of the same row (AC-4's usage indicator, moved
   * here from the row). */
  viewerHeader: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  } satisfies CSSProperties,
  viewerPath: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** AC-4: usage indicator shown for every document, including zero — one
   * consistent muted/secondary treatment regardless of count (matches the
   * reference: no bold, no colour swap, no chip for a non-zero count). */
  usedByAgents: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
