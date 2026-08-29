import type { CSSProperties } from "react";

/** BriefCard-only styles. The shared anatomy pieces (`wrap`, `iconBox`,
 *  `main`, `titleRow`, `label`, `summary`) are reused directly from
 *  `../VerdictBanner/styles` per the plan's "reproduce VerdictBanner's
 *  anatomy" constraint — this file only adds what VerdictBanner has no
 *  equivalent for. */
export const s = {
  /** The "why" paragraph — one step more muted than the "what" paragraph
   *  (`../VerdictBanner/styles`'s `summary`, at `--text-secondary`), per
   *  `design/states/NoAgentRun.dc.html`. */
  why: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-muted)",
    marginTop: 6,
  } satisfies CSSProperties,
  /** Trailing region. `minWidth: 52` reserves the footprint of the 52px
   *  `CircularScore` a later task (T17) renders here, so the main column's
   *  measure never changes when a score first appears (AC-20). Always
   *  present — never conditionally omitted — even when, as here, it holds
   *  only the regenerate control. */
  trailing: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    flexShrink: 0,
    minWidth: 52,
  } satisfies CSSProperties,
} as const;
