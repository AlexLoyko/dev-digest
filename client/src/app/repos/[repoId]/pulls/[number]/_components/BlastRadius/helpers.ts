/* helpers.ts — pure link-builders for blast radius rows.
 *
 * THE RULE (see docs/plans or the task brief this was built from): caller line
 * numbers come from the repo-intel indexer parsing `indexed_sha`, NEVER the
 * PR's `head_sha`. Caller files are almost never files the PR touched, so a
 * link built against `head_sha` can point at the wrong line, or past EOF.
 *
 *  - Caller rows              → indexedSha, WITH a line anchor.
 *  - Changed-symbol header    → headSha, file only, NO line anchor.
 *  - Endpoint/cron chips      → indexedSha, file only, NO line anchor.
 *  - Whenever indexedSha is null (degraded/not_indexed/index_failed/flag_off)
 *    → return null; callers must render plain text, never a link.
 */
import { githubBlobUrl } from "@/lib/utils/githubUrls";
import type { BlastCallerView, BlastFactRef } from "@devdigest/shared";

/** Caller row link — indexed_sha + line anchor. Null when there's no indexed SHA. */
export function callerHref(
  repoFullName: string,
  indexedSha: string | null,
  caller: BlastCallerView,
): string | null {
  if (!indexedSha) return null;
  return githubBlobUrl(repoFullName, indexedSha, caller.file, caller.line);
}

/** Changed-symbol header link — always head_sha, file-level only (no line anchor). */
export function symbolHref(repoFullName: string, headSha: string, file: string): string {
  return githubBlobUrl(repoFullName, headSha, file);
}

/** Endpoint/cron chip link — indexed_sha, file-level only. Null when there's no indexed SHA. */
export function factHref(
  repoFullName: string,
  indexedSha: string | null,
  fact: BlastFactRef,
): string | null {
  if (!indexedSha) return null;
  return githubBlobUrl(repoFullName, indexedSha, fact.file);
}
