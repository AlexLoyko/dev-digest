/* BlastTree — collapsible list of changed symbols, each expandable to its
 * caller list + downstream endpoint/cron chips. Caller links (and fact-chip
 * links) use `indexed_sha` — NEVER `head_sha`. See helpers.ts. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, MonoLink, Badge } from "@devdigest/ui";
import type { BlastSymbolNode } from "@devdigest/shared";
import { callerHref, symbolHref, factHref } from "./helpers";
import { s } from "./styles";

export function BlastTree({
  symbols,
  repoFullName,
  indexedSha,
  headSha,
}: {
  symbols: BlastSymbolNode[];
  repoFullName: string | null;
  indexedSha: string | null;
  headSha: string;
}) {
  const t = useTranslations("blast");
  const [expanded, setExpanded] = React.useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div style={s.tree}>
      {symbols.map((symbol, i) => {
        const isOpen = expanded.has(i);
        const headHref = repoFullName ? symbolHref(repoFullName, headSha, symbol.file) : null;
        return (
          <div key={`${symbol.file}:${symbol.name}:${i}`} style={s.symbolRow}>
            <div style={s.symbolHeader} onClick={() => toggle(i)}>
              <Icon.ChevronRight
                size={14}
                style={{
                  color: "var(--text-muted)",
                  transform: isOpen ? "rotate(90deg)" : undefined,
                  transition: "transform .12s",
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                {headHref ? (
                  <MonoLink href={headHref}>{symbol.name}</MonoLink>
                ) : (
                  <span className="mono" style={s.symbolName}>
                    {symbol.name}
                  </span>
                )}
                <span style={s.symbolKind}>{symbol.kind}</span>
              </div>
              <Badge>{t("callerCount", { count: symbol.caller_total })}</Badge>
            </div>

            {isOpen && (
              <div style={s.symbolBody}>
                {symbol.callers.length > 0 && (
                  <div style={s.callerList}>
                    {symbol.callers.map((caller, ci) => {
                      const href = repoFullName ? callerHref(repoFullName, indexedSha, caller) : null;
                      return (
                        <div key={`${caller.file}:${caller.line}:${ci}`} style={s.callerRow}>
                          {href ? (
                            <MonoLink href={href}>
                              {caller.file}:{caller.line}
                            </MonoLink>
                          ) : (
                            <span className="mono">
                              {caller.file}:{caller.line}
                            </span>
                          )}
                          <span style={s.callerSymbol}>({caller.symbol})</span>
                        </div>
                      );
                    })}
                    {symbol.callers_truncated && (
                      <span style={s.truncatedHint}>
                        {t("truncatedHint", { count: symbol.caller_total - symbol.callers.length })}
                      </span>
                    )}
                  </div>
                )}

                {symbol.endpoints.length > 0 && (
                  <div>
                    <div style={s.factGroupLabel}>{t("endpointsLabel")}</div>
                    <div style={s.factChips}>
                      {symbol.endpoints.map((fact, fi) => {
                        const href = repoFullName ? factHref(repoFullName, indexedSha, fact) : null;
                        return (
                          <Badge key={`${fact.label}:${fi}`} icon="Globe">
                            {href ? (
                              <MonoLink href={href}>{fact.label}</MonoLink>
                            ) : (
                              <span className="mono">{fact.label}</span>
                            )}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                {symbol.crons.length > 0 && (
                  <div>
                    <div style={s.factGroupLabel}>{t("cronsLabel")}</div>
                    <div style={s.factChips}>
                      {symbol.crons.map((fact, fi) => {
                        const href = repoFullName ? factHref(repoFullName, indexedSha, fact) : null;
                        return (
                          <Badge key={`${fact.label}:${fi}`} icon="Clock">
                            {href ? (
                              <MonoLink href={href}>{fact.label}</MonoLink>
                            ) : (
                              <span className="mono">{fact.label}</span>
                            )}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                )}

                {symbol.facts_truncated && (
                  <span style={s.truncatedHint}>
                    {t("truncatedHint", {
                      count:
                        symbol.endpoint_total +
                        symbol.cron_total -
                        symbol.endpoints.length -
                        symbol.crons.length,
                    })}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
