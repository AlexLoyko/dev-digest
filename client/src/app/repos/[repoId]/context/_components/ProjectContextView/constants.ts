import type { IconName } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";

/**
 * NFR-2 / EC-10: the repo can contain thousands of matching documents. The
 * list stays usable via the filter input rather than rendering (or
 * virtualizing — no such library is in the project) every row eagerly.
 */
export const LIST_RENDER_CAP = 200;

/** Order the three scanned roots are named in (empty state, chips). Mirrors
 * the server's `CONTEXT_ROOT_DIRS` (server/src/modules/context/constants.ts)
 * — not re-imported since it isn't exported through `@devdigest/shared`. */
export const CONTEXT_ROOTS = ["specs", "docs", "insights"] as const;

/** Per-root chip meta. `labelKey` resolves under `context.sourceRoot`. */
export const ROOT_META: Record<
  NonNullable<SpecFile["root"]>,
  { c: string; bg: string; labelKey: string }
> = {
  specs: { c: "var(--accent-text)", bg: "var(--accent-bg)", labelKey: "specs" },
  docs: { c: "var(--ok)", bg: "var(--ok-bg)", labelKey: "docs" },
  insights: { c: "var(--warn)", bg: "var(--warn-bg)", labelKey: "insights" },
};

type ThreatLevel = NonNullable<SpecFile["threat_level"]>;

/** Per-threat-level badge meta. `labelKey` resolves under `context.threat`. */
export const THREAT_META: Record<ThreatLevel, { c: string; bg: string; icon: IconName; labelKey: string }> = {
  safe: { c: "var(--ok)", bg: "var(--ok-bg)", icon: "Shield", labelKey: "safe" },
  suspicious: { c: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle", labelKey: "suspicious" },
  dangerous: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertTriangle", labelKey: "dangerous" },
  unknown: { c: "var(--text-muted)", bg: "var(--bg-hover)", icon: "Shield", labelKey: "unknown" },
};

/** Marker used to key the EC-1 not-cloned state off `index.message` — a
 * sentinel, never rendered as display text (see `service.ts`'s
 * `NOT_CLONED_INDEX`). */
export const NOT_CLONED_MARKER = "not_cloned";
