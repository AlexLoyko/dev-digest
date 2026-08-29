/* ContextPicker — attach/detach and reorder Project Context documents for an
   agent or a skill. Mounted by both the Agent Editor Context tab (T16) and
   the Skill Editor Context tab (T17), which is why every string routes
   through either the `${namespace}.context` catalogue (agent-/skill-specific
   copy) or the shared `context` catalogue (source root, threat, token
   labels — same document catalog either way). See NFR-5. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { SpecFile } from "@devdigest/shared";
import { Badge, Card, IconBtn, Icon } from "@devdigest/ui";
import { useContextDocument } from "@/lib/hooks";
import {
  buildDisplayRows,
  canAttach,
  filterDisplayRows,
  isExcluded,
  moveAttachedPath,
  resolveThreatLevel,
  splitPathParts,
  sumAttachedTokens,
  hasApproximateTokens,
  threatColor,
  toggleAttachment,
  type DisplayRow,
  type MoveDirection,
} from "./helpers";
import { s, reorderBtnStyle } from "./styles";

export interface ContextPickerProps {
  documents: SpecFile[];
  attachedPaths: string[];
  onChange: (paths: string[]) => void;
  missingPaths: string[];
  busy: boolean;
  /** The repo the documents were scanned from — needed to fetch a single
   *  document's full text on demand for the row preview (`GET
   *  /repos/:id/context/document?path=`). The list endpoint that supplies
   *  `documents` always returns `content: null`; only that per-document
   *  endpoint populates it. */
  repoId: string;
  /** Which mounting page's catalogue copy to read agent-/skill-specific
   *  strings from (heading, helper, attach/detach, order announcement).
   *  Defaults to "agents". */
  namespace?: "agents" | "skills";
}

export function ContextPicker({
  documents,
  attachedPaths,
  onChange,
  missingPaths,
  busy,
  repoId,
  namespace = "agents",
}: ContextPickerProps) {
  const t = useTranslations(`${namespace}.context`);
  const tContext = useTranslations("context");
  const tCommon = useTranslations("common");
  const tPrReview = useTranslations("prReview");

  const [search, setSearch] = React.useState("");
  const [announcement, setAnnouncement] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);

  const missingSet = new Set(missingPaths);
  const allRows = buildDisplayRows(documents, attachedPaths);
  const rows = filterDisplayRows(allRows, search);
  const tokensTotal = sumAttachedTokens(attachedPaths, documents);
  const approx = hasApproximateTokens(attachedPaths, documents);

  function handleToggle(row: DisplayRow) {
    const isAttached = attachedPaths.includes(row.path);
    // EC-4: an excluded document that isn't already attached can't be
    // newly attached — the checkbox is disabled, but guard here too since
    // this is the single place that actually mutates `attachedPaths`.
    if (!canAttach(row, isAttached)) return;
    onChange(toggleAttachment(attachedPaths, row.path));
  }

  function handleMove(path: string, direction: MoveDirection) {
    const result = moveAttachedPath(attachedPaths, path, direction);
    if (!result) return;
    onChange(result.paths);
    const { name } = splitPathParts(path);
    setAnnouncement(t("orderAnnouncement", { name, position: result.position, total: result.total }));
  }

  return (
    <Card>
      <div style={s.root}>
        <div style={s.header}>
          <h3 style={s.heading}>{t("heading")}</h3>
          <Badge>{t("attachedCount", { count: attachedPaths.length })}</Badge>
        </div>
        <p style={s.helper}>{t("helper")}</p>
        <p style={s.helper}>{t("injectedNote")}</p>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("filterPlaceholder")}
          aria-label={t("filterPlaceholder")}
          disabled={busy}
          style={s.filterInput}
        />
        <span style={s.filterCount}>
          {tContext("filter.showing", { count: rows.length, total: allRows.length })}
        </span>

        <ul style={s.list}>
          {rows.map((row) => (
            <DocumentRow
              key={row.path}
              row={row}
              repoId={repoId}
              isAttached={attachedPaths.includes(row.path)}
              isMissing={missingSet.has(row.path)}
              position={attachedPaths.indexOf(row.path)}
              total={attachedPaths.length}
              busy={busy}
              previewOpen={previewPath === row.path}
              onTogglePreview={() => setPreviewPath((p) => (p === row.path ? null : row.path))}
              onToggle={() => handleToggle(row)}
              onMove={(direction) => handleMove(row.path, direction)}
              t={t}
              tContext={tContext}
            />
          ))}
          {rows.length === 0 && <li style={s.empty}>{tCommon("states.empty")}</li>}
        </ul>

        <div style={s.footer}>
          <span style={s.footerTotal}>
            {approx ? "≈ " : ""}
            {t("tokensTotal", { count: tokensTotal })}
          </span>
          <Badge color="var(--warn)">{tPrReview("trifecta.untrustedInput")}</Badge>
        </div>

        <div aria-live="polite" style={s.srOnly}>
          {announcement}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface DocumentRowProps {
  row: DisplayRow;
  repoId: string;
  isAttached: boolean;
  isMissing: boolean;
  position: number;
  total: number;
  busy: boolean;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onToggle: () => void;
  onMove: (direction: MoveDirection) => void;
  t: ReturnType<typeof useTranslations>;
  tContext: ReturnType<typeof useTranslations>;
}

