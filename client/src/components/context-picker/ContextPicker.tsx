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
import { Badge, Button, Card, Drawer, Icon, Markdown } from "@devdigest/ui";
import { useContextDocument } from "@/lib/hooks";
import {
  buildDisplayRows,
  canAttach,
  filterDisplayRows,
  insertAttachedPath,
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
import { s, dragHandleButtonStyle, rowDragStyle, sourceRootColor } from "./styles";

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
  // The path currently shown in the preview drawer — one drawer for the
  // whole list (same shape as `dragOverPath` below): opening a different
  // row's preview replaces the contents rather than opening a second
  // drawer, and `null` means the drawer is closed.
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

  // Escape precedence: the drawer closes first. `Drawer` itself has no
  // Escape handling (its scrim only closes on click — see Drawer.tsx), so
  // this call site owns it. A capture-phase `window` listener — registered
  // only while the drawer is open — intercepts Escape before it ever
  // reaches the grabbed row's handle button, whose own `onKeyDown` (above)
  // is what cancels a keyboard grab. `stopPropagation` during capture keeps
  // the event from reaching that handler at all, so one Escape press never
  // both closes the drawer *and* cancels a grab. If a row happens to be
  // grabbed while the drawer is open, that grab is left untouched — not
  // cancelled — by this keypress; a second Escape, pressed once the drawer
  // is closed (and this listener has unmounted), reaches the handle
  // normally and cancels the grab as it always has. Rationale: the drawer
  // is the topmost, most recently opened modal-like surface, so it owns
  // the next Escape the same way a modal would.
  React.useEffect(() => {
    if (!previewPath) return;
    function handleWindowKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setPreviewPath(null);
    }
    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => window.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [previewPath]);

  // Every row is a native HTML5 drag source now — not just the attached
  // rows' handle button — so `onDragStart` lives on the `<li>` and fires
  // for both attached and unattached rows. The handle stays as a real
  // `<button>` for keyboard grab/arrow-move/Escape (attached rows only,
  // NFR-4) and as the visual "this is grabbable" affordance, but no longer
  // carries its own `draggable`/`onDragStart` — a drag started anywhere on
  // the handle bubbles up to the `<li>` exactly like a drag started
  // anywhere else on the row body, since the handle itself declares no
  // competing `draggable` value. The checkbox and the Preview button *do*
  // declare `draggable={false}` explicitly — per the HTML drag-and-drop
  // processing model that stops the browser from walking further up the
  // ancestor chain to find a draggable source, so a click-drag started on
  // either control never hijacks the row and their normal click behaviour
  // (toggle / open preview) is untouched.
  function handleDragStart(e: React.DragEvent<HTMLLIElement>, path: string) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", path);
    setDraggingPath(path);
    // A mouse drag takes over from any in-progress keyboard grab.
    setGrabbedPath(null);
    setGrabSnapshot(null);
  }

  function handleDragEnd() {
    setDraggingPath(null);
    setDragOverPath(null);
  }

  // Single gate for "would dropping sourcePath onto targetPath do
  // anything" — shared by the hover indicator (which only has `draggingPath`
  // state to go on, since `dataTransfer.getData` isn't readable during
  // `dragover` for security reasons) and the actual drop handler (which has
  // the real payload from `dataTransfer.getData` at drop time). Three rules,
  // matched to what `attachedPaths` order actually means (the order
  // documents are injected into the prompt — only meaningful among attached
  // documents):
  //  - target must be attached — dropping into the unattached area is
  //    always a no-op (never detach-by-drop; EC-4/checkbox stays the only
  //    explicit detach path).
  //  - source already attached → valid, `reorderAttachedPath` handles it.
  //  - source not yet attached → valid only if it's actually attachable
  //    (EC-4: an excluded, unattached document can't be newly attached via
  //    drag any more than via its disabled checkbox) — `insertAttachedPath`
  //    handles it.
  function canDrop(sourcePath: string, targetPath: string): boolean {
    if (sourcePath === targetPath) return false;
    if (!attachedPaths.includes(targetPath)) return false;
    if (attachedPaths.includes(sourcePath)) return true;
    const sourceRow = allRows.find((r) => r.path === sourcePath);
    return !!sourceRow && canAttach(sourceRow, false);
  }

  function handleDropOn(targetPath: string, sourcePath: string) {
    setDraggingPath(null);
    setDragOverPath(null);
    if (!canDrop(sourcePath, targetPath)) return;
    const result = attachedPaths.includes(sourcePath)
      ? reorderAttachedPath(attachedPaths, sourcePath, targetPath)
      : insertAttachedPath(attachedPaths, sourcePath, targetPath);
    if (!result) return;
    onChange(result.paths);
    announceMove(sourcePath, result.position, result.total);
  }

  return (
    <>
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
                onRowDragStart={(e) => handleDragStart(e, row.path)}
                onRowDragEnd={handleDragEnd}
                onRowDragOver={(e) => {
                  if (!draggingPath || !canDrop(draggingPath, row.path)) return;
                  e.preventDefault();
                  setDragOverPath(row.path);
                }}
                onRowDragLeave={() => setDragOverPath((p) => (p === row.path ? null : p))}
                onRowDrop={(e) => {
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
      {/* One drawer for the whole list, not one per row — `previewPath` is
          the single source of truth for "which document, if any, is being
          previewed". Rendered as a sibling of `Card` (matching how
          `RunTraceDrawer` is mounted alongside the page it belongs to)
          since `Drawer` is a fixed-position overlay; nesting it inside the
          card would add nothing and risks an ancestor clipping it. */}
      {previewPath && (
        <ContextDocumentDrawer repoId={repoId} path={previewPath} onClose={() => setPreviewPath(null)} />
      )}
    </>
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
  isGrabbed: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  instructionsId: string;
  onHandleKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  onRowDragStart: (e: React.DragEvent<HTMLLIElement>) => void;
  onRowDragEnd: () => void;
  onRowDragOver: (e: React.DragEvent<HTMLLIElement>) => void;
  onRowDragLeave: () => void;
  onRowDrop: (e: React.DragEvent<HTMLLIElement>) => void;
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
  isGrabbed,
  isDragging,
  isDragOver,
  instructionsId,
  onHandleKeyDown,
  onRowDragStart,
  onRowDragEnd,
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
      // Every row is a native drag source now — dropping an unattached row
      // onto the attached group attaches it at that position, dropping an
      // attached row reorders — not just the handle, since restricting the
      // gesture to a 16px glyph is why users couldn't find it. `draggable`
      // (not the handle's own attribute — it has none now) is what the
      // browser's drag-and-drop ancestor walk resolves to when the drag
      // starts anywhere on the row *except* the checkbox/Preview button,
      // which each declare `draggable={false}` to opt out (see the
      // `handleDragStart` comment above for why that works). Disabled
      // while `busy`, matching every other mutating control on this row.
      draggable={!busy}
      onDragStart={onRowDragStart}
      onDragEnd={onRowDragEnd}
      onDragOver={onRowDragOver}
      onDragLeave={onRowDragLeave}
      onDrop={onRowDrop}
      style={{ ...s.row, ...rowDragStyle(isDragOver, isDragging) }}
    >
      {/* The handle is the keyboard-operable control (Space/Enter grab,
          arrow move, Escape cancel — NFR-4, attached rows only, since
          reordering only has meaning among attached documents) and the
          visual "this is grabbable" affordance. It carries no `draggable`
          of its own — the `<li>` above owns the actual native drag, so a
          mouse drag started on the handle bubbles up to it exactly like a
          drag started on the row body. Unattached rows keep the old inert,
          aria-hidden span at the same fixed size so the leading column
          never shifts, but the row itself is still a drag source (see
          `onRowDragStart` above) — an unattached row can be dragged into
          the attached group to attach it at the drop position. */}
      {isAttached ? (
        <button
          type="button"
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
        // Opts the checkbox out of the row's `draggable` — see the `<li>`
        // comment above. Without this, a click-drag started on the
        // checkbox would be captured as a row drag instead of a toggle.
        draggable={false}
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

        <Button
          kind="tertiary"
          size="sm"
          icon="Eye"
          active={previewOpen}
          onClick={onTogglePreview}
          // Opts out of the row's `draggable` (same reasoning as the
          // checkbox above) and pins its own cursor so it doesn't visually
          // inherit the row's grab/grabbing cursor while dragging is armed.
          draggable={false}
          style={{ cursor: "pointer" }}
        >
          {tContext("mode.preview")}
        </Button>

        {showThreatBadge && <Badge color={threatColor(threat)}>{tContext(`threat.${threat}`)}</Badge>}
        {excluded && <Badge color="var(--crit)">{tContext("excluded")}</Badge>}
        {isMissing && (
          // `Badge` doesn't forward arbitrary DOM props, so the hover
          // tooltip/description lives on a wrapping span instead. `title`
          // (not `aria-label`) is deliberate: the accessible-name
          // computation only falls back to `title` when the element has no
          // text content of its own — since the wrapped `Badge` already
          // renders visible text ("Missing"), that stays the accessible
          // name, and `title` is exposed as supplementary description
          // instead of replacing it (screen readers that surface `title`
          // announce it alongside, not instead of, the label). An
          // `aria-label` here would instead override the name entirely and
          // risk being read twice (once for the wrapper, once for the
          // Badge's own visible text), which is the reading-order footgun
          // `title` avoids.
          <span title={tContext("missingInRepoDetail")}>
            <Badge color="var(--crit)">{tContext("missingInRepo")}</Badge>
          </span>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Preview drawer — one for the whole list (see `previewPath` above). Header
// splits the path the same way the row does: filename as `title`, directory
// prefix as `subtitle`. The scrim already closes on click (Drawer.tsx);
// Escape is handled by the `window` listener in `ContextPicker` above, not
// here, so it can take precedence over an in-progress keyboard grab.
// ---------------------------------------------------------------------------

function ContextDocumentDrawer({
  repoId,
  path,
  onClose,
}: {
  repoId: string;
  path: string;
  onClose: () => void;
}) {
  const { dir, name } = splitPathParts(path);
  return (
    <Drawer title={name} subtitle={dir || undefined} onClose={onClose}>
      <ContextDocumentBody repoId={repoId} path={path} />
    </Drawer>
  );
}

// Owns its own fetch. The list endpoint that supplies `documents` always
// returns `content: null` (server/src/modules/context/service.ts); only
// `GET /repos/:id/context/document?path=` populates it. Mounted (and
// therefore fetching) only while the drawer holding it is open — see the
// `previewPath &&` guard in `ContextPicker` — so `useContextDocument` stays
// disabled, and never fires, until the user actually opens a preview, and
// only for that one path. Rendered through the shared, hardened `Markdown`
// primitive (not a raw `<pre>`/`dangerouslySetInnerHTML`) — document bodies
// are repository-controlled text, and `Markdown` is what neutralizes an
// unsafe-scheme link (`javascript:`, `data:`, …) into inert text instead of
// an active one; see its own comment for the mechanism.
function ContextDocumentBody({ repoId, path }: { repoId: string; path: string }) {
  const tCommon = useTranslations("common");
  const { data, isLoading, isError } = useContextDocument(repoId, path);

  if (isLoading) return <p style={s.previewStatus}>{tCommon("states.loading")}</p>;
  if (isError) return <p style={s.previewStatus}>{tCommon("states.error")}</p>;
  if (!data?.content) return null;
  return <Markdown>{data.content}</Markdown>;
}
