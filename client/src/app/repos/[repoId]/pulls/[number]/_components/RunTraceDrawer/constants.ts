/** Constants for the Run Trace + Live Log drawer (A5). */

/** Drawer width (px). */
export const DRAWER_WIDTH = 720;

/** Live-log stream viewport height (px). */
export const LOG_HEIGHT = 420;

/** Tab keys (Trace / Live log). */
export const TABS = ["trace", "log"] as const;
export type TraceTab = (typeof TABS)[number];

/** Prompt-assembly block accent colours (by leg). */
export const PROMPT_COLORS = {
  system: "var(--text-muted)",
  skills: "var(--accent)",
  memory: "var(--warn)",
  repoMap: "var(--accent)",
  // Own accent — distinguishes the untrusted, repo-controlled specs segment
  // from the other (trusted/dynamic) legs above.
  specs: "var(--sugg)",
  callers: "var(--warn)",
  user: "var(--ok)",
} as const;

/** Colour + background per `SpecRead.status`, for the Configuration card's
 *  per-spec status chip. */
export const SPECS_STATUS_COLORS = {
  read: { color: "var(--ok)", bg: "var(--ok-bg)" },
  missing: { color: "var(--warn)", bg: "var(--warn-bg)" },
  rejected: { color: "var(--crit)", bg: "var(--crit-bg)" },
  duplicate: { color: "var(--info)", bg: "var(--info-bg)" },
} as const;
