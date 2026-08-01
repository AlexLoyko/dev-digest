import type { Finding } from "@devdigest/shared";
import {
  BADGE_SEVERITIES,
  POPOVER_MAX_HEIGHT,
  POPOVER_OFFSET,
  POPOVER_WIDTH,
  SEVERITY_ORDER,
  VIEWPORT_MARGIN,
} from "./constants";

export type SeverityCount = { severity: (typeof BADGE_SEVERITIES)[number]; count: number };

/** One entry per severity that actually occurs, worst first. A severity with no
 *  findings gets no badge — an explicit zero would be noise on every row. */
export function countBySeverity(findings: Finding[]): SeverityCount[] {
  return BADGE_SEVERITIES.map((severity) => ({
    severity,
    count: findings.filter((f) => f.severity === severity).length,
  })).filter((g) => g.count > 0);
}

/** Worst first, then most-confident first inside a severity. */
export function sortForDisplay(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const bySeverity =
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
    return bySeverity !== 0 ? bySeverity : b.confidence - a.confidence;
  });
}

/** "12" for a single line, "45-52" for a range — matches FindingCard. */
export function lineLabel(f: Pick<Finding, "start_line" | "end_line">): string {
  return f.end_line > f.start_line ? `${f.start_line}-${f.end_line}` : `${f.start_line}`;
}

export type PopoverPosition = { left: number; top?: number; bottom?: number };

/**
 * Viewport coordinates for the popover, given the badges' rect.
 *
 * The popover is positioned `fixed`, not `absolute`, because the PR-list card
 * sets `overflow: hidden` (pulls/styles.ts) and would otherwise clip it. Fixed
 * elements are only clipped by an ancestor that establishes a containing block
 * (transform/filter/will-change) — nothing on either surface does.
 *
 * `left` is the badges' left edge, so the panel lines up with the LEFTMOST
 * badge. It flips above the badges when there is not enough room below, which
 * is what the last row of a full list hits.
 */
export function placePopover(
  rect: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number },
): PopoverPosition {
  const maxLeft = viewport.width - POPOVER_WIDTH - VIEWPORT_MARGIN;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));
  const roomBelow = viewport.height - rect.bottom;
  if (roomBelow >= POPOVER_MAX_HEIGHT + POPOVER_OFFSET + VIEWPORT_MARGIN) {
    return { left, top: rect.bottom + POPOVER_OFFSET };
  }
  return { left, bottom: viewport.height - rect.top + POPOVER_OFFSET };
}
