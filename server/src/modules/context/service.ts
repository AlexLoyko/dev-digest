/**
 * service.ts — Project Context module: application-layer orchestration.
 *
 * Owns these flows:
 *  - `list`                — read the persisted document set + scan status for a repo.
 *  - `rescan`               — walk the clone (T8's scanner), persist the result (T9's
 *                             repository), and record scan status/timing.
 *  - `readDocument`         — validate a document path is safe + contained (T3's
 *                             path-guard) before reading its text off disk.
 *  - `get/setAgentContext`  — an agent's directly-attached documents plus the
 *                             effective (agent + inherited-via-skill, deduped,
 *                             ordered) set that will actually be injected into a
 *                             run's prompt (T4's `buildEffectiveSet`).
 *  - `get/setSkillContext`  — a skill's own attached documents.
 *  - `previewSkillContext`  — the verbatim `## Project context` block a skill's
 *                             attached documents would produce, with zero LLM calls.
 *
 * AC-15 (hard constraint): this file never reaches for an `LLMProvider` or
 * `container.llm(...)`. Every branch below is pure orchestration of the
 * scanner, repository, and git adapter — no model call anywhere on this path.
 *
 * Onion layer: application. No `container.db.select()` here — all SQL lives
 * in `ContextRepository` (T9) or `RepoRepository` (repos module), both reached
 * through `container.contextRepo` / `container.reposRepo` — the composition
 * root, never a repository constructed inline here.
 */
import type { Container } from '../../platform/container.js';
import type {
  ContextAttachment,
  ContextListResponse,
  ContextPreview,
  EffectiveContextDoc,
  IndexStatus,
  SpecFile,
} from '@devdigest/shared';
import { NotFoundError, AppError } from '../../platform/errors.js';
import type { RepoRow } from '../repos/repository.js';
import type { ContextScan } from './repository.js';
import { scanClone } from './scanner.js';
import { buildEffectiveSet } from './ordering.js';
import { isSafeContextPath, resolveContained } from './path-guard.js';
import { CONTEXT_ROOT_DIRS, isContextRootDir, type ContextRoot } from './constants.js';
import { buildProjectContextSection } from '../../platform/prompt.js';

/** EC-1: repo has no local clone yet. Only `idle`/`parsing`/`done`/`error` are
 * ever used (see gotcha in the dispatch note) — "not cloned" is carried in
 * `message`, not a dedicated enum value. */
const NOT_CLONED_INDEX: IndexStatus = {
  status: 'idle',
  pct: 0,
  message: 'not_cloned',
  chunks_indexed: null,
};

export class ContextService {
  constructor(private readonly container: Container) {}

  /** AC-1 / EC-1 / EC-2: list persisted context documents + current scan status. */
  async list(workspaceId: string, repoId: string): Promise<ContextListResponse> {
    const repo = await this.getRepoOrThrow(workspaceId, repoId);

    if (!repo.clonePath) {
      return { documents: [], index: NOT_CLONED_INDEX, commit_sha: null, scanned_at: null };
    }

    const [documents, scan, usageCounts] = await Promise.all([
      this.container.contextRepo.listDocuments(repoId),
      this.container.contextRepo.getScan(repoId),
      this.container.contextRepo.usedByAgentCounts(workspaceId),
    ]);

    const specFiles: SpecFile[] = documents.map((doc) => ({
      path: doc.path,
      content: null,
      size: doc.sizeBytes,
      updated_at: doc.scannedAt.toISOString(),
      root: doc.root,
      tokens: doc.tokens,
      tokens_approximate: doc.tokensApproximate,
      threat_level: doc.threatLevel,
      used_by_agents: usageCounts.get(doc.path) ?? 0,
      excluded_reason: doc.excludedReason,
    }));

    return {
      documents: specFiles,
      index: scanToIndexStatus(scan),
      commit_sha: scan?.commitSha ?? null,
      scanned_at: scan?.scannedAt ? scan.scannedAt.toISOString() : null,
    };
  }

