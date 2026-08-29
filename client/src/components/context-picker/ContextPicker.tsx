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
import { Badge, Button, Card, Icon } from "@devdigest/ui";
import { useContextDocument } from "@/lib/hooks";
import {
  buildDisplayRows,
  canAttach,
  filterDisplayRows,
  isExcluded,
  moveAttachedPath,
  reorderAttachedPath,
  resolveThreatLevel,
  splitPathParts,
  sumAttachedTokens,
  hasApproximateTokens,
  threatColor,
  toggleAttachment,
  type DisplayRow,
  type MoveDirection,
} from "./helpers";
import { s, dragHandleButtonStyle, rowDragOverStyle, sourceRootColor } from "./styles";

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
  // Keyboard reorder (NFR-4): `grabbedPath` is the row currently "picked
  // up" via Space/Enter on its handle; `grabSnapshot` is `attachedPaths` at
  // the moment of pick-up, restored verbatim if the user presses Escape.
  const [grabbedPath, setGrabbedPath] = React.useState<string | null>(null);
  const [grabSnapshot, setGrabSnapshot] = React.useState<string[] | null>(null);
  // Native HTML5 drag (mouse pointer): `draggingPath` is the handle
  // currently being dragged, `dragOverPath` the row currently under the
  // pointer — both purely visual/interaction state, never persisted.
  const [draggingPath, setDraggingPath] = React.useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = React.useState<string | null>(null);
  const instructionsId = React.useId();

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

  function announceMove(path: string, position: number, total: number) {
    const { name } = splitPathParts(path);
    setAnnouncement(t("orderAnnouncement", { name, position, total }));
  }

  function handleArrowMove(path: string, direction: MoveDirection) {
    const result = moveAttachedPath(attachedPaths, path, direction);
    if (!result) return;
    onChange(result.paths);
    announceMove(path, result.position, result.total);
  }

  function handleGrabToggle(path: string) {
    if (grabbedPath === path) {
      setGrabbedPath(null);
      setGrabSnapshot(null);
    } else {
      setGrabbedPath(path);
      setGrabSnapshot(attachedPaths);
    }
  }

  function handleCancelGrab(path: string) {
    if (grabSnapshot) {
      onChange(grabSnapshot);
      const { name } = splitPathParts(path);
      setAnnouncement(
        tContext("reorder.cancelled", { name, position: grabSnapshot.indexOf(path) + 1, total: grabSnapshot.length }),
      );
    }
    setGrabbedPath(null);
    setGrabSnapshot(null);
  }

  function handleHandleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, path: string) {
    if (grabbedPath === path) {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        handleArrowMove(path, e.key === "ArrowUp" ? "up" : "down");
      } else if (e.key === " " || e.key === "Spacebar" || e.key === "Enter") {
        e.preventDefault();
        setGrabbedPath(null);
        setGrabSnapshot(null);
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelGrab(path);
      }
      return;
    }
    if (e.key === " " || e.key === "Spacebar" || e.key === "Enter") {
      e.preventDefault();
      handleGrabToggle(path);
    }
  }

  function handleDragStart(path: string) {
    setDraggingPath(path);
    // A mouse drag takes over from any in-progress keyboard grab.
    setGrabbedPath(null);
    setGrabSnapshot(null);
  }

  function handleDragEnd() {
    setDraggingPath(null);
    setDragOverPath(null);
  }

  function handleDropOn(targetPath: string, sourcePath: string) {
    setDraggingPath(null);
    setDragOverPath(null);
    const result = reorderAttachedPath(attachedPaths, sourcePath, targetPath);
    if (!result) return;
    onChange(result.paths);
    announceMove(sourcePath, result.position, result.total);
  }

  return (
    <Card>
      <div style={s.root}>
        <div style={s.header}>
          <div style={s.headerLeft}>
            <h3 style={s.heading}>{t("heading")}</h3>
            <Badge>{t("attachedCount", { count: attachedPaths.length })}</Badge>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filterPlaceholder")}
            aria-label={t("filterPlaceholder")}
            disabled={busy}
            style={s.filterInput}
          />
        </div>
        <p style={s.helper}>{t("helper")}</p>
        <p style={s.helper}>{t("injectedNote")}</p>
        <span style={s.filterCount}>
          {tContext("filter.showing", { count: rows.length, total: allRows.length })}
        </span>

        <ul style={s.list}>
          {rows.map((row) => {
            const isAttached = attachedPaths.includes(row.path);
            return (
              <DocumentRow
                key={row.path}
                row={row}
                repoId={repoId}
                isAttached={isAttached}
                isMissing={missingSet.has(row.path)}
                position={attachedPaths.indexOf(row.path)}
                total={attachedPaths.length}
                busy={busy}
                previewOpen={previewPath === row.path}
                onTogglePreview={() => setPreviewPath((p) => (p === row.path ? null : row.path))}
                onToggle={() => handleToggle(row)}
                isGrabbed={grabbedPath === row.path}
                isDragging={draggingPath === row.path}
                isDragOver={dragOverPath === row.path}
                instructionsId={instructionsId}
                onHandleKeyDown={(e) => handleHandleKeyDown(e, row.path)}
                onDragStartHandle={() => handleDragStart(row.path)}
                onDragEndHandle={handleDragEnd}
                onRowDragOver={(e) => {
                  if (!isAttached || !draggingPath || draggingPath === row.path) return;
                  e.preventDefault();
                  setDragOverPath(row.path);
                }}
                onRowDragLeave={() => setDragOverPath((p) => (p === row.path ? null : p))}
                onRowDrop={(e) => {
                  if (!isAttached) return;
                  e.preventDefault();
                  const sourcePath = e.dataTransfer.getData("text/plain");
                  if (sourcePath) handleDropOn(row.path, sourcePath);
                }}
                t={t}
                tContext={tContext}
              />
            );
          })}
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
        {/* Shared, visually hidden instructions referenced by every
            attached row's drag handle via aria-describedby — one copy
            rather than duplicating the same long text on every row. */}
        <div id={instructionsId} style={s.srOnly}>
          {tContext("reorder.instructions")}
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
  isGrabbed: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  instructionsId: string;
  onHandleKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onDragStartHandle: () => void;
  onDragEndHandle: () => void;
  onRowDragOver: (e: React.DragEvent<HTMLLIElement>) => void;
  onRowDragLeave: () => void;
  onRowDrop: (e: React.DragEvent<HTMLLIElement>) => void;
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
  isGrabbed,
  isDragging,
  isDragOver,
  instructionsId,
  onHandleKeyDown,
  onDragStartHandle,
  onDragEndHandle,
  onRowDragOver,
  onRowDragLeave,
  onRowDrop,
  t,
  tContext,
}: DocumentRowProps) {
  const { dir, name } = splitPathParts(row.path);
  const doc = row.doc;
  const threat = doc ? resolveThreatLevel(doc) : "unknown";
  // EC-4: excluded documents are visible and reported (never hidden), but
  // can't be newly attached. An already-attached document that has since
  // become excluded stays checked and enabled so it can still be removed.
  const excluded = isExcluded(doc);
  const attachable = canAttach(row, isAttached);
  // Only suspicious/dangerous documents get a threat badge — the reference
  // shows no badge at all, and a badge on every safe/unknown row would be
  // noise. Reserving it for the two levels that actually warrant a warning
  // keeps EC's injection-threat signal intact (see the threat-badge note in
  // the picker's module doc comment) while matching the cleaner look.
  const showThreatBadge = threat === "suspicious" || threat === "dangerous";
  const handleLabel = isGrabbed
    ? tContext("reorder.handleGrabbed", { name, position: position + 1, total })
    : tContext("reorder.handle", { name });

  return (
    <li
      style={{ ...s.row, ...rowDragOverStyle(isDragOver) }}
      onDragOver={onRowDragOver}
      onDragLeave={onRowDragLeave}
      onDrop={onRowDrop}
    >
      {/* Only attached rows are draggable/grabbable (point 4) — an
          unattached row's handle stays the old inert, aria-hidden span at
          the same fixed size so the leading column never shifts. */}
      {isAttached ? (
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", row.path);
            onDragStartHandle();
          }}
          onDragEnd={onDragEndHandle}
          onKeyDown={onHandleKeyDown}
          disabled={busy}
          aria-pressed={isGrabbed}
          aria-label={handleLabel}
          aria-describedby={instructionsId}
          style={dragHandleButtonStyle(isGrabbed, isDragging)}
        >
          <Icon.Menu size={14} />
        </button>
      ) : (
        <span aria-hidden="true" style={s.dragHandle}>
          <Icon.Menu size={14} />
        </span>
      )}

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
          <span className="mono" style={s.filename}>
            {name}
          </span>
          {dir && <span style={s.dirPrefix}>{dir}</span>}
        </span>
        {/* Mounted only while open — the fetch it owns is gated on that,
            and its loading/success/error re-renders stay local to this
            subtree instead of bubbling into DocumentRow. */}
        {previewOpen && <DocumentPreview repoId={repoId} path={row.path} />}
      </div>

      <div style={s.chipRow}>
        {/* Category, token count and Preview form a stable three-column
            block — see s.sourceRootLabel / s.tokenCount for the fixed
            widths. When `doc` is missing (EC-7 — the attached path no
            longer exists in the repo) or its token count is unknown, the
            spans still render at their fixed width with no visible content
            so every row's Preview button lands in the same column instead
            of collapsing left; aria-hidden keeps the empty cell silent for
            assistive tech rather than announcing a blank one. The
            variable-width badges are rendered after Preview (not between
            it and the token count) so their presence/absence never shifts
            Preview's horizontal position. */}
        <span
          style={{ ...s.sourceRootLabel, color: doc ? sourceRootColor[doc.root] : undefined }}
          aria-hidden={doc ? undefined : true}
        >
          {doc ? tContext(`sourceRoot.${doc.root}`) : ""}
        </span>
        <span
          style={s.tokenCount}
          aria-hidden={doc && doc.tokens != null ? undefined : true}
          title={doc && doc.tokens != null ? tContext("tokens", { count: doc.tokens }) : undefined}
        >
          {doc && doc.tokens != null && (
            <>
              {doc.tokens_approximate ? "≈" : ""}
              {tContext("tokensCompact", { count: doc.tokens })}
            </>
          )}
        </span>

        <Button kind="tertiary" size="sm" icon="Eye" active={previewOpen} onClick={onTogglePreview}>
          {tContext("mode.preview")}
        </Button>

        {showThreatBadge && <Badge color={threatColor(threat)}>{tContext(`threat.${threat}`)}</Badge>}
        {excluded && <Badge color="var(--crit)">{tContext("excluded")}</Badge>}
        {isMissing && <Badge color="var(--crit)">{t("missingInRepo")}</Badge>}
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
