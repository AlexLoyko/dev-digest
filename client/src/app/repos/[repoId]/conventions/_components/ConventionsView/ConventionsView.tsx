/* /repos/:repoId/conventions — scan the cloned repo for house rules, curate the
   grounded candidates, and merge the accepted ones into one Skill. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { RepoNotFound } from "../../../../../../components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "../../../../../../lib/repo-context";
import {
  useConventions,
  useExtractConventions,
  useRejectConvention,
  useSetConventionAccepted,
} from "../../../../../../lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { s } from "../styles";

/** "2m", "1h", "3d" — coarse on purpose; the exact instant never matters here. */
function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ConventionsView() {
  const t = useTranslations("conventions");
  const { repoId } = useParams<{ repoId: string }>();
  const { activeRepo } = useActiveRepo();
  const notFound = useRepoNotFound(repoId);

  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions(repoId);
  const setAccepted = useSetConventionAccepted(repoId);
  const reject = useRejectConvention(repoId);
  const [modalOpen, setModalOpen] = React.useState(false);

  const repoName = activeRepo?.full_name?.split("/").pop() ?? t("page.repoFallback");
  const candidates = data?.candidates ?? [];
  const acceptedCount = candidates.filter((c) => c.accepted).length;
  const allAccepted = candidates.length > 0 && acceptedCount === candidates.length;

  if (notFound) {
    return (
      <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const toggleAll = () => {
    const next = !allAccepted;
    for (const c of candidates) {
      if (c.accepted !== next) setAccepted.mutate({ id: c.id, accepted: next });
    }
  };

  const scanned = relativeTime(data?.scanned_at ?? null);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      {modalOpen && (
        <CreateSkillModal
          repoId={repoId}
          repoName={repoName}
          onClose={() => setModalOpen(false)}
        />
      )}

      <div style={s.page}>
        <div style={s.headRow}>
          <h1 style={s.h1}>
            {t("page.headingPrefix")}
            <span className="mono" style={s.repoName}>
              {repoName}
            </span>
          </h1>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            loading={extract.isPending}
            disabled={extract.isPending}
            onClick={() => extract.mutate()}
          >
            {extract.isPending ? t("page.scanning") : t("page.rescan")}
          </Button>
        </div>

        <div style={s.subtitle}>
          {candidates.length > 0
            ? `${t("page.detectedFrom", { count: data?.considered_files ?? 0 })} · ${
                scanned ? t("page.lastScan", { when: scanned }) : t("page.neverScanned")
              }`
            : t("page.subtitle")}
        </div>

        {extract.isError && (
          <div style={{ fontSize: 13, color: "var(--crit)", marginBottom: 16 }}>
            {t("page.extractionFailed")}
            {extract.error instanceof Error ? `: ${extract.error.message}` : ""}
          </div>
        )}

        {candidates.length > 0 && (
          <div style={s.toolbar}>
            <Button
              kind="secondary"
              size="sm"
              icon={allAccepted ? "X" : "Check"}
              onClick={toggleAll}
            >
              {allAccepted ? t("page.deselectAll") : t("page.acceptAll")}
            </Button>
            <span style={s.toolbarCount}>
              {t("page.acceptedCount", { accepted: acceptedCount, total: candidates.length })}
            </span>
            <Button
              kind="primary"
              size="sm"
              icon="Sparkles"
              disabled={acceptedCount === 0}
              onClick={() => setModalOpen(true)}
            >
              {t("page.createSkill")}
            </Button>
          </div>
        )}

        {isLoading && (
          <div style={s.list}>
            <Skeleton height={180} />
            <Skeleton height={180} />
          </div>
        )}

        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={extract.isPending ? t("page.scanning") : t("page.empty.cta")}
            onCta={() => extract.mutate()}
          />
        )}

        {candidates.length > 0 && (
          <div style={s.list}>
            {candidates.map((c) => (
              <ConventionCard
                key={c.id}
                candidate={c}
                pending={setAccepted.isPending || reject.isPending}
                repoFullName={activeRepo?.full_name ?? null}
                scannedSha={data?.scanned_sha ?? null}
                onToggleAccept={(accepted) => setAccepted.mutate({ id: c.id, accepted })}
                onReject={() => reject.mutate(c.id)}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
