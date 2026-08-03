import { resolve, sep } from 'node:path';
import { z } from 'zod';
import type { RepoRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { RepoRepository, type RepoRow } from '../repos/repository.js';
import { getFeatureModelOverride } from '../settings/feature-models.js';
import { ConventionsRepository, type InsertConvention } from './repository.js';
import { collectSamples, renderSamples, type SampleFile } from './samples.js';
import {
  consistencyScore,
  isSafeRepoPath,
  verifyEvidence,
  type RawCandidate,
  type VerifyResult,
} from './verify.js';
import {
  buildSkillBody,
  defaultSkillDescription,
  defaultSkillName,
  toConventionDto,
  type ConventionDto,
} from './helpers.js';
import { DEFAULT_MODEL, MAX_CANDIDATES, MAX_FALLBACK_READS } from './constants.js';

/**
 * Conventions extractor.
 *
 * Pipeline: pick samples in CODE (configs + top-ranked files) → ONE cheap model
 * call → prove every cited snippet against the files on disk → persist the
 * survivors, replacing the previous scan.
 *
 * The model never chooses which files to read, and never gets the last word on
 * where its evidence lives.
 */

// ---- Model output schema ---------------------------------------------------
// Mirrors the style of the `Review` contract (min/max/describe survive
// `zodResponseFormat`). `schemaName` matches the fixture key MockLLMProvider
// already documents (`adapters/mocks.ts`), so tests can stub it by name.

const ExtractedConvention = z.object({
  category: z
    .string()
    .describe('Short bucket, e.g. "naming", "error-handling", "structure", "testing", "imports".'),
  rule: z
    .string()
    .describe(
      'One imperative sentence stating the house rule, e.g. "Always use async/await instead of .then() chains".',
    ),
  evidence_path: z
    .string()
    .describe('Repo-relative path of a SAMPLED file that demonstrates the rule. Never invent one.'),
  evidence_start_line: z.number().int().describe('First line of the evidence, from the shown numbers.'),
  evidence_end_line: z.number().int().describe('Last line of the evidence.'),
  evidence_snippet: z
    .string()
    .describe('The exact lines copied VERBATIM from that file. Must appear in the file character-for-character.'),
  // Evidence BEFORE the score. JSON is generated autoregressively, so a model
  // that has just written `counterexamples_seen: 3` is far less likely to then
  // write `confidence: 1.0`. Scoring last, after an assertive rule + verbatim
  // proof, is what collapsed every score to 1.0.
  occurrences_seen: z
    .number()
    .int()
    .describe('How many DISTINCT sampled files you saw FOLLOWING this rule.'),
  counterexamples_seen: z
    .number()
    .int()
    .describe(
      'How many sampled files you saw doing this a DIFFERENT way. Look for one before answering; report 0 only if you actually checked and found none.',
    ),
  enforced_by_config: z
    .boolean()
    .describe('True ONLY if a sampled eslint/tsconfig/prettier config mechanically enforces this.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'CONSISTENCY: how uniformly the repo follows this rule — NOT how sure you are. Score it against the rubric in the system prompt.',
    ),
});

export const ConventionExtraction = z.object({
  conventions: z.array(ExtractedConvention),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

const SYSTEM_PROMPT = `You infer a codebase's HOUSE CONVENTIONS from sample files.

Rules:
- Every convention MUST cite one sampled file and copy the proving lines VERBATIM.
- Do not invent file paths. Only cite paths shown in the samples.
- Prefer project-specific rules ("Redis access goes through src/lib/redis.ts") over
  generic advice ("write tests", "use meaningful names").
- INCLUDE rules the repo follows INCONSISTENTLY. Score them low rather than omitting
  them — a convention the codebase only half-keeps is the most useful thing to surface.
- Return at most ${MAX_CANDIDATES} conventions.

Before scoring each rule, actively look for a sampled file that does it a DIFFERENT
way. Report counterexamples_seen: 0 only if you actually looked and found none.

Score CONSISTENCY — how uniformly the repo follows the rule — NOT how sure you are:
  1.0         mechanically enforced by a sampled config file (enforced_by_config: true)
  0.85-0.95   many occurrences, zero counterexamples
  0.60-0.84   clear majority, but real counterexamples exist
  0.40-0.59   mixed practice, or only two or three occurrences
  below 0.40  a single occurrence — still report it, scored low

An observed-only pattern MUST NOT score above 0.95; 1.0 is for config-enforced rules only.
Do NOT give every rule the same score. A result where everything scores above 0.9 is
wrong — spread the scores according to what the samples actually show.`;

// ---- Results ---------------------------------------------------------------

export interface ConventionListResult {
  candidates: ConventionDto[];
  /** Files actually read and sent to the model (configs + top-N code). */
  sampled_files: number;
  /** Ranked files those were selected FROM — what the UI subtitle shows. */
  considered_files: number;
  scanned_at: string | null;
  /** Revision the evidence lines refer to; deep links pin to it. Null when unresolvable. */
  scanned_sha: string | null;
}

export interface ExtractResult extends ConventionListResult {
  dropped: number;
  dropped_reasons: Record<string, number>;
  cost_usd: number | null;
}

export interface SkillDraft {
  name: string;
  description: string;
  type: 'convention';
  body: string;
  accepted_count: number;
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private repos: RepoRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.repos = new RepoRepository(container.db);
  }

  private async requireRepo(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionListResult> {
    await this.requireRepo(workspaceId, repoId);
    const rows = await this.repo.listForRepo(workspaceId, repoId);
    return {
      candidates: rows.map(toConventionDto),
      sampled_files: rows[0]?.sampledFiles ?? 0,
      considered_files: rows[0]?.consideredFiles ?? 0,
      scanned_at: rows[0]?.createdAt?.toISOString() ?? null,
      scanned_sha: rows[0]?.scannedSha ?? null,
    };
  }

  async setAccepted(
    workspaceId: string,
    id: string,
    accepted: boolean,
  ): Promise<ConventionDto | undefined> {
    const row = await this.repo.setAccepted(workspaceId, id, accepted);
    return row ? toConventionDto(row) : undefined;
  }

  async reject(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Prefill for the Create-skill modal. Everything here is editable client-side. */
  async skillDraft(workspaceId: string, repoId: string): Promise<SkillDraft> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const accepted = (await this.repo.listForRepo(workspaceId, repoId))
      .filter((r) => r.accepted)
      .map(toConventionDto);
    if (accepted.length === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill.');
    }
    return {
      name: defaultSkillName(repo.name),
      description: defaultSkillDescription(repo.name, accepted.length),
      type: 'convention',
      body: buildSkillBody(repo.name, accepted),
      accepted_count: accepted.length,
    };
  }

  async extract(workspaceId: string, repoId: string): Promise<ExtractResult> {
    const repo = await this.requireRepo(workspaceId, repoId);
    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    const samples = await collectSamples(this.container, repoId, ref);
    if (samples.length === 0) {
      throw new ValidationError(
        'Nothing to scan — no readable config or source files were found for this repo. Re-sync it so it gets indexed, then try again.',
      );
    }

    const choice =
      (await getFeatureModelOverride(this.container, workspaceId, 'conventions')) ?? DEFAULT_MODEL;
    const llm = await this.container.llm(choice.provider);

    const res = await llm.completeStructured<ConventionExtraction>({
      model: choice.model,
      schema: ConventionExtraction,
      schemaName: 'ConventionExtraction',
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Repository: ${repo.fullName}\n\nSampled files:\n\n${renderSamples(samples)}`,
        },
      ],
    });

    const verified = await this.groundCandidates(ref, repo.clonePath, res.data.conventions, samples);

    // The pool the top-N was drawn from. Degrades to 0 when the repo is
    // unindexed or the flag is off — fall back to what we actually read so the
    // subtitle never claims "0 sample files" beside real candidates.
    const ranked = await this.container.repoIntel.countRankedFiles(repoId);
    const consideredFiles = ranked > 0 ? ranked : samples.length;

    // The revision the evidence line numbers refer to, so deep links pin to the
    // exact code that was cited. Best-effort: a repo we can't resolve a HEAD for
    // simply gets no links — it must never fail an otherwise-good scan.
    const scannedSha = await this.container.git.currentHead(ref).catch(() => null);

    const rows: InsertConvention[] = verified.kept.slice(0, MAX_CANDIDATES).map((c) => ({
      workspaceId,
      repoId,
      rule: c.rule.trim(),
      category: c.category?.trim() || null,
      evidencePath: c.evidence_path,
      evidenceSnippet: c.evidence_snippet,
      evidenceStartLine: c.evidence_start_line,
      evidenceEndLine: c.evidence_end_line,
      confidence: c.confidence,
      followingFiles: c.occurrences_seen,
      applicableFiles: c.occurrences_seen + c.counterexamples_seen,
      sampledFiles: samples.length,
      consideredFiles,
      scannedSha,
    }));

    const saved = await this.repo.replaceForRepo(workspaceId, repoId, rows);

    const droppedReasons: Record<string, number> = {};
    for (const d of verified.dropped) {
      droppedReasons[d.reason] = (droppedReasons[d.reason] ?? 0) + 1;
    }

    return {
      candidates: saved.map(toConventionDto),
      sampled_files: samples.length,
      considered_files: consideredFiles,
      scanned_at: saved[0]?.createdAt?.toISOString() ?? new Date().toISOString(),
      scanned_sha: scannedSha,
      dropped: verified.dropped.length,
      dropped_reasons: droppedReasons,
      cost_usd: res.costUsd,
    };
  }

  /**
   * Build the file map `verifyEvidence` grounds against, then run the gate.
   *
   * Sampled files are already in memory. A candidate may legitimately cite a
   * file we never sampled (it saw the import in one that we did), so unknown
   * paths get ONE bounded read each — but only after passing `isSafeRepoPath`
   * AND a `resolve()` containment check, because `git.readFile` itself does a
   * bare `join(clonePath, path)` with no guard.
   */
  private async groundCandidates(
    ref: RepoRef,
    clonePath: string | null,
    candidates: RawCandidate[],
    samples: SampleFile[],
  ): Promise<VerifyResult> {
    const files = new Map(samples.map((s) => [s.path, s.text]));

    const root = clonePath ?? this.container.git.clonePathFor(ref);
    const unknown: string[] = [];
    for (const c of candidates) {
      const p = c.evidence_path;
      if (files.has(p) || unknown.includes(p)) continue;
      if (!isSafeRepoPath(p)) continue; // verify() will drop it as unsafe_path
      if (!resolve(root, p).startsWith(root.endsWith(sep) ? root : root + sep)) continue;
      unknown.push(p);
      if (unknown.length >= MAX_FALLBACK_READS) break;
    }

    await Promise.all(
      unknown.map(async (p) => {
        try {
          const text = await this.container.git.readFile(ref, p);
          // An empty read grounds nothing, and not every GitClient signals a
          // missing file by throwing — treat "no content" as "not resolvable"
          // so the drop reason stays honest (file_not_found, not snippet_not_found).
          if (text.trim().length > 0) files.set(p, text);
        } catch {
          /* ENOENT is the existence test — leave it out and verify() drops it */
        }
      }),
    );

    // Reconcile the score with the evidence counts BEFORE grounding, so the
    // MIN_CONFIDENCE gate filters on the reconciled value, not the claimed one.
    return verifyEvidence(
      candidates.map((c) => ({ ...c, confidence: consistencyScore(c) })),
      files,
    );
  }
}
