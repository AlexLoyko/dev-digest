/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab state lives in query (?tab). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "../../../../../components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import { usePullDetail, usePulls, useSmartDiff } from "../../../../../lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { usePrReviews, useCancelRun, usePrActiveRuns, usePrRuns, useDeleteRun } from "../../../../../lib/hooks/reviews";
import { useActiveRepo, useRepoNotFound } from "../../../../../lib/repo-context";
import { ApiError } from "../../../../../lib/api";
import { githubPrUrl } from "../../../../../lib/github-urls";
import type { FindingRecord } from "@devdigest/shared";

export default function PRDetailPage() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  // The route is keyed by PR number, but every PR API is keyed by the row's
  // uuid — resolve number → uuid via the (cached) pulls list before fetching.
  const { data: pulls, isLoading: pullsLoading } = usePulls(repoId);
  const prId = pulls?.find((p) => p.number === Number(number))?.id ?? null;
  const { data: pr, isLoading: detailLoading, isError, error, refetch } = usePullDetail(prId);

  const isLoading = pullsLoading || (prId != null && detailLoading);
  const { data: reviews, refetch: refetchReviews } = usePrReviews(prId);
  const { data: smartDiff } = useSmartDiff(prId);

  // Live run tracking is SERVER-SOURCED (agent_runs status='running'): survives
  // navigation AND reload, and self-clears via polling when runs finish.
  const qc = useQueryClient();
  const { data: activeRuns } = usePrActiveRuns(prId);
  const { data: prRuns } = usePrRuns(prId);
  const deleteRun = useDeleteRun(prId);
  const liveRunIds = (activeRuns ?? []).map((r) => r.run_id);
  const reviewRunning = liveRunIds.length > 0;
  const cancel = useCancelRun();
  const invalidateActiveRuns = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
  };
  // When a run settles (done OR failed) refresh the full run history too, so a
  // just-failed run shows up in "Run history" immediately — no page reload.
  const invalidateRunHistory = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
  };
  // A run classifies (or reclassifies) PR intent as a side effect — refresh the
  // Intent card without a manual reload once the run settles.
  const invalidateIntent = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["pr-intent", prId] });
  };
  // Smart Diff's `finding_lines` are derived from persisted findings, so a
  // finished run changes which files auto-open on the Files tab.
  const invalidateSmartDiff = () => {
    if (prId) qc.invalidateQueries({ queryKey: ["smart-diff", prId] });
  };

  // A `finding` param (e.g. clicked from a findings popover) implies the Agent-
  // runs tab, where that finding lives in its review.
  const focusFindingId = search.get("finding");
  const tab = search.get("tab") ?? (focusFindingId ? "findings" : "overview");
  const traceRunId = search.get("trace");
  // Several params at once, in ONE replace. Two sequential setParam calls would
  // both build from the same stale `search` and the second would drop the first.
  const setParams = (entries: [string, string | null][]) => {
    const sp = new URLSearchParams(search.toString());
    for (const [key, val] of entries) {
      if (val == null) sp.delete(key);
      else sp.set(key, val);
    }
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };
  const setParam = (key: string, val: string | null) => setParams([[key, val]]);
  const setTab = (t: string) => setParam("tab", t);

  // Reviews come newest-first; each is its own run (grouped into accordions).
  const runs = reviews ?? [];
  const allFindings: FindingRecord[] = React.useMemo(
    () => runs.flatMap((r) => r.findings),
    [reviews],
  );
  const lethalTrifecta = allFindings.filter((f) => f.kind === "lethal_trifecta");
  const findingsCount = allFindings.length;

  const repoName = activeRepo?.full_name ?? repoId;
  // The real "owner/repo" (null until the repo is loaded) — used to build
  // github.com deep-links for the header and finding file references.
  const repoFullName = activeRepo?.full_name ?? null;
  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
          <Skeleton height={28} width={420} />
          <Skeleton height={16} width={300} />
          <Skeleton height={200} />
        </div>
      </AppShell>
    );
  }

  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && <OverviewTab prId={prId} prBody={pr.body} />}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            prNumber={pr.number}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            lethalTrifecta={lethalTrifecta}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            focusFindingId={focusFindingId}
            onFocusFinding={(id) => setParam("finding", id)}
            cancelMutation={cancel}
            onOpenTrace={(id) => setParam("trace", id)}
            onDelete={(id) => {
              if (window.confirm("Delete this run from history? (its logs are removed too)"))
                deleteRun.mutate(id);
            }}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              invalidateIntent();
              invalidateSmartDiff();
              refetchReviews();
            }}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
            smartDiff={smartDiff}
            findings={allFindings}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            // Both params in one replace: `?finding=` alone would be read on the
            // Files tab, where nothing consumes it.
            onFocusFinding={(id) =>
              setParams([
                ["tab", "findings"],
                ["finding", id],
              ])
            }
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </AppShell>
  );
}
