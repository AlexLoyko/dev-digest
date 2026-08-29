/** Data-testids for BriefCard's fixed three-region anatomy (AC-20). Every
 *  state the card renders (loaded here; the in-progress / failure / no-run /
 *  never-generated states land in later tasks — see BriefCard.tsx) must keep
 *  exactly these three regions, never adding or dropping one. */
export const BRIEF_CARD_TESTIDS = {
  leading: "brief-card-leading",
  main: "brief-card-main",
  trailing: "brief-card-trailing",
} as const;
