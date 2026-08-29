"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorBoundary } from "react-error-boundary";
import { SectionLabel } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/pulls";
import { s } from "./styles";
import { IntentCard } from "./IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard";
import { BriefCard } from "../BriefCard";
import { ReviewFocusCard } from "../ReviewFocusCard";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  /** owner/repo + head sha — threaded through to `BriefCard` and
   *  `ReviewFocusCard` for their GitHub blob-link building. Same nullable
   *  convention `FindingsTab`/`FindingCard` already use for these two
   *  values (both can be unknown while the repo/PR is still loading). */
  repoFullName?: string | null;
  headSha?: string | null;
}

export function OverviewTab({ prBody, prId, repoFullName, headSha }: OverviewTabProps) {
  const t = useTranslations("prReview");
  const tBrief = useTranslations("brief");
  const tCommon = useTranslations("common");
  const { data: blastRadius, isLoading: blastLoading } = useBlastRadius(prId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* PR brief — AC-1: the brief's "what"/"why" prose (and, once a run
         has completed, its verdict headline) ahead of everything else on
         the tab, matching `design/01-loaded-overview.png`. */}
      <section>
        <SectionLabel icon="FileText">{tBrief("card.sectionLabel")}</SectionLabel>
        <ErrorBoundary
          fallback={
            <div className="text-sm text-red-400 p-4">{tCommon("states.error")}</div>
          }
        >
          <BriefCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
        </ErrorBoundary>
      </section>

      {/* Two-column: Intent (left) + Blast Radius (right) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        {prId && <IntentCard prId={prId} />}

        <section style={{ display: "flex", flexDirection: "column" }}>
          <SectionLabel icon="GitPullRequest">
            {t("blastRadius.title")}
          </SectionLabel>
          <ErrorBoundary
            fallback={
              <div className="text-sm text-red-400 p-4">
                {t("blastRadius.error")}
              </div>
            }
          >
            <BlastRadiusCard
              blastRadius={blastRadius}
              isLoading={blastLoading}
            />
          </ErrorBoundary>
        </section>
      </div>

      <ErrorBoundary
        fallback={
          <div className="text-sm text-red-400 p-4">{tCommon("states.error")}</div>
        }
      >
        <ReviewFocusCard prId={prId} repoFullName={repoFullName} headSha={headSha} />
      </ErrorBoundary>

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.descriptionLabel")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </div>
  );
}
