/* findings-badges — severity badges + hover preview, shared by the PR list's
   FINDINGS column and the Agent-runs timeline (specs/0002-findings-badges.md). */
export { FindingsBadges } from "./FindingsBadges";
export type { FindingsBadgesProps } from "./FindingsBadges";
export { countBySeverity, sortForDisplay, lineLabel, placePopover } from "./helpers";
