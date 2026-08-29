/* ReviewFocusCard — AC-6: the brief's review-focus entries as an ordered,
   activatable list. Each entry opens its file at its line range on GitHub
   in a new tab (spec Q-4, same as every other file reference in the
   product) — never the changed-files tab.

   Security (OWASP A05): `entry.reason` is model output that can be steered
   by an attacker-controlled PR description. It is rendered as plain text
   only — never markdown, never dangerouslySetInnerHTML. The link target is
   built with `githubBlobUrl`, which percent-encodes each path segment, so a
   path containing a space or `#` cannot break out of the URL. */
"use client";

import { useTranslations } from "next-intl";
import { Card, SectionLabel, Badge, MonoLink, EmptyState } from "@devdigest/ui";
import type { ReviewFocusEntry } from "@devdigest/shared";
import { useBrief } from "@/lib/hooks";
import { githubBlobUrl } from "@/lib/utils/githubUrls";
import { s } from "./styles";

interface ReviewFocusCardProps {
  prId: string | number | null;
  repoFullName?: string | null;
  headSha?: string | null;
}

/** Stable key from the file location, never the array index — entries can
 *  be reordered/regenerated between renders. */
function entryKey(entry: ReviewFocusEntry): string {
  return `${entry.file.path}:${entry.file.start_line ?? ""}:${entry.file.end_line ?? ""}`;
}

/** "path:line" or "path:start-end"; just the path when the entry applies to
 *  the whole file (no line range grounded to it). */
function fileLocation(file: ReviewFocusEntry["file"]): string {
  if (file.start_line == null) return file.path;
  if (file.end_line == null || file.end_line === file.start_line) {
    return `${file.path}:${file.start_line}`;
  }
  return `${file.path}:${file.start_line}-${file.end_line}`;
}

function ReviewFocusItem({
  entry,
  repoFullName,
  headSha,
}: {
  entry: ReviewFocusEntry;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const href =
    repoFullName && headSha
      ? githubBlobUrl(
          repoFullName,
          headSha,
          entry.file.path,
          entry.file.start_line,
          entry.file.end_line,
        )
      : undefined;

  return (
    <li style={s.item}>
      <span style={s.bullet} aria-hidden="true">
        •
      </span>
      <span style={s.entryText}>
        <MonoLink href={href}>{fileLocation(entry.file)}</MonoLink>
        {" — "}
        {entry.reason}
      </span>
    </li>
  );
}

export function ReviewFocusCard({ prId, repoFullName, headSha }: ReviewFocusCardProps) {
  const t = useTranslations("brief");
  const { data } = useBrief(prId);
  const brief = data?.brief;

  // Nothing to show until a brief exists (loading or never generated) —
  // this is not the empty state, which is reserved for "a brief exists
  // but singled out nothing".
  if (!brief) return null;

  const entries = brief.review_focus;

  return (
    <Card>
      <SectionLabel
        icon="ListChecks"
        right={
          entries.length > 0 ? (
            <Badge color="var(--text-muted)">{entries.length}</Badge>
          ) : undefined
        }
      >
        {t("reviewFocus.sectionLabel")}
      </SectionLabel>

      {entries.length === 0 ? (
        <EmptyState
          icon="ListChecks"
          title={t("reviewFocus.empty.title")}
          body={t("reviewFocus.empty.body")}
        />
      ) : (
        <ol style={s.list}>
          {entries.map((entry) => (
            <ReviewFocusItem
              key={entryKey(entry)}
              entry={entry}
              repoFullName={repoFullName}
              headSha={headSha}
            />
          ))}
        </ol>
      )}
    </Card>
  );
}
