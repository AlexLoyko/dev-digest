/* RiskAreas — the "⚠ RISK AREAS" block mounted inside IntentCard (AC-17).
   Gated ONLY on `data.brief` — never on `data.latest_run` — so it renders
   whenever a brief is stored, regardless of whether any agent run exists.
   Each row is a real <button> (keyboard-operable, R-11/NFR-4): collapsed it
   shows the severity treatment, title and grounded file references; the
   explanation is revealed in full only on expand (EC-7) — never a partial
   sentence with no way to read the rest.

   Severity is conveyed by a small icon (shape from `SEV[severity].icon`,
   colour from `SEV[severity].c`) rather than the full labelled
   `SeverityBadge` (spec design 01-loaded-overview.png) — the icon SHAPE
   already differs per severity (AlertOctagon/AlertTriangle/Lightbulb), so
   dropping the visible text label does not regress NFR-4: it carries its
   accessible name via `role="img"` + `aria-label`, the same pattern
   `BriefCard.tsx` uses for wrapping a vendor primitive that has no prop for
   it. File references render as `Badge mono` chips — the same "mono text on
   a tinted background" treatment used for scores/ids elsewhere in the
   product (e.g. `ReviewRunAccordion.tsx`) — one per grounded ref, never a
   single comma-joined string. */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, Skeleton, SEV, Badge } from "@devdigest/ui";
import type { Risk, BriefFileRef } from "@devdigest/shared";
import { useBrief } from "@/lib/hooks";
import { riskLevelToSeverity } from "@/lib/utils/riskSeverity";

interface RiskAreasProps {
  prId: string | number;
}

// Row layout constants — the icon occupies a fixed-width gutter on the left;
// the title and the file-ref chips beneath it share ONE content column
// starting at the same left edge (gutter width + the gap after it). The
// expanded explanation block reuses this same offset so it lines up with the
// title/chips rather than the icon.
const ROW_PADDING_X = 10;
const ICON_GUTTER_WIDTH = 14;
const ROW_CONTENT_GAP = 8;
const ROW_CONTENT_LEFT_OFFSET = ROW_PADDING_X + ICON_GUTTER_WIDTH + ROW_CONTENT_GAP;

const sectionWrapperStyle: React.CSSProperties = {
  marginTop: 16,
  borderTop: "1px solid var(--border)",
  paddingTop: 16,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const sectionLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  margin: "0 0 2px 0",
};

const rowButtonStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  width: "100%",
  padding: `8px ${ROW_PADDING_X}px`,
  background: "none",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
  color: "inherit",
};

const iconGutterStyle: React.CSSProperties = {
  width: ICON_GUTTER_WIDTH,
  flexShrink: 0,
  display: "flex",
  justifyContent: "center",
  paddingTop: 1,
};

const explanationWrapStyle: React.CSSProperties = {
  padding: `0 ${ROW_PADDING_X}px 10px ${ROW_CONTENT_LEFT_OFFSET}px`,
};

/** `path:12-18` / `path:12` / `path` — grounded file references rendered in
 *  mono, matching the design's RISK AREAS block (specs/SPEC-02-pr-why-risk-
 *  brief/design/01-loaded-overview.png). Never markup — plain text only. */
function formatFileRef(ref: BriefFileRef): string {
  if (ref.start_line == null) return ref.path;
  if (ref.end_line == null || ref.end_line === ref.start_line) {
    return `${ref.path}:${ref.start_line}`;
  }
  return `${ref.path}:${ref.start_line}-${ref.end_line}`;
}

/** Content-derived key — `Risk` (brief.ts) carries no id. Never the bare
 *  array index: two risks sharing a kind/title still resolve to distinct
 *  keys through their first grounded file reference. */
function riskKey(risk: Risk): string {
  const ref = risk.file_refs[0];
  return `${risk.kind}::${risk.title}::${ref?.path ?? ""}::${ref?.start_line ?? ""}::${ref?.end_line ?? ""}`;
}

export function RiskAreas({ prId }: RiskAreasProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = useBrief(prId);
  const risks = data?.brief?.risks ?? [];

  if (isLoading) {
    return (
      <div style={sectionWrapperStyle}>
        <Skeleton height={12} width="30%" />
        <Skeleton height={40} width="100%" />
        <Skeleton height={40} width="100%" />
      </div>
    );
  }

  // AC-17: presented whenever a brief is stored, regardless of any agent
  // run — gated only on the brief itself, never on `data?.latest_run`.
  if (!data?.brief || risks.length === 0) return null;

  return (
    <div style={sectionWrapperStyle}>
      <p style={sectionLabelStyle}>
        <Icon.AlertTriangle size={12} aria-hidden="true" />
        {t("risks.sectionLabel")}
      </p>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {risks.map((risk, i) => (
          <RiskRow
            key={riskKey(risk)}
            risk={risk}
            isLast={i === risks.length - 1}
            showMoreLabel={t("risks.showMore")}
            showLessLabel={t("risks.showLess")}
          />
        ))}
      </div>
    </div>
  );
}

function RiskRow({
  risk,
  isLast,
  showMoreLabel,
  showLessLabel,
}: {
  risk: Risk;
  isLast: boolean;
  showMoreLabel: string;
  showLessLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const severity = riskLevelToSeverity(risk.severity);
  const sev = SEV[severity];
  const SevIcon = Icon[sev.icon];

  return (
    <div style={{ borderBottom: isLast ? "none" : "1px solid var(--border)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? showLessLabel : showMoreLabel}
        style={rowButtonStyle}
      >
        <span style={{ display: "flex", alignItems: "flex-start", gap: ROW_CONTENT_GAP, width: "100%" }}>
          <span style={iconGutterStyle}>
            <SevIcon size={14} role="img" aria-label={sev.label} style={{ color: sev.c }} />
          </span>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                {risk.title}
              </span>
              <Icon.ChevronDown
                size={14}
                aria-hidden="true"
                style={{
                  color: "var(--text-muted)",
                  flexShrink: 0,
                  transform: open ? "rotate(180deg)" : undefined,
                  transition: "transform 0.15s",
                }}
              />
            </span>
            {risk.file_refs.length > 0 && (
              <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {risk.file_refs.map((ref, i) => (
                  <Badge key={`${ref.path}:${ref.start_line ?? ""}:${ref.end_line ?? ""}:${i}`} mono>
                    {formatFileRef(ref)}
                  </Badge>
                ))}
              </span>
            )}
          </span>
        </span>
      </button>

      {open && (
        <div style={explanationWrapStyle}>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {risk.explanation}
          </p>
        </div>
      )}
    </div>
  );
}
