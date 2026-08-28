/* ContextTab — attach/detach/reorder Project Context documents for an agent.
   Composes the shared ContextPicker (client/src/components/context-picker)
   with the active repo's document catalog (useContextFiles) and this
   agent's current attachment set (useAgentContext/useSetAgentContext). The
   picker owns its own aria-live announcement region for reorder changes
   (NFR-4) and its own "order matters" helper copy — this tab does not
   duplicate either. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { ContextPicker } from "@/components/context-picker";
import { useActiveRepo } from "@/lib/contexts/repoContext";
import { useAgentContext, useContextFiles, useSetAgentContext } from "@/lib/hooks";

export function ContextTab({ agentId }: { agentId: string }) {
  const tCommon = useTranslations("common");
  const { repoId } = useActiveRepo();

  const {
    data: filesData,
    isLoading: filesLoading,
    isError: filesError,
    refetch: refetchFiles,
  } = useContextFiles(repoId);
  const {
    data: agentContext,
    isLoading: contextLoading,
    isError: contextError,
    refetch: refetchContext,
  } = useAgentContext(agentId);
  const setContext = useSetAgentContext();

  if (filesLoading || contextLoading) {
    return (
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={48} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (filesError || contextError || !filesData || !agentContext) {
    return (
      <ErrorState
        body={tCommon("states.error")}
        onRetry={() => {
          refetchFiles();
          refetchContext();
        }}
      />
    );
  }

  const attachedPaths = [...agentContext.attached]
    .sort((a, b) => a.position - b.position)
    .map((a) => a.path);
  const missingPaths = agentContext.effective.filter((d) => d.missing).map((d) => d.path);

  return (
    <div style={{ padding: 28, maxWidth: 720 }}>
      <ContextPicker
        documents={filesData.documents}
        attachedPaths={attachedPaths}
        onChange={(paths) => setContext.mutate({ agentId, paths })}
        missingPaths={missingPaths}
        busy={setContext.isPending}
        repoId={repoId ?? ""}
      />
    </div>
  );
}
