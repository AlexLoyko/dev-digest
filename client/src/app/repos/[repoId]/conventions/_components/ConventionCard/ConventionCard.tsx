/* ConventionCard — one convention candidate: the rule, its grounded evidence
   (file:line + snippet), a confidence meter, and accept/reject.

   Accept TOGGLES (Accept ⇄ Accepted). Reject is destructive — the server hard
   deletes the row, so the card does not come back. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, MonoLink, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate } from "../../../../../../lib/hooks/conventions";
import { githubBlobUrl } from "../../../../../../lib/github-urls";
import { s } from "../styles";

/** `src/api/users.ts:23-31`, collapsing to `:23` for a single-line span. */
function evidenceRef(c: ConventionCandidate): string {
  if (c.evidence_start_line === null) return c.evidence_path;
  if (c.evidence_end_line === null || c.evidence_end_line === c.evidence_start_line) {
    return `${c.evidence_path}:${c.evidence_start_line}`;
  }
  return `${c.evidence_path}:${c.evidence_start_line}-${c.evidence_end_line}`;
}

function confidenceColor(pct: number): string {
  if (pct >= 85) return "var(--ok)";
  if (pct >= 65) return "var(--warn)";
  return "var(--text-muted)";
}

export function ConventionCard({
  candidate,
  pending,
  repoFullName,
  scannedSha,
  onToggleAccept,
  onReject,
}: {
  candidate: ConventionCandidate;
  pending?: boolean;
  repoFullName?: string | null;
  /** Revision the evidence was cited against; links pin to it, never to a branch. */
  scannedSha?: string | null;
  onToggleAccept: (accepted: boolean) => void;
  onReject: () => void;
}) {
  const t = useTranslations("conventions");
  const [copied, setCopied] = React.useState(false);

  const pct = Math.round(candidate.confidence * 100);
  const label = evidenceRef(candidate);

  const { following_files: following, applicable_files: applicable } = candidate;
  const basis =
    following !== null && applicable !== null && applicable > 0
      ? t("card.followedIn", { following, applicable })
      : null;

  // Both are required: `sha` is interpolated as a raw path segment, so an empty
  // one would produce `/blob//path`. Built from full_name — never from the git
  // remote, which embeds a PAT.
  const href =
    repoFullName && scannedSha
      ? githubBlobUrl(
          repoFullName,
          scannedSha,
          candidate.evidence_path,
          candidate.evidence_start_line ?? undefined,
          candidate.evidence_end_line ?? undefined
        )
      : null;

  const copy = () => {
    void navigator.clipboard?.writeText(`${label}\n\n${candidate.evidence_snippet}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={s.card(candidate.accepted)} data-convention-id={candidate.id}>
      <div style={s.cardMain}>
        <div style={s.rule}>{candidate.rule}</div>

        <div style={s.evidence}>
          <div style={s.evidenceHead}>
            {/* No href → plain text, NOT a bare MonoLink: without an href it
                renders a focusable button that does nothing. */}
            {href ? (
              <MonoLink href={href}>{label}</MonoLink>
            ) : (
              <span className="mono">{label}</span>
            )}
            <button
              type="button"
              title={t("card.copyEvidence")}
              aria-label={copied ? t("card.copied") : t("card.copyEvidence")}
              onClick={copy}
              style={s.copyBtn}
            >
              {copied ? <Icon.Check size={12} /> : <Icon.Copy size={12} />}
            </button>
          </div>
          <pre className="mono" style={s.evidencePre}>
            {candidate.evidence_snippet}
          </pre>
        </div>

        <div style={s.confidenceRow}>
          <span>{t("card.confidence")}</span>
          <div style={s.confidenceBar}>
            <ProgressBar value={pct} color={confidenceColor(pct)} />
          </div>
          <span className="mono tnum">{pct}%</span>
          {/* The basis for the score, so it's auditable rather than opaque.
              Hidden when the scan predates the counts (older rows are null). */}
          {basis && <span style={s.confidenceBasis}>{basis}</span>}
        </div>
      </div>

      <div style={s.actions}>
        <Button
          kind={candidate.accepted ? "primary" : "secondary"}
          size="sm"
          icon={candidate.accepted ? "Check" : "Plus"}
          disabled={pending}
          onClick={() => onToggleAccept(!candidate.accepted)}
        >
          {candidate.accepted ? t("card.accepted") : t("card.accept")}
        </Button>
        <Button kind="ghost" size="sm" icon="X" disabled={pending} onClick={onReject}>
          {t("card.reject")}
        </Button>
      </div>
    </div>
  );
}
