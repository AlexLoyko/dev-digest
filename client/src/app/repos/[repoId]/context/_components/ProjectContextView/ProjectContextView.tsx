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
  isExcluded,
  isNotCloned,
  rootMeta,
  threatMeta,
  tokenDisplay,
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

  const notCloned = !!data && isNotCloned(data.index);

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
            {data.scanned_at && (
              <div style={s.statusLine}>
                {t("scan.indexed", { count: documents.length })} ·{" "}
                {t("scan.lastRun", { time: new Date(data.scanned_at).toLocaleString() })}
              </div>
            )}
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
                  t={t}
                />
              ))}
            </div>
          </div>

          <div style={s.viewerCol}>
            {selectedPath ? (
              <>
                <div className="mono" style={s.viewerPath}>
                  {selectedPath}
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

/** One row in the document list — mono path, source-root chip, "used by N
 * agents", token count (`≈` + approximate label when estimated), threat
 * badge, and an excluded marker. Purely presentational; all derivation
 * lives in `helpers.ts`. */
function DocumentRow({
  doc,
  active,
  onSelect,
  t,
}: {
  doc: SpecFile;
  active: boolean;
  onSelect: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const root = rootMeta(doc.root);
  const threat = threatMeta(doc.threat_level);
  const ThreatIcon = Icon[threat.icon];
  const { tokens, approximate } = tokenDisplay(doc);
  const usedBy = usedByAgentsCount(doc);
  const excluded = isExcluded(doc);

  return (
    <button type="button" style={s.row(active)} onClick={onSelect}>
      <span className="mono" style={s.rowPath(active)}>
        {doc.path}
      </span>
      <span style={s.rowMeta}>
        {root && <span style={s.chip(root.c, root.bg)}>{t(`sourceRoot.${root.labelKey}`)}</span>}
        <span style={s.chip(threat.c, threat.bg)}>
          <ThreatIcon size={11} />
          {t(`threat.${threat.labelKey}`)}
        </span>
        <span style={s.usedByAgents(usedBy > 0)}>{t("usedByAgents", { count: usedBy })}</span>
        {tokens != null && (
          <span>
            {approximate ? "≈ " : ""}
            {t("tokens", { count: tokens })}
            {approximate ? ` (${t("tokensApprox")})` : ""}
          </span>
        )}
        {excluded && <span style={s.excludedMarker}>{t("excluded")}</span>}
      </span>
    </button>
  );
}
