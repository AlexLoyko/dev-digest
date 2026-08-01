/* FindingsPopover — the floating preview behind the severity badges. Read-only:
   accept/dismiss live on the PR detail page, because a panel that disappears on
   mouse-out is a hostile place for a destructive action. */
"use client";

import React from "react";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  ConfidenceNum,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { Finding } from "@devdigest/shared";
import { lineLabel, type PopoverPosition } from "./helpers";
import { s } from "./styles";

export interface FindingsPopoverProps {
  /** Already sorted by the caller — worst first. */
  findings: Finding[];
  /** Localised heading, e.g. "6 findings". */
  label: string;
  position: PopoverPosition;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  /** Lets the owner tell its own scroll apart from the page's. */
  panelRef?: React.Ref<HTMLDivElement>;
}

export function FindingsPopover({
  findings,
  label,
  position,
  onMouseEnter,
  onMouseLeave,
  panelRef,
}: FindingsPopoverProps) {
  return (
    <div
      ref={panelRef}
      role="tooltip"
      style={s.popover(position)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // PR-list rows navigate on click and this panel overlays its neighbours,
      // so a click inside it must not reach the row underneath.
      onClick={(e) => e.stopPropagation()}
    >
      <div style={s.header}>
        <Icon.AlertOctagon size={12} />
        {label}
      </div>
      {findings.map((f, i) => (
        <div key={f.id} style={s.row(i === 0)}>
          <div style={s.titleRow}>
            <SeverityBadge severity={f.severity as Severity} compact />
            <div style={s.titleWrap}>
              <span style={s.title}>{f.title}</span>
              <span style={s.categorySlot}>
                <CategoryTag category={f.category as Category} />
              </span>
            </div>
          </div>
          <div style={s.metaRow}>
            <span className="mono" style={s.location}>
              {f.file}:{lineLabel(f)}
            </span>
            <ConfidenceNum value={f.confidence} />
          </div>
          <div style={s.rationale}>{f.rationale}</div>
        </div>
      ))}
    </div>
  );
}
