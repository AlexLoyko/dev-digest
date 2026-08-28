/* ContextTab — Project Context documents attached to this skill (AC-7,
   client half; server-side persistence is T11). Composes the shared
   `ContextPicker` (namespace="skills") for attach/detach/reorder, plus a
   read-only "serializes as" panel fed by `useSkillContextPreview`.

   Two different "previews" meet on this screen — do not conflate them:
   - ContextPicker's own per-row preview shows ONE document's raw content
     (wired by T15 via `useContextDocument`);
   - this tab's panel shows `useSkillContextPreview(skillId)` -> the exact
     `## Project context` string the server assembles for a run
     (`buildProjectContextSection()`), delimiter-wrapped per source. That
     text is repository-controlled and rendered as a plain text node inside
     `<pre>` — never through Markdown, never via `dangerouslySetInnerHTML` —
     which is the deliberate resolution of the design's Screen-3
     contradiction (AC-9): the panel must show the assembled block, not a
     bare list of attached paths. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { useActiveRepo } from "@/lib/contexts";
import {
  useContextFiles,
  useSkillContext,
  useSetSkillContext,
  useSkillContextPreview,
} from "@/lib/hooks";
import { ContextPicker } from "@/components/context-picker";
import { RepoNotFound } from "@/components/repo-not-found/RepoNotFound";

export function ContextTab({ skillId }: { skillId: string }) {
  const t = useTranslations("skills.context");
  const tCommon = useTranslations("common");
  const { repoId } = useActiveRepo();

  const {
    data: filesData,
    isLoading: filesLoading,
    isError: filesError,
  } = useContextFiles(repoId);
  const {
    data: contextData,
    isLoading: contextLoading,
    isError: contextError,
    refetch: refetchContext,
  } = useSkillContext(skillId);
  const setContext = useSetSkillContext();
  const {
    data: preview,
    isLoading: previewLoading,
    isError: previewError,
  } = useSkillContextPreview(skillId);

  if (!repoId) {
    return <RepoNotFound />;
  }

  if (filesLoading || contextLoading) {
    return (
      <div
        style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <Skeleton height={24} width={240} />
        <Skeleton height={300} />
      </div>
    );
  }

  if (filesError || contextError || !contextData) {
    return (
      <ErrorState body={tCommon("states.error")} onRetry={() => refetchContext()} />
    );
  }

  const attachedPaths = [...contextData.attached]
    .sort((a, b) => a.position - b.position)
    .map((a) => a.path);
  const missingPaths = contextData.effective
    .filter((d) => d.missing)
    .map((d) => d.path);

  return (
    <div
      style={{
        padding: 28,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        maxWidth: 720,
      }}
    >
      <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0 }}>
        {t("inheritNote")}
      </p>

      <ContextPicker
        documents={filesData?.documents ?? []}
        attachedPaths={attachedPaths}
        onChange={(paths) => setContext.mutate({ skillId, paths })}
        missingPaths={missingPaths}
        busy={setContext.isPending}
        repoId={repoId}
        namespace="skills"
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t("serializesAs")}
        </span>
        {previewLoading && <Skeleton height={120} />}
        {previewError && <p style={{ fontSize: 13, color: "var(--crit)" }}>{tCommon("states.error")}</p>}
        {!previewLoading && !previewError && (
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 8,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 320,
              overflow: "auto",
              color: "var(--text-primary)",
            }}
          >
            {preview?.text ?? ""}
          </pre>
        )}
      </div>
    </div>
  );
}
