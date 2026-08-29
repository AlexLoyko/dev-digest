import type { CSSProperties } from "react";
import { s as verdictStyles } from "../VerdictBanner/styles";

/** BriefCard-only styles. The shared anatomy pieces (`wrap`, `iconBox`,
 *  `main`, `titleRow`, `label`, `summary`) are reused directly from
 *  `../VerdictBanner/styles` per the plan's "reproduce VerdictBanner's
 *  anatomy" constraint — this file only adds what VerdictBanner has no
 *  equivalent for. */
export const s = {
  /** The "what" paragraph — the card's most prominent prose
   *  (`design/01-loaded-overview.png`): primary text tone and a heavier
   *  weight than `../VerdictBanner/styles`'s `summary` (`--text-secondary`,
   *  weight 400 — VerdictBanner itself keeps using that unmodified; this is
   *  BriefCard's own override, not an edit to the shared file). Same
   *  size/line-height/top-margin as `summary` — only tone and weight
   *  change, so swapping styles doesn't shift layout. */
  what: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    fontWeight: 600,
    marginTop: 8,
  } satisfies CSSProperties,
  /** The "why" paragraph — one step more muted than the "what" paragraph
   *  above, per `design/states/NoAgentRun.dc.html`. */
  why: {
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-muted)",
    marginTop: 6,
  } satisfies CSSProperties,
  /** The score ring's label ("PR score" from the catalogue), rendered
   *  uppercase via CSS `text-transform` only — never editing the copy
   *  itself, so the accessible name (and any `getByText(card.score.label)`
   *  assertion) still matches "PR score" verbatim. Reuses
   *  `verdictStyles.scoreLabel`'s size/colour/letter-spacing unchanged. */
  scoreLabel: {
    ...verdictStyles.scoreLabel,
    textTransform: "uppercase",
  } satisfies CSSProperties,
  /** Groups the score ring with its label so the pair travels together as
   *  ONE flex item inside `trailing` (see `trailing`'s own comment) —
   *  without this wrapper, `trailing`'s `justifyContent: "space-between"`
   *  would spread the ring and its label apart instead of keeping them
   *  adjacent in the card's vertical middle. */
  scoreGroup: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
  } satisfies CSSProperties,
  /** Groups both cost/token lines (AC-10's brief-own row + AC-12's run row)
   *  so they stack as ONE flex item pinned to the bottom-right corner of the
   *  card (`design/01-loaded-overview.png`) — `alignSelf: "flex-end"` pushes
   *  the pair to `trailing`'s right edge (the cross axis of its column flex
   *  layout); being the LAST item in `trailing`, `trailing`'s own
   *  `justifyContent: "space-between"` pushes it to the bottom. */
  costGroup: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
    alignSelf: "flex-end",
  } satisfies CSSProperties,
  /** Trailing region. `minWidth: 52` reserves the footprint of the 52px
   *  `CircularScore` (AC-20) so the main column's measure never changes
   *  when a score first appears. Always present — never conditionally
   *  omitted — even when it holds only the regenerate control, or nothing
   *  at all.
   *
   *  `justifyContent: "space-between"` + `alignSelf: "stretch"` distribute
   *  the region's (up to) three groups across the card's full height —
   *  regenerate control at the top, the score ring+label in the middle,
   *  the cost block pinned to the bottom — instead of crowding them all
   *  together against the ring, which is the mistake this task corrects.
   *  `alignSelf: "stretch"` is required for that spread to have any room to
   *  work with: `verdictStyles.wrap` (not this file's to edit) sets
   *  `alignItems: "flex-start"` on the row, which would otherwise
   *  shrink-wrap this column to its own content height. */
  trailing: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
    flexShrink: 0,
    minWidth: 52,
    alignSelf: "stretch",
  } satisfies CSSProperties,
} as const;
