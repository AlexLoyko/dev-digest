/* RunCostBadge — the USD cost of one review run, rendered identically wherever
   cost appears. Two variants: `cell` for the PR-list COST column, `inline` for
   the Agent-runs timeline usage line. The run-trace drawer does NOT use this —
   it feeds `formatCost` into its existing Stat tile. */
"use client";

import React from "react";
import { EM_DASH, formatCost } from "./helpers";
import { s } from "./styles";

export interface RunCostBadgeProps {
  /** USD cost; null/undefined means "no cost data" and renders an em dash. */
  costUsd: number | null | undefined;
  variant?: "cell" | "inline";
  /** Optional override for the no-data tooltip (e.g. "never reviewed"). */
  emptyTitle?: string;
}

export function RunCostBadge({ costUsd, variant = "cell", emptyTitle }: RunCostBadgeProps) {
  const text = formatCost(costUsd);
  const empty = text === EM_DASH;
  return (
    <span
      style={{ ...(variant === "cell" ? s.cell : s.inline), ...(empty ? s.muted : null) }}
      {...(empty && emptyTitle ? { title: emptyTitle } : null)}
    >
      {text}
    </span>
  );
}
