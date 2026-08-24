/**
 * service.ts — BlastService: orchestrates the "what else could this diff
 * touch?" view for a PR.
 *
 * Onion layer: application — orchestrates repo-intel index state + the
 * blast repository's direct DB reads; no SQL here.
 *
 * Deliberately does NOT trust `RepoIntelService.getBlastRadius()`'s `.callers`
 * (repo-intel's global-slice + same-file-caller bugs — see repository.ts and
 * helpers.ts headers). Only `.changedSymbols` is reused from that call; every
 * caller/fact/prior-PR read goes through `BlastRepository` directly.
 *
 * Degrades gracefully: the ONLY throw in `forPull` is a missing PR/repo.
 * Everything downstream (no index, partial index, no symbols) resolves into
 * a valid `BlastRadiusView` with an explanatory `reason`.
 */
import type {
  BlastCallerView,
  BlastPriorPr,
  BlastRadiusView,
  BlastReason,
  BlastState,
  BlastSymbolNode,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { IndexState } from '../repo-intel/types.js';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import type { Logger } from '../reviews/run-executor.js';
import { BlastRepository } from './repository.js';
import { attributeFacts, groupAndCapCallers } from './helpers.js';
import { MAX_CALLERS_PER_SYMBOL, MAX_DEPTH, MAX_FACTS_PER_SYMBOL, MAX_PRIOR_PRS } from './constants.js';

interface StateInfo {
  state: BlastState;
  reason: BlastReason;
  indexedSha: string | null;
}

/**
 * Precedence table (exported for direct unit testing of the mapping alone).
 * `getIndexState` NEVER throws and always returns a valid `IndexState` — the
 * synthesized no-row fallback has `status: 'degraded'`, which correctly falls
 * into the last branch.
 */
export function mapIndexState(repoIntelEnabled: boolean, indexState: IndexState): StateInfo {
  if (!repoIntelEnabled) {
    return { state: 'degraded', reason: 'flag_off', indexedSha: null };
  }
  if (indexState.status === 'full') {
    return { state: 'full', reason: 'ok', indexedSha: indexState.lastIndexedSha };
  }
  if (indexState.status === 'partial') {
    return { state: 'partial', reason: 'index_partial', indexedSha: indexState.lastIndexedSha };
  }
  if (indexState.status === 'failed') {
    return { state: 'degraded', reason: 'index_failed', indexedSha: null };
  }
  // status === 'degraded' (incl. the synthesized no-data fallback)
  return { state: 'degraded', reason: 'not_indexed', indexedSha: null };
}

function explanationFor(reason: BlastReason, indexState: IndexState): string {
  switch (reason) {
    case 'flag_off':
      return 'Code indexing is disabled for this workspace.';
    case 'not_indexed':
      return 'This repository has not been indexed yet — blast radius is unavailable.';
    case 'index_partial':
      return `Index is partial: ${indexState.filesIndexed} of ${indexState.filesIndexed + indexState.filesSkipped} files indexed — downstream callers may be missing.`;
    case 'index_failed':
      return 'The last index attempt failed — blast radius is unavailable.';
    case 'no_symbols':
      return "No indexed symbols are declared in this PR's changed files.";
    case 'ok':
    case 'no_clone':
      return '';
    default:
      return '';
  }
}

export class BlastService {
  private repo: ReviewRepository;
  private blastRepo: BlastRepository;

  constructor(private container: Container, private logger?: Logger) {
    this.repo = new ReviewRepository(container.db);
    this.blastRepo = new BlastRepository(container.db);
  }

  async forPull(workspaceId: string, prId: string): Promise<BlastRadiusView> {
    // 1. PR lookup — the only throw in this method.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // 2. Repo lookup.
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');

    // 3. Changed files.
    const prFiles = await this.repo.getPrFiles(pull.id);
    const changedFiles = prFiles.map((f) => f.path);

    // 4. Index state → {state, reason, indexedSha}.
    const indexState = await this.container.repoIntel.getIndexState(repoRow.id);
    let { state, reason, indexedSha } = mapIndexState(this.container.config.repoIntelEnabled, indexState);

    // 5. Changed symbols (reuse repoIntel's deduped/qualified-name-stripped list only).
    let changedSymbols: { name: string; file: string; kind: string }[] = [];
    if (changedFiles.length > 0) {
      const blast = await this.container.repoIntel.getBlastRadius(repoRow.id, changedFiles);
      changedSymbols = blast.changedSymbols.map((s) => ({ name: s.name, file: s.file, kind: s.kind }));
      if (changedSymbols.length === 0) {
        reason = 'no_symbols';
      }
    } else {
      reason = 'no_symbols';
    }

    // 6. Callers + facts per symbol (only when there's something to enrich).
    const { nodes: symbols, allEndpointLabels, allCronLabels } = await this.buildSymbolNodes(
      repoRow.id,
      changedSymbols,
      state,
    );

    // 7. Prior PRs touching the same files.
    const priorRows = await this.blastRepo.priorPrsTouching(
      workspaceId,
      repoRow.id,
      pull.id,
      changedFiles,
      MAX_PRIOR_PRS,
    );
    const prior_prs: BlastPriorPr[] = priorRows.map((r) => ({
      number: r.number,
      title: r.title,
      author: r.author,
      status: r.status,
      updated_at: r.updatedAt?.toISOString() ?? null,
      files_overlap: r.overlapFiles,
    }));

    // 8. Explanation.
    const explanation = explanationFor(reason, indexState);

    // 9. Counts — TRUE totals, not sums of the already-capped display arrays.
    // `callers`/`endpoints`/`crons` sum each symbol's *_total field (the
    // pre-cap count that helpers.ts's per-symbol caps hid from the display
    // arrays); endpoints/crons additionally union across symbols instead of
    // summing, since two symbols can share the same downstream endpoint (both
    // seed their BFS from the same file, or from files on a shared import
    // path) — summing would double-count it.
    let callerCount = 0;
    for (const s of symbols) callerCount += s.caller_total;

    return {
      pr_id: pull.id,
      repo_full_name: repoRow.fullName,
      indexed_sha: indexedSha,
      head_sha: pull.headSha,
      state,
      reason,
      explanation,
      symbols,
      counts: {
        symbols: symbols.length,
        callers: callerCount,
        endpoints: allEndpointLabels.size,
        crons: allCronLabels.size,
      },
      prior_prs,
    };
  }

  // ---- private orchestration -------------------------------------------

  private async buildSymbolNodes(
    repoId: string,
    changedSymbols: { name: string; file: string; kind: string }[],
    state: BlastState,
  ): Promise<{ nodes: BlastSymbolNode[]; allEndpointLabels: Set<string>; allCronLabels: Set<string> }> {
    if (changedSymbols.length === 0) {
      return { nodes: [], allEndpointLabels: new Set(), allCronLabels: new Set() };
    }

    // Degraded index: symbols still appear (from repoIntel's changedSymbols
    // list), but with no enrichment — never trust caller/fact reads against
    // an index that isn't usable.
    if (state === 'degraded') {
      const nodes = changedSymbols.map((s) => ({
        name: s.name,
        file: s.file,
        kind: s.kind,
        callers: [],
        caller_total: 0,
        callers_truncated: false,
        endpoints: [],
        crons: [],
        endpoint_total: 0,
        cron_total: 0,
        facts_truncated: false,
      }));
      return { nodes, allEndpointLabels: new Set(), allCronLabels: new Set() };
    }

    const declFiles = [...new Set(changedSymbols.map((s) => s.file))];
    const names = [...new Set(changedSymbols.map((s) => s.name))];

    const callerRows = await this.blastRepo.callersForSymbols(repoId, declFiles, names);
    const callerFiles = [...new Set(callerRows.map((r) => r.fromPath))];
    const callerSymbolRows = await this.blastRepo.symbolsInFiles(repoId, callerFiles);
    const symbolsByFile = new Map<string, typeof callerSymbolRows>();
    for (const row of callerSymbolRows) {
      const arr = symbolsByFile.get(row.path);
      if (arr) arr.push(row);
      else symbolsByFile.set(row.path, [row]);
    }

    const grouped = groupAndCapCallers(callerRows, symbolsByFile, MAX_CALLERS_PER_SYMBOL);

    const importersOf = (files: string[]) => this.blastRepo.importersOf(repoId, files);
    const factsFor = (files: string[]) => this.blastRepo.factsFor(repoId, files);

    const nodes: BlastSymbolNode[] = [];
    const allEndpointLabels = new Set<string>();
    const allCronLabels = new Set<string>();
    for (const s of changedSymbols) {
      const key = `${s.file}::${s.name}`;
      const group = grouped.get(key);
      const callers: BlastCallerView[] = group?.callers ?? [];
      const caller_total = group?.callerTotal ?? 0;
      const callers_truncated = group?.truncated ?? false;

      const facts = await attributeFacts(s.file, MAX_DEPTH, MAX_FACTS_PER_SYMBOL, importersOf, factsFor);
      for (const label of facts.allEndpointLabels) allEndpointLabels.add(label);
      for (const label of facts.allCronLabels) allCronLabels.add(label);

      nodes.push({
        name: s.name,
        file: s.file,
        kind: s.kind,
        callers,
        caller_total,
        callers_truncated,
        endpoints: facts.endpoints,
        crons: facts.crons,
        endpoint_total: facts.endpointTotal,
        cron_total: facts.cronTotal,
        facts_truncated: facts.truncated,
      });
    }
    return { nodes, allEndpointLabels, allCronLabels };
  }
}
