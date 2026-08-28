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
import {
  buildDisplayRows,
  filterDisplayRows,
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

  function handleToggle(path: string) {
    onChange(toggleAttachment(attachedPaths, path));
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
              isAttached={attachedPaths.includes(row.path)}
              isMissing={missingSet.has(row.path)}
              position={attachedPaths.indexOf(row.path)}
              total={attachedPaths.length}
              busy={busy}
              previewOpen={previewPath === row.path}
              onTogglePreview={() => setPreviewPath((p) => (p === row.path ? null : row.path))}
              onToggle={() => handleToggle(row.path)}
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

  return (
    <li style={s.row}>
      <input
        type="checkbox"
        checked={isAttached}
        disabled={busy}
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
        {previewOpen && doc?.content != null && <pre style={s.previewBlock}>{doc.content}</pre>}
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
