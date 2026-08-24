/* BlastGraph — lightweight inline-SVG node/edge diagram (house style borrowed
 * from charts/Sparkline.tsx: no external chart lib, theme-aware CSS vars).
 *
 * Three columns: changed symbols -> caller files (deduped) -> downstream
 * endpoint/cron labels (deduped). Edges: symbol -> caller-file for every
 * caller of that symbol; caller-file -> fact only when the fact belongs to a
 * symbol that file also calls (keeps the graph readable, avoids a dense mesh). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastSymbolNode } from "@devdigest/shared";
import { s } from "./styles";

const NODE_W = 168;
const NODE_H = 30;
const ROW_GAP = 14;
const COL_GAP = 64;
const PAD = 16;

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
}

export function BlastGraph({ symbols }: { symbols: BlastSymbolNode[] }) {
  const t = useTranslations("blast");

  const totalCallers = symbols.reduce((n, sym) => n + sym.callers.length, 0);
  const totalFacts = symbols.reduce((n, sym) => n + sym.endpoints.length + sym.crons.length, 0);

  if (totalCallers === 0 && totalFacts === 0) {
    return <div style={s.graphEmpty}>{t("graph.empty")}</div>;
  }

  // Column 1 — changed symbols.
  const symbolIds = symbols.map((sym) => `sym:${sym.name}`);

  // Column 2 — caller files, deduped, tracking which symbols call through them.
  const callerFileOwners = new Map<string, Set<string>>();
  for (const sym of symbols) {
    for (const caller of sym.callers) {
      const owners = callerFileOwners.get(caller.file) ?? new Set<string>();
      owners.add(sym.name);
      callerFileOwners.set(caller.file, owners);
    }
  }
  const callerFiles = [...callerFileOwners.keys()];

  // Column 3 — downstream endpoint/cron labels, deduped, tracking owning symbols.
  const factOwners = new Map<string, { kind: "endpoint" | "cron"; owners: Set<string> }>();
  for (const sym of symbols) {
    for (const fact of sym.endpoints) {
      const entry = factOwners.get(fact.label) ?? { kind: "endpoint" as const, owners: new Set<string>() };
      entry.owners.add(sym.name);
      factOwners.set(fact.label, entry);
    }
    for (const fact of sym.crons) {
      const entry = factOwners.get(fact.label) ?? { kind: "cron" as const, owners: new Set<string>() };
      entry.owners.add(sym.name);
      factOwners.set(fact.label, entry);
    }
  }
  const facts = [...factOwners.entries()];

  const rows = Math.max(symbolIds.length, callerFiles.length, facts.length, 1);
  const colWidth = NODE_W;
  const width = PAD * 2 + colWidth * 3 + COL_GAP * 2;
  const height = PAD * 2 + rows * (NODE_H + ROW_GAP) - ROW_GAP;

  const col1X = PAD;
  const col2X = PAD + colWidth + COL_GAP;
  const col3X = PAD + (colWidth + COL_GAP) * 2;

  const nodeY = (i: number) => PAD + i * (NODE_H + ROW_GAP);

  const symbolNodes: GraphNode[] = symbols.map((sym, i) => ({
    id: `sym:${sym.name}`,
    label: sym.name,
    x: col1X,
    y: nodeY(i),
  }));
  const callerNodes: GraphNode[] = callerFiles.map((file, i) => ({
    id: `caller:${file}`,
    label: file,
    x: col2X,
    y: nodeY(i),
  }));
  const factNodes: GraphNode[] = facts.map(([label], i) => ({
    id: `fact:${label}`,
    label,
    x: col3X,
    y: nodeY(i),
  }));

  const byId = new Map<string, GraphNode>();
  for (const n of [...symbolNodes, ...callerNodes, ...factNodes]) byId.set(n.id, n);

  // symbol -> caller-file edges.
  const edges: { from: GraphNode; to: GraphNode }[] = [];
  for (const sym of symbols) {
    const from = byId.get(`sym:${sym.name}`);
    if (!from) continue;
    for (const caller of sym.callers) {
      const to = byId.get(`caller:${caller.file}`);
      if (to) edges.push({ from, to });
    }
  }
  // caller-file -> fact edges, only when the fact's owning symbol also calls through this file.
  for (const [file, owners] of callerFileOwners) {
    const from = byId.get(`caller:${file}`);
    if (!from) continue;
    for (const [label, { owners: factSymbols }] of factOwners) {
      const shared = [...owners].some((o) => factSymbols.has(o));
      if (!shared) continue;
      const to = byId.get(`fact:${label}`);
      if (to) edges.push({ from, to });
    }
  }

  const edgePath = (from: GraphNode, to: GraphNode) => {
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };

  const renderNode = (n: GraphNode, fill: string, stroke: string) => (
    <g key={n.id}>
      <rect
        x={n.x}
        y={n.y}
        width={NODE_W}
        height={NODE_H}
        rx={6}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
      />
      <text
        x={n.x + 8}
        y={n.y + NODE_H / 2 + 4}
        fontSize={11}
        fill="var(--text-primary)"
        className="mono"
      >
        {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
      </text>
    </g>
  );

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={t("graph.ariaLabel")}
      style={{ display: "block", maxWidth: "100%" }}
    >
      {edges.map((e, i) => (
        <path
          key={i}
          d={edgePath(e.from, e.to)}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth={1.25}
        />
      ))}
      {symbolNodes.map((n) => renderNode(n, "var(--accent-bg)", "var(--accent)"))}
      {callerNodes.map((n) => renderNode(n, "var(--bg-elevated)", "var(--border)"))}
      {factNodes.map((n) => renderNode(n, "var(--ok-bg)", "var(--ok)"))}
    </svg>
  );
}
