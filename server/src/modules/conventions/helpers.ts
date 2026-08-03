import type { ConventionRow } from '../../db/rows.js';

/**
 * Pure row⇄DTO mapping and skill-body assembly. No I/O.
 *
 * DB rows are camelCase, DTOs are snake_case (the codebase-wide convention).
 */

export interface ConventionDto {
  id: string;
  rule: string;
  category: string | null;
  evidence_path: string;
  evidence_snippet: string;
  evidence_start_line: number | null;
  evidence_end_line: number | null;
  /** Consistency 0..1 — how uniformly the repo follows the rule. */
  confidence: number;
  /** The evidence behind the score: followed in N of M files where it applied. */
  following_files: number | null;
  applicable_files: number | null;
  accepted: boolean;
}

export function toConventionDto(row: ConventionRow): ConventionDto {
  return {
    id: row.id,
    rule: row.rule,
    category: row.category,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    evidence_start_line: row.evidenceStartLine,
    evidence_end_line: row.evidenceEndLine,
    confidence: row.confidence ?? 0,
    following_files: row.followingFiles,
    applicable_files: row.applicableFiles,
    accepted: row.accepted,
  };
}

/** `Always use async/await instead of .then() chains` → `always-use-async-await-instead-of-then-chains` */
export function slugify(text: string): string {
  const full = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (full.length <= 60) return full || 'rule';
  // Trim at a word boundary — a slug cut mid-word ("…-class-with-sta") reads as
  // a bug in the generated skill.
  const cut = full.slice(0, 60);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 20 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '') || 'rule';
}

/** `src/api/users.ts:23-31`, collapsing to `:23` when the span is one line. */
export function evidenceRef(path: string, start: number | null, end: number | null): string {
  if (start === null) return path;
  if (end === null || end === start) return `${path}:${start}`;
  return `${path}:${start}-${end}`;
}

const FENCE_LANG: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  py: 'python',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  java: 'java',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
};

function fenceLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return FENCE_LANG[ext] ?? '';
}

export function defaultSkillName(repoName: string): string {
  return `${slugify(repoName)}-conventions`;
}

export function defaultSkillDescription(repoName: string, count: number): string {
  return `${count} house convention${count === 1 ? '' : 's'} extracted from ${repoName}`;
}

/**
 * Merge accepted candidates into one markdown skill body. Every rule carries its
 * own evidence (`Detected in path:start-end` + the snippet), which is what makes
 * the skill self-contained once it reaches a review prompt — `evidence_files` on
 * the skill row is not needed for that.
 */
export function buildSkillBody(repoName: string, candidates: ConventionDto[]): string {
  const name = defaultSkillName(repoName);
  const parts: string[] = [
    `# ${name}`,
    '',
    `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`,
  ];

  for (const c of candidates) {
    const rule = c.rule.trim();
    parts.push(
      '',
      `## ${slugify(rule)}`,
      rule.endsWith('.') ? rule : `${rule}.`,
      '',
      `Detected in \`${evidenceRef(c.evidence_path, c.evidence_start_line, c.evidence_end_line)}\`:`,
      '',
      `\`\`\`${fenceLang(c.evidence_path)}`,
      c.evidence_snippet.trim(),
      '```',
    );
  }

  return `${parts.join('\n')}\n`;
}
