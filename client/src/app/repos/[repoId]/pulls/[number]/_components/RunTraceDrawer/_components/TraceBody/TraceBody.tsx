/* TraceBody — the Trace tab content: Configuration, Stats, Findings, Prompt
   assembly, Tool calls, and Raw output sections for one persisted RunTrace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { RunTrace, FindingRecord, SpecRead } from "@devdigest/shared";
import { PROMPT_COLORS, SPECS_STATUS_COLORS } from "../../constants";
import { formatCost, formatSeconds, formatTokens } from "../../helpers";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { ToolCallRow } from "../ToolCallRow";
import { PromptBlock } from "../PromptBlock";
import { FindingsSection } from "../FindingsSection";
import { Row, Stat } from "../atoms";

// Local layout for the per-spec rows and the clone-sha line. Kept colocated
// here (not in styles.ts) since TraceBody owns only its own file for this task.
const specItemStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const specTokensStyle: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };
const specsShaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginTop: 6,
  fontSize: 12,
  color: "var(--text-muted)",
};
// Overrides s.specsWrap's row-wrap layout (built for the old flat chip list)
// with a vertical stack so the per-spec rows and the clone-sha line sit on
// their own lines. Local to this file — styles.ts is out of scope for T18.
const specsContainerStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };

function SpecStatusBadge({ status }: { status: SpecRead["status"] }) {
  const t = useTranslations("runs");
  const c = SPECS_STATUS_COLORS[status];
  return (
    <Badge color={c.color} bg={c.bg}>
      {t(`trace.config.specsStatus.${status}`)}
    </Badge>
  );
}

function SpecReadItem({ spec }: { spec: SpecRead }) {
  const t = useTranslations("runs");
  return (
    <div style={specItemStyle}>
      <span className="mono" style={s.spec}>
        {spec.path}
      </span>
      <span style={specTokensStyle}>
        {spec.tokens_approximate ? "≈" : ""}
        {t("trace.config.specsTokens", { count: spec.tokens })}
      </span>
      <SpecStatusBadge status={spec.status} />
    </div>
  );
}

export function TraceBody({ trace, findings }: { trace: RunTrace; findings: FindingRecord[] }) {
  const t = useTranslations("runs");
  const stats = trace.stats;
  return (
    <>
      <TraceSection icon="Settings" title={t("trace.configuration")}>
        <div style={s.configList}>
          <Row label={t("trace.config.model")}>
            <span className="mono" style={s.configModel}>
              {trace.config.model}
            </span>
          </Row>
          <Row label={t("trace.config.provider")}>
            <span className="mono" style={s.configProvider}>
              {trace.config.provider ?? "—"}
            </span>
          </Row>
          <Row label={t("trace.config.memoryPulled")}>
            <span>{t("trace.config.items", { count: trace.memory_pulled.length })}</span>
          </Row>
          <Row label={t("trace.config.specsRead")}>
            <div style={specsContainerStyle}>
              {trace.specs_read.length === 0 ? (
                <span style={s.specsNone}>{t("trace.config.none")}</span>
              ) : (
                trace.specs_read.map((sp, i) => <SpecReadItem key={i} spec={sp} />)
              )}
              {trace.specs_commit_sha != null && (
                <div style={specsShaStyle}>
                  <Icon.GitCommit size={12} aria-hidden="true" />
                  <span className="mono">{trace.specs_commit_sha}</span>
                </div>
              )}
            </div>
          </Row>
        </div>
      </TraceSection>

      <TraceSection
        icon="Gauge"
        title={t("trace.stats")}
        right={
          <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
            {stats.grounding}
          </Badge>
        }
      >
        <div style={s.statsRow}>
          <Stat label={t("trace.stat.duration")} val={formatSeconds(stats.duration_ms)} />
          <Stat label={t("trace.stat.tokens")} val={formatTokens(stats.tokens_in, stats.tokens_out)} />
          <Stat label={t("trace.stat.cost")} val={formatCost(stats.cost_usd)} />
          <Stat label={t("trace.stat.findings")} val={stats.findings} />
        </div>
      </TraceSection>

      <FindingsSection findings={findings} />

      <TraceSection icon="FileText" title={t("trace.promptAssembly")} defaultOpen={false}>
        <PromptBlock label={t("trace.prompt.system")} text={trace.prompt_assembly.system} color={PROMPT_COLORS.system} />
        {trace.prompt_assembly.skills != null && (
          <PromptBlock label={t("trace.prompt.skills")} text={trace.prompt_assembly.skills} color={PROMPT_COLORS.skills} />
        )}
        {trace.prompt_assembly.memory != null && (
          <PromptBlock label={t("trace.prompt.memory")} text={trace.prompt_assembly.memory} color={PROMPT_COLORS.memory} />
        )}
        {trace.prompt_assembly.repo_map != null && (
          <PromptBlock label={t("trace.prompt.repoMap")} text={trace.prompt_assembly.repo_map} color={PROMPT_COLORS.repoMap} />
        )}
        {trace.prompt_assembly.specs != null && (
          <PromptBlock label={t("trace.prompt.specs")} text={trace.prompt_assembly.specs} color={PROMPT_COLORS.specs} />
        )}
        {trace.prompt_assembly.callers != null && (
          <PromptBlock label={t("trace.prompt.callers")} text={trace.prompt_assembly.callers} color={PROMPT_COLORS.callers} />
        )}
        <PromptBlock label={t("trace.prompt.user")} text={trace.prompt_assembly.user} color={PROMPT_COLORS.user} />
      </TraceSection>

      <TraceSection
        icon="Wrench"
        title={t("trace.toolCalls")}
        right={<Badge color="var(--text-muted)">{trace.tool_calls.length}</Badge>}
      >
        {trace.tool_calls.length === 0 ? (
          <span style={s.noToolCalls}>{t("trace.noToolCalls")}</span>
        ) : (
          trace.tool_calls.map((tc, i) => <ToolCallRow key={i} tc={tc} />)
        )}
      </TraceSection>

      <TraceSection icon="Code" title={t("trace.rawOutput")} defaultOpen={false}>
        <pre className="mono" style={s.rawPre}>
          {trace.raw_output || "—"}
        </pre>
      </TraceSection>
    </>
  );
}
