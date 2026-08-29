/**
 * Maps a PR-brief risk level (`RiskSeverity`) to the finding severity
 * (`Severity`) the product already uses everywhere else, so a risk of a
 * given weight reads the same as a finding of equivalent weight — one
 * visual vocabulary, not two (AC-21).
 *
 * `INFO` is deliberately never a target: there is no risk level of that
 * weight, and consumers must not invent one.
 */
import type { RiskSeverity } from "@devdigest/shared";
import type { Severity } from "@devdigest/ui";

/** Exhaustive, fallback-free mapping — every `RiskSeverity` key is required. */
const RISK_TO_SEVERITY: Record<RiskSeverity, Severity> = {
  high: "CRITICAL",
  medium: "WARNING",
  low: "SUGGESTION",
};

/**
 * Resolves a risk level to the `Severity` key consumers pass to `SEV[...]`
 * (from `@devdigest/ui`) for colour, icon and label.
 */
export function riskLevelToSeverity(level: RiskSeverity): Severity {
  return RISK_TO_SEVERITY[level];
}
