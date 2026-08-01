/* FindingsBadges — a run's or a PR's findings as one compact severity badge per
   severity present, with a hover preview of the findings themselves. Shared by
   the PR list's FINDINGS column and the Agent-runs timeline. */
"use client";

import React from "react";
import { SeverityBadge, type Severity } from "@devdigest/ui";
import type { Finding } from "@devdigest/shared";
import { FindingsPopover } from "./FindingsPopover";
import { CLOSE_DELAY_MS } from "./constants";
import { countBySeverity, placePopover, sortForDisplay, type PopoverPosition } from "./helpers";
import { s } from "./styles";

export interface FindingsBadgesProps {
  /** Outstanding findings. Empty renders nothing at all. */
  findings: Finding[];
  /** Localised popover heading, e.g. "6 findings" / "2 findings in this run". */
  popoverLabel: string;
}

export function FindingsBadges({ findings, popoverLabel }: FindingsBadgesProps) {
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = React.useState<PopoverPosition | null>(null);

  const groups = React.useMemo(() => countBySeverity(findings), [findings]);
  const sorted = React.useMemo(() => sortForDisplay(findings), [findings]);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const open = React.useCallback(() => {
    cancelClose();
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition(
      placePopover(rect, { width: window.innerWidth, height: window.innerHeight }),
    );
  }, [cancelClose]);

  const closeNow = React.useCallback(() => {
    cancelClose();
    setPosition(null);
  }, [cancelClose]);

  // Delayed so the pointer can cross the gap into the panel and scroll it.
  const scheduleClose = React.useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setPosition(null), CLOSE_DELAY_MS);
  }, [cancelClose]);

  React.useEffect(() => cancelClose, [cancelClose]);

  // The panel is positioned once, from the anchor's viewport rect — so a scroll
  // of the PAGE invalidates it. Closing is cheaper and less jittery than
  // tracking, and the badges are right there to hover again.
  //
  // The panel scrolls internally though (it has a max height), and a scroll
  // event inside it is caught by this same capture listener. Ignoring those is
  // what makes a long findings list readable at all — otherwise the first wheel
  // tick over the panel closes it and scrolls the page instead.
  React.useEffect(() => {
    if (!position) return;
    const onScroll = (e: Event) => {
      // `instanceof Node` matters: a page scroll targets `window`, and
      // Node.contains() throws on a non-Node argument rather than returning
      // false — which would swallow the close and leave the panel stranded.
      const target = e.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      setPosition(null);
    };
    const onResize = () => setPosition(null);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [position]);

  if (findings.length === 0) return null;

  return (
    <span
      ref={anchorRef}
      tabIndex={0}
      style={s.anchor}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      onFocus={open}
      onBlur={closeNow}
    >
      {groups.map((g) => (
        <SeverityBadge
          key={g.severity}
          severity={g.severity as Severity}
          count={g.count}
          compact
        />
      ))}
      {position && (
        <FindingsPopover
          findings={sorted}
          label={popoverLabel}
          position={position}
          panelRef={panelRef}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />
      )}
    </span>
  );
}
