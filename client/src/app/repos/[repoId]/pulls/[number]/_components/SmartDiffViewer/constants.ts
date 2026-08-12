/* Static config for the Smart Diff view: what each role is called and how a
   severity renders as an inline chip. */
import type { IconName } from "@devdigest/ui";
import type { SmartDiffRole } from "@devdigest/shared";

/**
 * Per-role presentation. `labelKey`/`descKey` are `prReview.smartDiff.*` keys —
 * never inline the display strings (see the package invariants).
 */
export const ROLE_META: Record<
  SmartDiffRole,
  { labelKey: string; descKey: string; icon: IconName; color: string }
> = {
  core: { labelKey: "coreLabel", descKey: "coreDesc", icon: "Boxes", color: "var(--accent)" },
  wiring: { labelKey: "wiringLabel", descKey: "wiringDesc", icon: "Workflow", color: "var(--warn)" },
  boilerplate: {
    labelKey: "boilerplateLabel",
    descKey: "boilerplateDesc",
    icon: "FileText",
    color: "var(--text-muted)",
  },
};

/**
 * How many lines ONE finding may decorate — the same cap the server applies to
 * `finding_lines` (`server/src/modules/reviews/constants.ts`).
 *
 * It must match: a model can emit `start_line: 1, end_line: 999999`, and the
 * grounding gate keeps that finding because the range does intersect a real
 * hunk. Without the cap the client walks the whole range on every render and
 * paints more of the file than the server says the finding covers.
 */
export const MAX_FINDING_LINE_SPAN = 500;

/**
 * Severity rank — a line carrying several findings takes the colour of its
 * worst one, so a blocker is never hidden behind a suggestion sharing the line.
 */
export const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
  INFO: 0,
};
