/* IntentCard — the L03 intent surface: what the classifier reads the PR as
   trying to do, and what it deliberately left out. Classification is a step
   of every review run, but the header also carries a Recompute button that
   forces reclassification via POST /pulls/:id/intent — a real LLM call, so
   it's disabled (and shows in-flight feedback) while the mutation is
   pending. A 404 (not classified yet) renders an informational empty state
   rather than hiding, and the same header Recompute button is its action —
   there is no separate empty-state control. Confidence is intentionally not
   rendered here [2026-08-12, user: "just get rid of confidence for now"] —
   it remains computed, persisted, and used in the review prompt. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Skeleton, EmptyState, Icon, Button } from "@devdigest/ui";
import { ApiError } from "../../../../../../../lib/api";
import { usePrIntent, useRecomputeIntent } from "../../../../../../../lib/hooks";
import { s } from "./styles";

export function IntentCard({ prId }: { prId: string | null }) {
  const t = useTranslations("prReview");
  const { data, isLoading, error } = usePrIntent(prId);
  // Only a 404 means "not classified yet". Any other failure must NOT render the
  // empty state, which asserts intent will appear on the next review — an
  // affirmatively false claim when the API is down. `retry: false` (correct for
  // the 404 case) means a transient blip lands here immediately, so the
  // distinction matters. 5xx/network also raise a global toast
  // (lib/providers.tsx queryCache.onError); this keeps the card itself honest.
  const notFound = error instanceof ApiError && error.status === 404;
  const failed = error != null && !notFound;
  const recompute = useRecomputeIntent(prId);

  return (
    <section style={s.card}>
      <SectionLabel
        icon="Target"
        right={
          <Button
            kind="ghost"
            size="sm"
            icon="RefreshCw"
            loading={recompute.isPending}
            onClick={() => recompute.mutate()}
          >
            {recompute.isPending ? t("intent.card.recomputing") : t("intent.card.recompute")}
          </Button>
        }
      >
        {t("intent.card.title")}
      </SectionLabel>

      {isLoading ? (
        <div style={s.loading}>
          <Skeleton height={16} width="85%" />
          <Skeleton height={54} />
        </div>
      ) : data ? (
        <>
          <blockquote style={s.summary}>{data.intent}</blockquote>

          <div style={s.scopeSection}>
            <div style={s.scopeHeading}>{t("intent.card.inScope")}</div>
            <ul style={s.scopeList}>
              {data.in_scope.map((item, i) => (
                <li key={i} style={s.scopeItem}>
                  <Icon.CheckCircle size={14} style={{ ...s.scopeIcon, color: "var(--ok)" }} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div style={s.scopeSection}>
            <div style={s.scopeHeading}>{t("intent.card.outOfScope")}</div>
            <ul style={s.scopeList}>
              {data.out_of_scope.map((item, i) => (
                <li key={i} style={{ ...s.scopeItem, ...s.scopeItemOut }}>
                  <Icon.XCircle size={14} style={{ ...s.scopeIcon, color: "var(--text-muted)" }} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : failed ? (
        <EmptyState icon="AlertTriangle" title={t("intent.card.errorState")} />
      ) : (
        <EmptyState icon="Info" title={t("intent.card.emptyState")} />
      )}
    </section>
  );
}
