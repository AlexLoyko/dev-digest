/* ProjectContextView — read-only Project Context page body (/repos/:repoId/context).
   Two columns: a filterable document list + a Markdown viewer for the
   selected document. Deliberately view-only — no document mutation affordance
   of any kind anywhere in this tree (see the dispatch note this task traces to). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Markdown, Skeleton } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { useContextDocument, useContextFiles, useReindexContext } from "@/lib/hooks/context-files";
import { ApiError } from "@/lib/api";
import { s } from "./styles";
import { LIST_RENDER_CAP } from "./constants";
import {
  capForDisplay,
  filterDocuments,
  formatMinutesAgo,
  isNotCloned,
  minutesSinceScan,
  sumTokens,
  usedByAgentsCount,
} from "./helpers";

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("context");
  const { data, isLoading, isError, error, refetch } = useContextFiles(repoId);
  const reindex = useReindexContext();

  const [query, setQuery] = React.useState("");
  // Only the user's own click overrides the default selection (the first
  // visible row) — derived, not duplicated, so it self-corrects when the
  // filter narrows the list past the previous selection.
  const [manualPath, setManualPath] = React.useState<string | null>(null);

  const documents = data?.documents ?? [];
  const filtered = filterDocuments(documents, query);
  const { rows, total, truncated } = capForDisplay(filtered, LIST_RENDER_CAP);
  const selectedPath =
    manualPath && filtered.some((doc) => doc.path === manualPath) ? manualPath : rows[0]?.path ?? null;
  const selectedDoc = useContextDocument(repoId, selectedPath);
  // Sourced from the already-loaded list (not `selectedDoc`, which is still
  // fetching document content) so "Used by N agents" appears immediately
  // alongside the path, not after a second round trip.
  const selectedListDoc = documents.find((doc) => doc.path === selectedPath) ?? null;

  const notCloned = !!data && isNotCloned(data.index);
  const totalTokens = sumTokens(documents);
  const scanMinutesAgo = minutesSinceScan(data?.scanned_at);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.pageTitle}>{t("title")}</h1>
          <div style={s.readOnlyNotice}>
            <Icon.Eye size={14} />
            {t("readOnlyNotice")}
          </div>
        </div>
        {data && !notCloned && (
          <div style={s.headerActions}>
            <Button icon="RefreshCw" loading={reindex.isPending} onClick={() => reindex.mutate(repoId)}>
              {reindex.isPending ? t("indexing") : t("reindex")}
            </Button>
          </div>
        )}
      </div>

      {isLoading && !data && (
        <div style={{ padding: "0 32px 44px", display: "flex", flexDirection: "column", gap: 12 }}>
          <Skeleton height={40} />
          <Skeleton height={320} />
        </div>
      )}

      {isError && (
        <div style={{ padding: "0 32px 44px" }}>
          <ErrorState
            title={t("loadError")}
            body={error instanceof ApiError ? error.message : undefined}
            onRetry={() => refetch()}
          />
        </div>
      )}

      {data && notCloned && (
        <div style={{ padding: "0 32px 44px" }}>
          <EmptyState icon="Folder" title={t("notCloned.title")} body={t("notCloned.body")} />
        </div>
      )}

      {data && !notCloned && documents.length === 0 && (
        <div style={{ padding: "0 32px 44px" }}>
          <EmptyState icon="Folder" title={t("empty.title")} body={t("empty.body")} />
        </div>
      )}

      {data && !notCloned && documents.length > 0 && (
        <div style={s.columns}>
          <div style={s.listCol}>
            <input
              style={s.filterInput}
              placeholder={t("filter.placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {truncated && (
              <div style={s.showing}>{t("filter.showing", { count: rows.length, total })}</div>
            )}
            <div style={s.list}>
              {rows.map((doc) => (
                <DocumentRow
                  key={doc.path}
                  doc={doc}
                  active={doc.path === selectedPath}
                  onSelect={() => setManualPath(doc.path)}
                />
              ))}
            </div>
            {/* Summary footer — document count and token total always
                reflect the full (unfiltered) scanned set. The "refreshed"
                segment needs `scanned_at`; a repo that has documents but
                has never completed a scan (nullish `scanned_at`) simply
                omits it rather than showing a misleading age. */}
            <div style={s.footer}>
              <span style={s.footerDot} />
              <span>{t("footer.documents", { count: documents.length })}</span>
              <span aria-hidden="true">·</span>
              <span>{t("footer.tokensTotal", { count: totalTokens })}</span>
              {scanMinutesAgo !== null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{t("footer.refreshedAgo", { time: formatMinutesAgo(scanMinutesAgo) })}</span>
                </>
              )}
            </div>
          </div>

          <div style={s.viewerCol}>
            {selectedPath ? (
              <>
                <div style={s.viewerHeader}>
                  <div className="mono" style={s.viewerPath}>
                    {selectedPath}
                  </div>
                  {selectedListDoc && (
                    <span style={s.usedByAgents}>
                      {t("usedByAgents", { count: usedByAgentsCount(selectedListDoc) })}
                    </span>
                  )}
                </div>
                {selectedDoc.isLoading ? (
                  <Skeleton height={220} />
                ) : selectedDoc.isError ? (
                  <ErrorState
                    title={t("loadError")}
                    body={selectedDoc.error instanceof ApiError ? selectedDoc.error.message : undefined}
                    onRetry={() => selectedDoc.refetch()}
                  />
                ) : (
                  <Markdown>{selectedDoc.data?.content}</Markdown>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** One row in the document list — a small file icon plus the mono
 * repository-relative path. No chips (source-root, threat, usage, tokens) —
 * "used by N agents" moved to the viewer's document header; the rest were
 * deliberately dropped from this layout (see the implementation report).
 * Paths render in full, never as a bare filename — with three scan roots
 * matched at any depth, a bare filename is ambiguous. */
function DocumentRow({ doc, active, onSelect }: { doc: SpecFile; active: boolean; onSelect: () => void }) {
  return (
    <button type="button" style={s.row(active)} onClick={onSelect}>
      <Icon.File size={14} style={s.rowIcon(active)} />
      <span className="mono" style={s.rowPath(active)}>
        {doc.path}
      </span>
    </button>
  );
}
