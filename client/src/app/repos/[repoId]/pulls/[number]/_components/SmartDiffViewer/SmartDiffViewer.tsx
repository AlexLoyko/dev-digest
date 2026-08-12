/* SmartDiffViewer — the "Smart order" view of the Files tab (L03).

   Renders the server's role groups (core / wiring / boilerplate) as sections of
   collapsible file cards, opening only the files that carry findings, and marks
   each flagged line with a severity chip that navigates back to that finding.

   Two data sources, deliberately:
   - the server's SmartDiff decides grouping, order, and which files auto-open
     (`finding_lines`);
   - the page's existing findings decide the chips, because `finding_lines` is a
     bare number[] with no severity and no id — and a chip has to link to one.

   See `client/specs/0003-smart-diff.md`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, type Severity } from "@devdigest/ui";
import { parsePatch } from "@/components/diff-viewer";
import type { FindingRecord, PrFile, SmartDiff, SmartDiffFile } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { ROLE_META } from "./constants";
import { anchorsByLine, findingsByLine, indexByPath, worstOf, worstSeverityForFile } from "./helpers";
import { chevron, chip, dot, lineRow, lineSign, s } from "./styles";

interface SmartDiffViewerProps {
  smartDiff: SmartDiff;
  /** The PR's files — the source of the patch text the groups refer to. */
  files: PrFile[];
  /** Every persisted finding for this PR (from the reviews query). */
  findings: FindingRecord[];
  repoFullName?: string | null;
  headSha?: string | null;
  /** Navigate to a finding in the Agent-runs tab. */
  onFocusFinding?: (id: string) => void;
}

const sevOf = (severity: string) => SEV[severity as Severity] ?? SEV.INFO;

