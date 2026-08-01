import type { CSSProperties } from "react";
import { POPOVER_MAX_HEIGHT, POPOVER_WIDTH } from "./constants";
import type { PopoverPosition } from "./helpers";

/** Co-located styles for FindingsBadges + FindingsPopover. */
export const s = {
  /** The badge group. `help` is the question-mark cursor: hovering is the
   *  affordance, and nothing here is clickable. */
  anchor: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    cursor: "help",
    outline: "none",
  } satisfies CSSProperties,

  popover: (pos: PopoverPosition): CSSProperties => ({
    position: "fixed",
    left: pos.left,
    ...(pos.top != null ? { top: pos.top } : { bottom: pos.bottom }),
    width: POPOVER_WIDTH,
    maxHeight: POPOVER_MAX_HEIGHT,
    overflowY: "auto",
    // Reaching the end of a long findings list must not hand the wheel to the
    // page underneath — that scrolls the list out from under the pointer.
    overscrollBehavior: "contain",
    zIndex: 60,
    padding: "10px 0 4px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    boxShadow: "var(--shadow-modal)",
    animation: "ddpop .12s ease",
    cursor: "default",
    textAlign: "left",
  }),

  header: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "0 14px 8px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  row: (first: boolean): CSSProperties => ({
    padding: "10px 14px",
    borderTop: first ? "none" : "1px solid var(--border)",
  }),

  /** Severity badge stays pinned beside the FIRST line of the title: letting it
   *  wrap leaves the icon stranded on a line of its own above long titles. */
  titleRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 9,
  } satisfies CSSProperties,

  /**
   * Title + category tag, in INLINE flow rather than as flex items. As a flex
   * container a title long enough to fill the width takes the whole line and
   * pushes the tag onto a line of its own, where it reads as a detached label.
   * Inline flow lets the tag sit after the last word, however many lines the
   * title runs to.
   */
  titleWrap: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.45,
  } satisfies CSSProperties,

  title: {
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  /**
   * Keeps the tag whole when it lands at a line end, and spaces it off the
   * title's last word.
   *
   * `verticalAlign: middle` is load-bearing. CategoryTag is an `inline-flex`
   * box, and a flex container inherits its baseline from its FIRST item — the
   * icon `<svg>`, whose baseline is its bottom edge. Left on the default
   * baseline alignment the whole chip therefore hangs a few px below the title
   * it sits beside. Aligning by the box's middle instead ignores that borrowed
   * baseline entirely.
   */
  categorySlot: {
    display: "inline-flex",
    alignItems: "center",
    // Occupy the title's own line box (1.45em == titleWrap's line-height) and
    // align to its top, so the chip centres against the line rather than
    // against a baseline it does not share. `middle` gets within ~1px but is
    // measured from the x-height, so it sits fractionally low.
    height: "1.45em",
    verticalAlign: "top",
    marginLeft: 8,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  } satisfies CSSProperties,

  /** Plain text, not MonoLink — the popover is read-only, and a link-styled
   *  button that navigates nowhere would lie about being clickable. */
  location: {
    fontSize: 12.5,
    color: "var(--accent-text)",
  } satisfies CSSProperties,

  /** Two lines of rationale, then an ellipsis. The full text is on the PR
   *  detail page; this is a preview. */
  rationale: {
    marginTop: 5,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } as CSSProperties,
};
