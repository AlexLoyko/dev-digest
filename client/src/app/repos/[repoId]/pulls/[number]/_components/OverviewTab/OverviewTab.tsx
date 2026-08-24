"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import { s } from "./styles";
import { IntentCard } from "./IntentCard";
import { BlastRadius } from "../BlastRadius";

interface OverviewTabProps {
  prBody: string | null | undefined;
  prId: string | null;
  repoFullName: string | null;
  headSha: string;
}

export function OverviewTab({ prBody, prId, repoFullName, headSha }: OverviewTabProps) {
  const t = useTranslations("prReview");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 20 }}>
        {prId && <IntentCard prId={prId} />}
        {prId && <BlastRadius prId={prId} repoFullName={repoFullName} headSha={headSha} />}
      </div>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.descriptionLabel")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </div>
  );
}