function SmartDiffFileCard({
  entry,
  file,
  findings,
  repoFullName,
  headSha,
  onFocusFinding,
}: {
  entry: SmartDiffFile;
  file: PrFile | undefined;
  findings: FindingRecord[];
  repoFullName?: string | null;
  headSha?: string | null;
  onFocusFinding?: (id: string) => void;
}) {
  const t = useTranslations("prReview");
  // The "no diff text" string belongs to the diff viewer's namespace — reuse it
  // rather than minting a second key for the same sentence.
  const tShell = useTranslations("shell");
  const hasFindings = entry.finding_lines.length > 0;
  // Auto-open exactly the flagged files: opening the tab after a review shows
  // the code that was criticised and nothing else.
  //
  // Store only the user's DEVIATION from that default, never the resolved open
  // state. `key` is the stable `entry.path`, so a card is not remounted when a
  // review finishes and `finding_lines` goes [] → [26]; seeding `useState` with
  // `hasFindings` would freeze the mount-time value and leave the newly-flagged
  // file collapsed — exactly the flow `invalidateSmartDiff()` exists to serve.
  const [override, setOverride] = React.useState<boolean | null>(null);
  const open = override ?? hasFindings;

  const lines = React.useMemo(() => parsePatch(file?.patch), [file?.patch]);
  const byLine = React.useMemo(
    () => findingsByLine(findings, entry.path, lines),
    [findings, entry.path, lines],
  );
  const anchors = React.useMemo(
    () => anchorsByLine(findings, entry.path, lines),
    [findings, entry.path, lines],
  );
  const fileSeverity = worstSeverityForFile(findings, entry.path);

  // An empty sha silently yields a `…/blob//path` 404, so guard on truthiness.
  const href =
    repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, entry.path) : undefined;

  return (
    <div style={s.fileCard}>
      {/* A <button> may not contain interactive descendants, so the GitHub link is a
          sibling of the toggle rather than nested inside it. The button keeps the
          full-width click target and takes its accessible name from its own content;
          `aria-expanded` is what tells AT the body is collapsed. */}
      <div style={s.fileHeaderRow}>
        <button
          type="button"
          onClick={() => setOverride((o) => !(o ?? hasFindings))}
          aria-expanded={open}
          style={s.fileHeader}
        >
          <Icon.ChevronRight size={13} style={chevron(open)} />
          <Icon.FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <span className="mono" style={s.filePath}>
            {entry.path}
          </span>
          {fileSeverity && <span style={dot(sevOf(fileSeverity).c, 6)} />}
          <span className="mono tnum" style={s.fileStat}>
            <span style={s.addText}>+{entry.additions}</span>{" "}
            <span style={s.delText}>−{entry.deletions}</span>
          </span>
        </button>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={s.fileLink}
            aria-label={t("smartDiff.openOnGitHub", { path: entry.path })}
          >
            <Icon.ExternalLink size={13} />
          </a>
        )}
      </div>

      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{tShell("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => {
              if (ln.kind === "hunk") {
                return (
                  <div key={i} className="mono" style={s.hunk}>
                    {ln.text}
                  </div>
                );
              }
              const onLine = ln.newNo != null ? byLine.get(ln.newNo) : undefined;
              // Edge bar: coloured by the WORST finding covering this line, so a
              // blocker is never hidden under a suggestion that spans it.
              const sev = onLine ? sevOf(worstOf(onLine)!.severity) : undefined;
              // Chip: ONE per anchor line (see `anchorsByLine` — the first
              // CHANGED line each finding covers, not its cited start). When
              // several agents flag one line, the chip takes the worst severity
              // and its tooltip names them all; no count is shown, since a count
              // beside a severity label reads as a count OF that severity.
              const startsHere = ln.newNo != null ? (anchors.get(ln.newNo) ?? []) : [];
              const lead = startsHere[0];
              const leadSev = lead ? sevOf(lead.severity) : undefined;
              const ChipIcon = leadSev ? Icon[leadSev.icon] : null;
              return (
                <div key={i} style={lineRow(ln.kind, sev?.c)}>
                  <span className="mono tnum" style={s.lineNo}>
                    {ln.newNo ?? ln.oldNo ?? ""}
                  </span>
                  <span className="mono" style={lineSign(ln.kind)}>
                    {ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : ""}
                  </span>
                  <span className="mono" style={s.lineText}>
                    {ln.text || " "}
                  </span>
                  {lead && leadSev && (
                    <button
                      type="button"
                      title={startsHere.map((f) => f.title).join("\n")}
                      onClick={() => onFocusFinding?.(lead.id)}
                      style={chip(leadSev.c, leadSev.bg)}
                    >
                      {ChipIcon && <ChipIcon size={11} />}
                      {t(`smartDiff.sev${lead.severity}` as "smartDiff.sevCRITICAL")}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export function SmartDiffViewer({
  smartDiff,
  files,
  findings,
  repoFullName,
  headSha,
  onFocusFinding,
}: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  const byPath = React.useMemo(() => indexByPath(files), [files]);
  const { groups, split_suggestion: split } = smartDiff;

  return (
    <div style={s.wrap}>
      {split.too_big && (
        <div style={s.splitBanner}>
          <Icon.Layers size={16} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={s.splitTitle}>
              {t("smartDiff.largeTitle", { lines: split.total_lines })}
            </div>
            <div style={s.splitBody}>{t("smartDiff.largeBody")}</div>
            <div style={s.splitList}>
              {split.proposed_splits.map((p) => (
                <span key={p.name} style={s.splitChip} className="mono">
                  {p.name} · {t("smartDiff.filesCount", { count: p.files.length })}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {groups.map((g) => {
        const meta = ROLE_META[g.role];
        const RoleIcon = Icon[meta.icon];
        return (
          <div key={g.role} style={s.group}>
            <div style={s.groupHeader}>
              <span style={dot(meta.color)} />
              <RoleIcon size={13} style={{ color: meta.color, flexShrink: 0 }} />
              <span style={s.groupLabel}>{t(`smartDiff.${meta.labelKey}` as "smartDiff.coreLabel")}</span>
              <span style={s.groupDesc}>{t(`smartDiff.${meta.descKey}` as "smartDiff.coreDesc")}</span>
              <span style={s.groupCount}>
                {t("smartDiff.filesCount", { count: g.files.length })}
              </span>
            </div>
            <div style={s.fileList}>
              {g.files.map((entry) => (
                <SmartDiffFileCard
                  key={entry.path}
                  entry={entry}
                  file={byPath.get(entry.path)}
                  findings={findings}
                  repoFullName={repoFullName}
                  headSha={headSha}
                  onFocusFinding={onFocusFinding}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
