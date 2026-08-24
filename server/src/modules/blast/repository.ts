/**
 * blast repository — pure Drizzle reads over tables already owned by other
 * modules (`symbols`/`references` from context.ts, `file_edges`/`file_facts`
 * from repo-intel.ts, `pull_requests`/`pr_files` from pulls.ts).
 *
 * Deliberately reimplements the caller lookup instead of trusting
 * `RepoIntelRepository.getResolvedCallers` — that method never excludes
 * `from_path === decl_file` (same-file "callers"), and the service layer that
 * consumes it (`RepoIntelService.tryPersistentBlast`) slices callers to
 * MAX_CALLERS_PER_SYMBOL across a FLAT list spanning every changed symbol, not
 * per symbol. Both bugs live in `repo-intel/`, which this task must not touch,
 * so `callersForSymbols` below re-queries with the `fromPath <> declFile`
 * filter and returns `declFile` so the service can group + cap correctly.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface CallerRow {
  fromPath: string;
  toSymbol: string;
  declFile: string;
  line: number;
  rank: number;
}

export interface SymbolInFileRow {
  path: string;
  name: string;
  line: number | null;
  endLine: number | null;
}

export interface FileEdgeRow {
  fromFile: string;
  toFile: string;
}

export interface FileFactsRow {
  filePath: string;
  endpoints: string[];
  crons: string[];
}

export interface PriorPrRow {
  number: number;
  title: string;
  author: string;
  status: string;
  updatedAt: Date | null;
  overlapFiles: string[];
}

export class BlastRepository {
  constructor(private db: Db) {}

  /**
   * Cross-file callers of the given (declFile, name) symbol pairs. No LIMIT —
   * the service caps per symbol via `helpers.groupAndCapCallers`. Excludes
   * same-file "callers" (`from_path === decl_file`), unlike
   * `repo-intel/repository.ts`'s `getResolvedCallers`.
   */
  async callersForSymbols(
    repoId: string,
    declFiles: string[],
    names: string[],
  ): Promise<CallerRow[]> {
    if (declFiles.length === 0 || names.length === 0) return [];
    const rows = await this.db
      .select({
        fromPath: t.references.fromPath,
        toSymbol: t.references.toSymbol,
        declFile: t.references.declFile,
        line: t.references.line,
        rank: t.fileRank.rank,
      })
      .from(t.references)
      .innerJoin(
        t.fileRank,
        and(
          eq(t.fileRank.repoId, t.references.repoId),
          eq(t.fileRank.filePath, t.references.fromPath),
        ),
      )
      .where(
        and(
          eq(t.references.repoId, repoId),
          inArray(t.references.declFile, declFiles),
          inArray(t.references.toSymbol, names),
          ne(t.references.fromPath, t.references.declFile),
        ),
      );
    // declFile is guaranteed non-null here (inArray(declFiles) excludes NULL).
    return rows.map((r) => ({ ...r, declFile: r.declFile as string }));
  }

  /** Symbol rows declared in the given files — used to label callers' enclosing symbol. */
  async symbolsInFiles(repoId: string, paths: string[]): Promise<SymbolInFileRow[]> {
    if (paths.length === 0) return [];
    return this.db
      .select({
        path: t.symbols.path,
        name: t.symbols.name,
        line: t.symbols.line,
        endLine: t.symbols.endLine,
      })
      .from(t.symbols)
      .where(and(eq(t.symbols.repoId, repoId), inArray(t.symbols.path, paths)));
  }

  /** Import-graph edges pointing AT any of `toFiles` — one BFS layer's worth of importers. */
  async importersOf(repoId: string, toFiles: string[]): Promise<FileEdgeRow[]> {
    if (toFiles.length === 0) return [];
    return this.db
      .select({ fromFile: t.fileEdges.fromFile, toFile: t.fileEdges.toFile })
      .from(t.fileEdges)
      .where(and(eq(t.fileEdges.repoId, repoId), inArray(t.fileEdges.toFile, toFiles)));
  }

  /** Precomputed endpoints/crons for the given files. */
  async factsFor(repoId: string, files: string[]): Promise<FileFactsRow[]> {
    if (files.length === 0) return [];
    const rows = await this.db
      .select({
        filePath: t.fileFacts.filePath,
        endpoints: t.fileFacts.endpoints,
        crons: t.fileFacts.crons,
      })
      .from(t.fileFacts)
      .where(and(eq(t.fileFacts.repoId, repoId), inArray(t.fileFacts.filePath, files)));
    return rows.map((r) => ({
      filePath: r.filePath,
      endpoints: (r.endpoints as string[]) ?? [],
      crons: (r.crons as string[]) ?? [],
    }));
  }

  /**
   * Other PRs (same workspace + repo, excluding this PR) whose files overlap
   * `paths`. Ordered by most-recently-updated first, capped at `limit`.
   */
  async priorPrsTouching(
    workspaceId: string,
    repoId: string,
    excludePrId: string,
    paths: string[],
    limit: number,
  ): Promise<PriorPrRow[]> {
    if (paths.length === 0) return [];
    const rows = await this.db
      .select({
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        author: t.pullRequests.author,
        status: t.pullRequests.status,
        updatedAt: t.pullRequests.updatedAt,
        overlapFiles: sql<string[]>`array_agg(distinct ${t.prFiles.path})`,
      })
      .from(t.pullRequests)
      .innerJoin(t.prFiles, eq(t.prFiles.prId, t.pullRequests.id))
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          ne(t.pullRequests.id, excludePrId),
          inArray(t.prFiles.path, paths),
        ),
      )
      .groupBy(
        t.pullRequests.id,
        t.pullRequests.number,
        t.pullRequests.title,
        t.pullRequests.author,
        t.pullRequests.status,
        t.pullRequests.updatedAt,
      )
      .orderBy(sql`${t.pullRequests.updatedAt} DESC NULLS LAST`)
      .limit(limit);
    return rows;
  }
}
