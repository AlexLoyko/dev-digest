/* PriorPrs — collapsible list of prior PRs that touched overlapping files.
 * Links reuse the existing `githubPrUrl` helper (already used in page.tsx). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, MonoLink } from "@devdigest/ui";
import type { BlastPriorPr } from "@devdigest/shared";
import { githubPrUrl } from "@/lib/utils/githubUrls";
import { s } from "./styles";

export function PriorPrs({
  priorPrs,
  repoFullName,
}: {
  priorPrs: BlastPriorPr[];
  repoFullName: string | null;
}) {
  const t = useTranslations("blast");
  const [open, setOpen] = React.useState(false);

  if (priorPrs.length === 0) {
    return (
      <div style={{ ...s.priorPrsToggle, cursor: "default", opacity: 0.6 }}>
        <Icon.History size={14} aria-hidden="true" />
        {t("priorPrs.empty")}
      </div>
    );
  }

  return (
    <div>
      <button type="button" style={s.priorPrsToggle} onClick={() => setOpen((o) => !o)}>
        <Icon.ChevronRight
          size={14}
          style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .12s" }}
          aria-hidden="true"
        />
        {t("priorPrs.label")} ({priorPrs.length})
      </button>
      {open && (
        <div style={s.priorPrList}>
          {priorPrs.map((pr) => {
            const href = repoFullName ? githubPrUrl(repoFullName, pr.number) : undefined;
            return (
              <div key={pr.number} style={s.priorPrRow}>
                <MonoLink href={href}>
                  #{pr.number} {pr.title}
                </MonoLink>
                <span style={s.priorPrMeta}>
                  {pr.author} · {t("priorPrs.overlapCount", { count: pr.files_overlap.length })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
