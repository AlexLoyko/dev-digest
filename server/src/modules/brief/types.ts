/**
 * types.ts — input shape for PR Brief generation.
 *
 * Onion layer: pure application types (no I/O, no Container, no Drizzle
 * types leak in here — `service.ts` maps DB rows into these before calling
 * `buildBriefUserMessage`).
 *
 * `BriefInputParts` deliberately never carries `pr_files.patch` (the diff
 * hunk body) — `BriefChangedFile` carries only a path and +/- counts. This
 * is the whole of AC-3: the model sees WHAT changed and HOW MUCH, never the
 * raw diff body. `budget.ts` (T3) consumes and returns this same shape after
 * shedding parts to fit the token budget.
 */
import type { Intent } from '@devdigest/shared';

/** PR-level metadata (title, description, branch info) — never the diff body. */
export interface BriefPrMeta {
  title: string;
  body: string | null;
  author: string;
  branch: string;
  base: string;
  headSha: string;
  status: string;
}

/** Aggregate diff stats for the whole PR (already summed server-side). */
export interface BriefDiffStats {
  additions: number;
  deletions: number;
  filesCount: number;
}

/**
 * One changed file: path + line counts only. NEVER add a `patch`/`diff`
 * field here — `pr_files.patch` must not be read anywhere in this module
 * (AC-3, NFR-7).
 */
export interface BriefChangedFile {
  path: string;
  additions: number;
  deletions: number;
}

/** A best-effort linked issue (GitHub issue or PR resolved from the PR body). */
export interface BriefLinkedIssue {
  title: string;
  body: string | null;
}

/** A resolved project-context document. Always `[]` in v1 — see plan Open questions. */
export interface BriefContextDoc {
  path: string;
  text: string;
}

/**
 * The full set of inputs that may be sent to the brief-generation model call.
 * Every optional signal (`intent`, `blastSummary`, `linkedIssue`) is `null`
 * when absent rather than omitted, so `budget.ts` and `prompt.ts` have one
 * consistent shape to reason about degradation from.
 */
export interface BriefInputParts {
  pr: BriefPrMeta;
  diffStats: BriefDiffStats;
  changedFiles: BriefChangedFile[];
  intent: Intent | null;
  blastSummary: string | null;
  linkedIssue: BriefLinkedIssue | null;
  /** Project-context docs — always `[]` in v1; the shape exists so a later
   *  change can populate it without another contract or type change. */
  projectContextDocs: BriefContextDoc[];
}