  /** AC-3: walk the clone, persist the fresh document set, record scan status/timing. */
  async rescan(workspaceId: string, repoId: string): Promise<IndexStatus> {
    const repo = await this.getRepoOrThrow(workspaceId, repoId);

    if (!repo.clonePath) {
      // Nothing to scan — same not-cloned early-return every other
      // clone-dependent path in this codebase uses (see dispatch gotcha).
      return NOT_CLONED_INDEX;
    }

    await this.container.contextRepo.upsertScan(repoId, { status: 'parsing' });

    const start = Date.now();
    try {
      const { documents, stats } = await scanClone(repo.clonePath, this.container.tokenizer);
      await this.container.contextRepo.replaceDocuments(repoId, documents);

      const commitSha = await this.container.git.currentHead({
        owner: repo.owner,
        name: repo.name,
      });
      const durationMs = Date.now() - start;
      const message = buildScanMessage(documents.length, stats.skippedTooLarge);

      const scan = await this.container.contextRepo.upsertScan(repoId, {
        status: 'done',
        fileCount: documents.length,
        commitSha,
        durationMs,
        message,
        scannedAt: new Date(),
      });
      return scanToIndexStatus(scan);
    } catch (err) {
      const scan = await this.container.contextRepo.upsertScan(repoId, {
        status: 'error',
        message: err instanceof Error ? err.message : 'Scan failed',
      });
      return scanToIndexStatus(scan);
    }
  }

  /** Read one document's text. 404 when missing/unresolvable, 400 when the
   * path itself is rejected before ever touching the filesystem. */
  async readDocument(workspaceId: string, repoId: string, relPath: string): Promise<SpecFile> {
    const repo = await this.getRepoOrThrow(workspaceId, repoId);
    if (!repo.clonePath) throw new NotFoundError('Repository has no local clone');

    if (!isSafeContextPath(relPath)) {
      throw new AppError(
        'invalid_context_path',
        'Path is not a valid context document reference',
        400,
      );
    }

    const resolved = await resolveContained(repo.clonePath, relPath);
    if (resolved === null) {
      // Covers both "doesn't exist" and "resolves outside the clone root"
      // (e.g. a planted symlink) — both are reported as 404, never leaking
      // which case applies (see path-guard.ts's containment rationale).
      throw new NotFoundError('Context document not found');
    }

    const documents = await this.container.contextRepo.listDocuments(repoId);
    const record = documents.find((d) => d.path === relPath);
    const root = record?.root ?? deriveRoot(relPath);
    if (!root) {
      // Safe, on-disk, contained .md file — but not under any context root,
      // so it is not a context document.
      throw new NotFoundError('Context document not found');
    }

    const content = await this.container.git.readFile(
      { owner: repo.owner, name: repo.name },
      relPath,
    );

    return {
      path: relPath,
      content,
      size: record?.sizeBytes ?? content.length,
      updated_at: record?.scannedAt ? record.scannedAt.toISOString() : null,
      root,
      tokens: record?.tokens ?? null,
      tokens_approximate: record?.tokensApproximate ?? null,
      threat_level: record?.threatLevel ?? null,
      excluded_reason: record?.excludedReason ?? null,
    };
  }

  private async getRepoOrThrow(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.container.reposRepo.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }

  // ------------------------------------------------------------------------
  // Attachment surface (AC-5..AC-9, AC-16). Agents and skills are workspace-
  // scoped, not repo-scoped (see db/schema/agents.ts, db/schema/skills.ts) —
  // there is no `:repoId` in these routes. We resolve "the" repo whose clone
  // backs path validation / hydration / preview-reading the same way the rest
  // of the codebase treats a workspace's primary repo (see the seed.ts /
  // repos.list() "home redirect to the first repo" convention in
  // INSIGHTS.md): the first repo with a clone, falling back to the first repo
  // if none is cloned yet.
  // ------------------------------------------------------------------------

  /** AC-5: an agent's own attachments + the deduped effective set (agent docs
   * first, then skill-inherited docs) with tokens/missing hydrated from the
   * persisted document list (EC-7). */
  async getAgentContext(workspaceId: string, agentId: string): Promise<ContextGetResult> {
    await this.getAgentOrThrow(workspaceId, agentId);

    const [agentDocs, skillDocs] = await Promise.all([
      this.container.contextRepo.agentAttachments(agentId),
      this.container.contextRepo.skillAttachmentsForAgent(agentId),
    ]);

    const effectiveRaw = buildEffectiveSet({ agentDocs, skillDocs });
    const { effective, tokensTotal } = await this.hydrateEffective(workspaceId, effectiveRaw);

    return { attached: agentDocs, effective, tokens_total: tokensTotal };
  }