function DocumentRow({
  row,
  repoId,
  isAttached,
  isMissing,
  position,
  total,
  busy,
  previewOpen,
  onTogglePreview,
  onToggle,
  onMove,
  t,
  tContext,
}: DocumentRowProps) {
  const { dir, name } = splitPathParts(row.path);
  const doc = row.doc;
  const threat = doc ? resolveThreatLevel(doc) : "unknown";
  const canMoveUp = isAttached && position > 0;
  const canMoveDown = isAttached && position < total - 1;
  // EC-4: excluded documents are visible and reported (never hidden), but
  // can't be newly attached. An already-attached document that has since
  // become excluded stays checked and enabled so it can still be removed.
  const excluded = isExcluded(doc);
  const attachable = canAttach(row, isAttached);

  return (
    <li style={s.row}>
      <input
        type="checkbox"
        checked={isAttached}
        disabled={busy || !attachable}
        onChange={onToggle}
        aria-label={`${isAttached ? t("detach") : t("attach")} ${name}`}
        style={s.checkbox}
      />

      <div style={s.rowGroup}>
        <span style={s.pathWrap}>
          {dir && <span style={s.dirPrefix}>{dir}</span>}
          <span className="mono" style={s.filename}>
            {name}
          </span>
        </span>
        {/* Mounted only while open — the fetch it owns is gated on that,
            and its loading/success/error re-renders stay local to this
            subtree instead of bubbling into DocumentRow. */}
        {previewOpen && <DocumentPreview repoId={repoId} path={row.path} />}
      </div>

      <div style={s.chipRow}>
        {doc && <Badge>{tContext(`sourceRoot.${doc.root}`)}</Badge>}
        {doc?.tokens != null && (
          <span style={s.tokenCount}>
            {doc.tokens_approximate ? "≈ " : ""}
            {tContext("tokens", { count: doc.tokens })}
            {doc.tokens_approximate ? ` · ${tContext("tokensApprox")}` : ""}
          </span>
        )}
        <Badge color={threatColor(threat)}>{tContext(`threat.${threat}`)}</Badge>
        {excluded && <Badge color="var(--crit)">{tContext("excluded")}</Badge>}
        {isMissing && <Badge color="var(--crit)">{t("missingInRepo")}</Badge>}

        <IconBtn icon="Eye" label={tContext("mode.preview")} size={22} active={previewOpen} onClick={onTogglePreview} />

        {isAttached && (
          <>
            <ReorderButton icon="ArrowUp" label={t("moveUp")} disabled={busy || !canMoveUp} onClick={() => onMove("up")} />
            <ReorderButton icon="ArrowDown" label={t("moveDown")} disabled={busy || !canMoveDown} onClick={() => onMove("down")} />
          </>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Preview — owns its own fetch. The list endpoint that supplies `documents`
// always returns `content: null` (server/src/modules/context/service.ts);
// only `GET /repos/:id/context/document?path=` populates it. Rendered (and
// therefore mounted) only when a row's preview is open, so `useContextDocument`
// stays disabled — and never fires — until the user actually asks for it,
// and only for that one path.
// ---------------------------------------------------------------------------

function DocumentPreview({ repoId, path }: { repoId: string; path: string }) {
  const tCommon = useTranslations("common");
  const { data, isLoading, isError } = useContextDocument(repoId, path);

  if (isLoading) return <p style={s.previewBlock}>{tCommon("states.loading")}</p>;
  if (isError) return <p style={s.previewBlock}>{tCommon("states.error")}</p>;
  if (!data?.content) return null;
  return <pre style={s.previewBlock}>{data.content}</pre>;
}

// ---------------------------------------------------------------------------
// Reorder button — native <button> so `disabled` is a real semantic state
// (IconBtn has no disabled prop). Keyboard-operable by default (NFR-4).
// ---------------------------------------------------------------------------

function ReorderButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: "ArrowUp" | "ArrowDown";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const I = Icon[icon];
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} style={reorderBtnStyle(disabled)}>
      <I size={13} />
    </button>
  );
}
