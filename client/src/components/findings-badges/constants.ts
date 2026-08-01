/** Static config for findings-badges. */

/** Display order for the badges and the popover list. Mirrors the weights in
 *  FindingsPanel/constants.ts — worst first, so a critical is never buried. */
export const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
  INFO: 3,
};

/** The severities that get a badge, in display order. */
export const BADGE_SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

export const POPOVER_WIDTH = 460;
export const POPOVER_MAX_HEIGHT = 340;

/** Gap between the badges and the popover's near edge. */
export const POPOVER_OFFSET = 6;

/** Keeps the popover off the very edge of the viewport when it has to shift. */
export const VIEWPORT_MARGIN = 12;

/**
 * Grace period before a mouse-out closes the popover. Without it the gap
 * between the badges and the panel closes the panel mid-travel, so it can
 * never be scrolled.
 */
export const CLOSE_DELAY_MS = 120;
