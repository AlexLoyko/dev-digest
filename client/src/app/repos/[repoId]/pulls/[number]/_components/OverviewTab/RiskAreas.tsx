/* RiskAreas — the "⚠ RISK AREAS" block mounted inside IntentCard (AC-17).
   Gated ONLY on `data.brief` — never on `data.latest_run` — so it renders
   whenever a brief is stored, regardless of whether any agent run exists.
   Each row is a real <button> (keyboard-operable, R-11/NFR-4): collapsed it
   shows the severity treatment, title and grounded file references; the
   explanation is revealed in full only on expand (EC-7) — never a partial
   sentence with no way to read the rest. */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, Skeleton, SEV } from "@devdigest/ui";
import type { Risk, BriefFileRef } from "@devdigest/shared";
import { useBrief } from "@/lib/hooks";
import { riskLevelToSeverity } from "@/lib/utils/riskSeverity";

interface RiskAreasProps {
  prId: string | number;
}

const sectionWrapperStyle: React.CSSProperties = {
  borderTop: "1px solid var(--border)",
  paddingTop: 12,
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
  padding: "8px 10px",
  background: "none",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
  color: "inherit",
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
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {risks.map((risk) => (
          <RiskRow key={riskKey(risk)} risk={risk} showMoreLabel={t("risks.showMore")} showLessLabel={t("risks.showLess")} />
        ))}
      </div>
    </div>
  );
}

function RiskRow({
  risk,
  showMoreLabel,
  showLessLabel,
}: {
  risk: Risk;
  showMoreLabel: string;
  showLessLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const severity = riskLevelToSeverity(risk.severity);
  const sev = SEV[severity];
  const fileRefs = risk.file_refs.map(formatFileRef).join(", ");

  return (
    <div style={{ border: `1px solid ${sev.c}40`, borderRadius: 6, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? showLessLabel : showMoreLabel}
        style={rowButtonStyle}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <SeverityBadge severity={severity} />
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
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
        <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {fileRefs}
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 10px 10px 10px" }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {risk.explanation}
          </p>
        </div>
      )}
    </div>
  );
}