  /** AC-5 / AC-6 / AC-16: validate EVERY path before persisting ANY — a single
   * rejected path fails the whole request with 400 and nothing is written.
   * Positions are the array index, assigned by the repository, never
   * client-supplied (SetContextBody carries only `paths`). */
  async setAgentContext(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<ContextGetResult> {
    await this.getAgentOrThrow(workspaceId, agentId);
    await this.validateContextPaths(workspaceId, paths);
    await this.container.contextRepo.setAgentAttachments(agentId, paths);
    return this.getAgentContext(workspaceId, agentId);
  }

  /** AC-7: a skill's own attached documents, hydrated the same way as an
   * agent's — a skill has no inheritance of its own, so `effective` here is
   * just `attached` with tokens/missing filled in. */
  async getSkillContext(workspaceId: string, skillId: string): Promise<ContextGetResult> {
    await this.getSkillOrThrow(workspaceId, skillId);

    const skillDocs = await this.container.contextRepo.skillAttachments(skillId);
    const effectiveRaw: EffectiveContextDoc[] = skillDocs.map((doc) => ({
      path: doc.path,
      position: doc.position,
      source: 'skill',
      skill_id: skillId,
      tokens: 0,
      tokens_approximate: false,
      missing: false,
    }));
    const { effective, tokensTotal } = await this.hydrateEffective(workspaceId, effectiveRaw);

    return { attached: skillDocs, effective, tokens_total: tokensTotal };
  }

  /** AC-7 / AC-16: same validate-everything-before-persisting contract as
   * `setAgentContext`. */
  async setSkillContext(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<ContextGetResult> {
    await this.getSkillOrThrow(workspaceId, skillId);
    await this.validateContextPaths(workspaceId, paths);
    await this.container.contextRepo.setSkillAttachments(skillId, paths);
    return this.getSkillContext(workspaceId, skillId);
  }

  /** AC-9 / AC-15: the verbatim `## Project context` block a skill's attached
   * documents would produce in a run's prompt — zero LLM calls, just file
   * reads + `buildProjectContextSection` (T5, re-exported from
   * `platform/prompt.ts`). A document that has gone missing since attach time
   * is silently omitted (mirrors `buildProjectContextSection`'s own blank-text
   * filtering), never surfaced as an error here. EC-4: a document flagged
   * `excludedReason` by the scanner is skipped the same way — the preview
   * must show what a run would actually assemble, and a run never reads an
   * excluded document (see `run-executor.ts`'s `buildProjectContextSpecs`). */
  async previewSkillContext(workspaceId: string, skillId: string): Promise<ContextPreview> {
    await this.getSkillOrThrow(workspaceId, skillId);

    const attachments = await this.container.contextRepo.skillAttachments(skillId);
    const repo = await this.resolveRepoForWorkspace(workspaceId);

    const specs: Array<{ path: string; text: string }> = [];
    if (repo?.clonePath) {
      const documents = await this.container.contextRepo.listDocuments(repo.id);
      const excludedByPath = new Map(documents.map((d) => [d.path, d.excludedReason]));

      for (const doc of attachments) {
        if (excludedByPath.get(doc.path)) continue;
        try {
          const text = await this.container.git.readFile(
            { owner: repo.owner, name: repo.name },
            doc.path,
          );
          specs.push({ path: doc.path, text });
        } catch {
          // Missing/unreadable on disk since attach time — omit, don't fail
          // the whole preview.
        }
      }
    }

    const specsBlock = buildProjectContextSection(specs);
    return { text: specsBlock ? `## Project context\n${specsBlock}` : '' };
  }

  private async getAgentOrThrow(workspaceId: string, agentId: string): Promise<void> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
  }

  private async getSkillOrThrow(workspaceId: string, skillId: string): Promise<void> {
    const skill = await this.container.skillsRepo.getById(workspaceId, skillId);
    if (!skill) throw new NotFoundError('Skill not found');
  }

  /** First repo in the workspace with a clone, falling back to the first repo
   * overall (or `undefined` if the workspace has none). */
  private async resolveRepoForWorkspace(workspaceId: string): Promise<RepoRow | undefined> {
    const repos = await this.container.reposRepo.list(workspaceId);
    return repos.find((r) => r.clonePath) ?? repos[0];
  }

  /** AC-16 / EC-4: reject the WHOLE request with 400 — and persist nothing —
   * if any path fails any of three gates. `isSafeContextPath` catches
   * absolute paths and `..` traversal lexically; `resolveContained` (T3)
   * additionally resolves symlinks so a planted symlink that escapes the
   * clone root is rejected too. The third gate enforces EC-4: a document the
   * scanner flagged with a non-null `excludedReason` (oversize / unreadable)
   * is excluded "from the list and from injection" per the spec — it must
   * never be attachable in the first place. An empty `paths` array
   * (detaching everything) needs no clone to validate against. */
  private async validateContextPaths(workspaceId: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;

    const repo = await this.resolveRepoForWorkspace(workspaceId);
    if (!repo?.clonePath) {
      throw new AppError(
        'invalid_context_path',
        'Repository has no local clone to validate context paths against',
        400,
      );
    }

    const documents = await this.container.contextRepo.listDocuments(repo.id);
    const byPath = new Map(documents.map((d) => [d.path, d]));

    for (const path of paths) {
      if (!isSafeContextPath(path)) {
        throw new AppError(
          'invalid_context_path',
          `Path is not a valid context document reference: ${path}`,
          400,
        );
      }
      const resolved = await resolveContained(repo.clonePath, path);
      if (resolved === null) {
        throw new AppError(
          'invalid_context_path',
          `Path could not be resolved within the repository clone: ${path}`,
          400,
        );
      }
      const record = byPath.get(path);
      if (record?.excludedReason) {
        throw new AppError(
          'invalid_context_path',
          `Document is excluded and cannot be attached (${record.excludedReason}): ${path}`,
          400,
        );
      }
    }
  }

  /** Fill in `tokens` / `tokens_approximate` / `missing` (T4 left these as
   * placeholders) from the persisted document list for the workspace's repo,
   * and sum `tokens` over the deduped effective set for `tokens_total`
   * (EC-7). A path absent from the persisted list is `missing: true` with
   * `tokens: 0` — it does not contribute to the total. */
  private async hydrateEffective(
    workspaceId: string,
    docs: EffectiveContextDoc[],
  ): Promise<{ effective: EffectiveContextDoc[]; tokensTotal: number }> {
    const repo = await this.resolveRepoForWorkspace(workspaceId);
    const documents = repo ? await this.container.contextRepo.listDocuments(repo.id) : [];
    const byPath = new Map(documents.map((d) => [d.path, d]));

    let tokensTotal = 0;
    const effective = docs.map((doc) => {
      const record = byPath.get(doc.path);
      const tokens = record?.tokens ?? 0;
      tokensTotal += tokens;
      return {
        ...doc,
        tokens,
        tokens_approximate: record?.tokensApproximate ?? false,
        missing: !record,
      };
    });

    return { effective, tokensTotal };
  }
}

/** Response shape for `get/setAgentContext` and `get/setSkillContext` — built
 * from existing `@devdigest/shared` pieces (`ContextAttachment`,
 * `EffectiveContextDoc`); not a new shared contract. */
export interface ContextGetResult {
  attached: ContextAttachment[];
  effective: EffectiveContextDoc[];
  tokens_total: number;
}

function scanToIndexStatus(scan: ContextScan | undefined): IndexStatus {
  if (!scan) {
    return { status: 'idle', pct: 0, message: null, chunks_indexed: null };
  }
  const pct = scan.status === 'done' ? 100 : scan.status === 'parsing' ? 50 : 0;
  return { status: scan.status, pct, message: scan.message, chunks_indexed: null };
}

/** EC-2: even a zero-document scan names the roots that were scanned. */
function buildScanMessage(fileCount: number, skippedTooLarge: number): string {
  const roots = CONTEXT_ROOT_DIRS.join(', ');
  const suffix = skippedTooLarge > 0 ? `, ${skippedTooLarge} skipped (too large)` : '';
  return `Scanned ${roots} — found ${fileCount} document${fileCount === 1 ? '' : 's'}${suffix}`;
}

/** Derive a document's context root purely from its path (outermost matching
 * segment wins, mirroring scanner.ts's `activeRoot` propagation) — used only
 * as a fallback when a path is not (yet) in the persisted document set. */
function deriveRoot(relPath: string): ContextRoot | null {
  for (const segment of relPath.split('/').slice(0, -1)) {
    if (isContextRootDir(segment)) return segment;
  }
  return null;
}
