"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { notify } from "@/lib/toast";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { s, segment } from "./styles";

type View = "smart" | "original";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** L03 Smart Diff — undefined while loading; the view falls back until it lands. */
  smartDiff?: SmartDiff | null;
  /** Every persisted finding for this PR — powers the inline severity chips. */
  findings?: FindingRecord[];
  repoFullName?: string | null;
  headSha?: string | null;
  onFocusFinding?: (id: string) => void;
}

export function DiffTab({
  prId,
  filesCount,
  files,
  canComment,
  smartDiff,
  findings,
  repoFullName,
  headSha,
  onFocusFinding,
}: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  const [view, setView] = React.useState<View>("smart");

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const totals = React.useMemo(
    () =>
      files.reduce(
        (acc, f) => ({
          additions: acc.additions + (f.additions ?? 0),
          deletions: acc.deletions + (f.deletions ?? 0),
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  // Smart order needs the server's grouping. While it is in flight — or if it
  // came back with nothing to group — fall back to the plain viewer so the tab
  // is never empty.
  const smartReady = view === "smart" && !!smartDiff && smartDiff.groups.length > 0;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 && view === "original" ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {showComments ? "Hide comments" : "Show comments"} ({commentCount})
            </Button>
          ) : undefined
        }
      >
        {t("smartDiff.sectionLabel")}
      </SectionLabel>

      <div style={s.toolbar}>
        <span className="mono tnum" style={s.summary}>
          {t("smartDiff.summary", {
            files: filesCount,
            additions: totals.additions,
            deletions: totals.deletions,
          })}
        </span>
        <div style={s.segmented} role="group">
          <button type="button" onClick={() => setView("smart")} style={segment(view === "smart")}>
            {t("smartDiff.smartOrder")}
          </button>
          <button
            type="button"
            onClick={() => setView("original")}
            style={segment(view === "original")}
          >
            {t("smartDiff.originalOrder")}
          </button>
        </div>
      </div>

      {smartReady ? (
        <SmartDiffViewer
          smartDiff={smartDiff}
          files={files}
          findings={findings ?? []}
          repoFullName={repoFullName}
          headSha={headSha}
          onFocusFinding={onFocusFinding}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
