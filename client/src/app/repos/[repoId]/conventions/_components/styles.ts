import type React from "react";

/** Shared inline styles for the Conventions surface. */
export const s = {
  page: { padding: "24px 32px", maxWidth: 1040, margin: "0 auto" } as React.CSSProperties,

  headRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 6,
  } as React.CSSProperties,

  h1: { fontSize: 26, fontWeight: 700, flex: 1 } as React.CSSProperties,

  repoName: { color: "var(--accent)" } as React.CSSProperties,

  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginBottom: 20,
  } as React.CSSProperties,

  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  } as React.CSSProperties,

  toolbarCount: { fontSize: 13, color: "var(--text-muted)", flex: 1 } as React.CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 14 } as React.CSSProperties,

  /** Accepted cards carry a green rail, matching the findings surface. */
  card: (accepted: boolean): React.CSSProperties => ({
    display: "flex",
    gap: 16,
    padding: 18,
    borderRadius: 10,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${accepted ? "var(--ok)" : "transparent"}`,
    transition: "border-color .15s ease",
  }),

  cardMain: { flex: 1, minWidth: 0 } as React.CSSProperties,

  rule: {
    fontSize: 15,
    fontWeight: 600,
    fontStyle: "italic",
    marginBottom: 12,
    lineHeight: 1.4,
  } as React.CSSProperties,

  evidence: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    overflow: "hidden",
    marginBottom: 12,
  } as React.CSSProperties,

  evidenceHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } as React.CSSProperties,

  evidencePre: {
    margin: 0,
    padding: "12px 14px",
    background: "var(--code-bg)",
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 220,
    overflow: "auto",
    color: "var(--text-primary)",
  } as React.CSSProperties,

  copyBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
    padding: 4,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-muted)",
    cursor: "pointer",
  } as React.CSSProperties,

  confidenceRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 12,
    color: "var(--text-muted)",
  } as React.CSSProperties,

  confidenceBar: { width: 120 } as React.CSSProperties,

  /** The "followed in N of M files" basis, secondary to the percentage. */
  confidenceBasis: {
    color: "var(--text-muted)",
    opacity: 0.75,
    marginLeft: 4,
  } as React.CSSProperties,

  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 180,
    flexShrink: 0,
  } as React.CSSProperties,

  modalBody: { padding: "20px 24px" } as React.CSSProperties,

  banner: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    background: "var(--bg-active)",
    border: "1px solid var(--border)",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 20,
  } as React.CSSProperties,

  bodyHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    background: "var(--bg-surface)",
    border: "1px solid var(--border-strong)",
    borderBottom: "none",
    borderRadius: "7px 7px 0 0",
    fontSize: 12,
    color: "var(--text-muted)",
  } as React.CSSProperties,

  modalFooter: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  } as React.CSSProperties,

  footerNote: { fontSize: 12, color: "var(--text-muted)", flex: 1 } as React.CSSProperties,
};
