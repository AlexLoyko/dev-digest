/* BlastRadius — impact-analysis card: which callers/endpoints/crons are
 * reachable from this PR's changed symbols. Mirrors IntentCard's structure
 * (Card + SectionLabel + loading/error/data states). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, SectionLabel, Chip, Badge, Skeleton, Icon } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { BLAST_VIEWS, type BlastView } from "./constants";
import { BlastTree } from "./BlastTree";
import { BlastGraph } from "./BlastGraph";
import { PriorPrs } from "./PriorPrs";
import { s } from "./styles";

interface BlastRadiusProps {
  prId: string | number | null;
  repoFullName: string | null;
  headSha: string;
}

export function BlastRadius({ prId, repoFullName, headSha }: BlastRadiusProps) {
  const t = useTranslations("blast");
  const { data, isLoading, isError } = useBlastRadius(prId);
  const [view, setView] = React.useState<BlastView>("tree");

  return (
    <Card pad style={{ marginBottom: 0 }}>
      <SectionLabel icon="Workflow">{t("sectionLabel")}</SectionLabel>

      {isLoading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton height={16} width="60%" />
          <Skeleton height={40} />
          <Skeleton height={40} />
        </div>
      )}

      {isError && !isLoading && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>{t("error")}</p>
      )}

      {!isLoading && !isError && data && data.state === "degraded" && (
        <p style={s.explanation}>{t(`reason.${data.reason}`)}</p>
      )}

      {!isLoading && !isError && data && data.state !== "degraded" && data.symbols.length === 0 && (
        <p style={s.explanation}>{t("reason.no_symbols")}</p>
      )}

      {!isLoading && !isError && data && data.state !== "degraded" && data.symbols.length > 0 && (
        <div>
          {data.state === "partial" && (
            <div style={s.partialNote}>
              <Icon.AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />
              <span>{t("state.partial")}</span>
            </div>
          )}

          <div style={s.statRow}>
            <Badge icon="Target">
              {data.counts.symbols} {t("stat.symbols")}
            </Badge>
            <Badge icon="Users">
              {data.counts.callers} {t("stat.callers")}
            </Badge>
            <Badge icon="Globe">
              {data.counts.endpoints} {t("stat.endpoints")}
            </Badge>
            <Badge icon="Clock">
              {data.counts.crons} {t("stat.crons")}
            </Badge>
          </div>

          <div style={s.viewToggle}>
            {BLAST_VIEWS.map((v) => (
              <Chip key={v} active={view === v} onClick={() => setView(v)}>
                {t(`view.${v}`)}
              </Chip>
            ))}
          </div>

          {view === "tree" ? (
            <BlastTree
              symbols={data.symbols}
              repoFullName={repoFullName}
              indexedSha={data.indexed_sha}
              headSha={headSha}
            />
          ) : (
            <BlastGraph symbols={data.symbols} />
          )}

          <div style={{ marginTop: 16 }}>
            <PriorPrs priorPrs={data.prior_prs} repoFullName={repoFullName} />
          </div>
        </div>
      )}
    </Card>
  );
}
