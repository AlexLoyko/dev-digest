/**
 * service.ts — BriefService: orchestrates PR Brief generation (AC-2).
 *
 * Onion layer: application layer — orchestrates repository + adapter calls;
 * no SQL here (`BriefRepository`/`ReviewRepository` own that), no `new`
 * adapter construction (everything comes off `Container`).
 *
 * `generate(workspaceId, prId)` is the ONLY path that spends money (T8):
 *   1. Load the PR + repo (`ReviewRepository`, reused rather than duplicated —
 *      mirrors `IntentService`'s constructor shape, `modules/intent/service.ts:28-40`).
 *   2. Assemble `BriefInputParts` from PR metadata, diff stats, the PR's
 *      changed-file metadata (`BriefRepository.getChangedFiles` — never
 *      `pr_files.patch`, AC-3), the stored intent, a best-effort blast
 *      summary, and a best-effort linked issue.
 *   3. `fitToBudget` the assembled parts to `BRIEF_TOKEN_BUDGET` (AC-14).
 *   4. Exactly ONE `llm.completeStructured({schema: PrBrief, ...})` call (AC-2).
 *   5. `groundBrief` the model's result against the PR's real changed paths
 *      (AC-5 — drops any file reference the model asserted outside the diff).
 *   6. `repository.upsert` the full `StoredBrief` envelope.
 *
 * Every step 2 signal that can fail (linked issue, blast summary) is
 * best-effort: a failure there degrades that one input, it never fails
 * generation as a whole (mirrors `IntentService`'s `container.github()` /
 * linked-issue handling, `intent/service.ts:102-164`).
 *
 * AC-15 (T10 — absent-input degradation): a missing stored intent, a missing
 * blast summary, or an unavailable linked issue (EC-4: no GitHub client, or
 * the fetch throwing) is recorded as `{action: 'omitted'}` and generation
 * proceeds with the remaining inputs — this is NOT a `BriefGenerationFailure`
 * (T9's failure branch is reserved for the model call itself misbehaving;
 * see that section below). These "absent" omissions are computed once, right
 * after each input is resolved and BEFORE `fitToBudget` runs, then appended
 * to `fitToBudget`'s own `degraded` array — the two lists cannot overlap,
 * because `fitToBudget` only ever sheds an input that is still present
 * (`if (candidate.X)`), so an input already `null` here is never touched by
 * it. AC-14 (budget "reduced") and AC-15 (absent "omitted") deliberately
 * share the one `BriefDegradation`/`degraded` mechanism — no second array,
 * no second UI surface. `project_context` is always `[]` in v1 (SPEC-01's
 * context attachments are scoped per agent/per skill, and this feature is
 * explicitly not per-agent) and is recorded exactly once, unconditionally,
 * by `fitToBudget` itself (`budget.ts` step 1) — it is deliberately NOT
 * duplicated here.
 *
 * AC-8 (single-flight): the whole generation body (everything past the cheap
 * PR/repo load needed to compute the single-flight key) runs inside
 * `SingleFlight.run(key)`, keyed `${prId}:${headSha}` — concurrent callers for
 * the same PR state coalesce into the one in-flight (paid) call.
 *
 * Security (NFR-7): only non-secret generation metadata (provider, model,
 * token/cost/duration numbers, the degradation list) is logged — never a
 * `SecretsProvider` value. `container.github()` is called `.catch(() => null)`
 * exactly as `IntentService` does (`intent/service.ts:104`) rather than
 * reading `GITHUB_TOKEN` itself.
 *
 * AC-16 (T9 — failure branch, fail-closed per OWASP A10): the ONLY code path
 * that spends money — `container.llm(provider)` + `llm.completeStructured`
 * — is wrapped in a try/catch, and the result is re-validated against
 * `PrBrief` on BOTH sides of `groundBrief` (never trust a generic
 * `StructuredResult<T>` return value just because it's typed `T` — that's a
 * compile-time assertion, not a runtime guarantee; see the zod skill's
 * "parse, don't trust boundaries" rule). Any of the three — the call
 * throwing, the raw result failing `PrBrief.safeParse`, or the grounded
 * result failing it (grounding is defensive here; today it cannot itself
 * produce an invalid shape, see `grounding.ts`) — short-circuits BEFORE
 * `repository.upsert` is ever called, so a failure can never partially
 * overwrite a previously stored brief. `doGenerate` returns a
 * `BriefGenerationFailure` value instead of throwing for these cases —
 * `generate()`'s early `NotFoundError` throws (missing PR/repo) are a
 * different, unrelated failure class and are deliberately left as throws.
 *
 * Classifying `model_error` vs `invalid_result` for a THROWN error: both the
 * real providers (`adapters/llm/openai.ts`, `anthropic.ts`) and
 * `MockLLMProvider` (`adapters/mocks.ts:95-97`) use the literal substring
 * "schema" in the message they throw when a structured completion never
 * validates against the requested schema (`ExternalServiceError('... failed
 * schema validation')` / `Error('MockLLMProvider fixture failed schema: ...')`)
 * — that shared wording is the signal `classifyThrow` keys on. Every other
 * thrown error (network/timeout/`ConfigError` from a missing API key) has no
 * reason to mention "schema" and classifies as `model_error`.
 */
import type { Container } from '../../platform/container.js';
import {
  PrBrief,
  type BriefDegradation,
  type BriefMeta,
  type BriefResponse,
  type StoredBrief,
  type StructuredResult,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import { BriefRepository } from './repository.js';
import { parseReferences } from '../intent/references.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { fitToBudget } from './budget.js';
import { buildBriefUserMessage, SYSTEM_PROMPT } from './prompt.js';
import { groundBrief } from './grounding.js';
import { selectLatestCompletedRun } from './latest-run.js';
import { SingleFlight } from './single-flight.js';
import { BRIEF_SCHEMA_VERSION, BRIEF_TOKEN_BUDGET } from './constants.js';
import type { BriefInputParts, BriefLinkedIssue } from './types.js';
import type { Logger } from '../reviews/run-executor.js';

/**
 * AC-16's discriminated failure (T9). Deliberately NOT a `{ ok: false, ... }`
 * wrapper around the success case — `generate()`'s existing callers (T8's
 * `brief-generate.it.test.ts`, unchanged/owned by T8) treat a successful
 * `generate()` call as a bare `StoredBrief`, so the two branches are told
 * apart structurally: a `StoredBrief` always has `schema_version`, a
 * `BriefGenerationFailure` always has `reason`. Neither field exists on the
 * other shape. `hasPriorBrief` is what the client's presentation branch is
 * chosen from (T21/T11) — never an HTTP status.
 */
export interface BriefGenerationFailure {
  reason: 'model_error' | 'invalid_result';
  hasPriorBrief: boolean;
}

/** Discriminant helper for callers of `generate()` — checks the field that
 *  only exists on the failure shape (see `BriefGenerationFailure`'s doc). */
export function isBriefGenerationFailure(
  result: StoredBrief | BriefGenerationFailure,
): result is BriefGenerationFailure {
  return 'reason' in result;
}

export class BriefService {
  private repo: BriefRepository;
  private reviewRepo: ReviewRepository;
  /**
   * One `SingleFlight` per `BriefService` instance. Routes construct exactly
   * one `BriefService` per process (like every other module's service), so
   * this coalesces concurrent `generate()` calls for the same
   * `${prId}:${headSha}` for the lifetime of the process — see
   * `single-flight.ts`'s header for the in-process-only caveat.
   */
  private readonly singleFlight = new SingleFlight();
  private logger: Logger | undefined;

  constructor(private container: Container, logger?: Logger) {
    this.repo = new BriefRepository(container.db);
    this.reviewRepo = new ReviewRepository(container.db);
    // Optional pino-compatible logger — mirrors IntentService's constructor
    // shape. Defaults to undefined so the service degrades gracefully in
    // tests that don't care about the audit log.
    this.logger = logger;
  }

  /**
   * Generate (and persist) a fresh brief for `prId`. Always recomputes and
   * upserts — callers that want cache semantics (read-only, zero LLM calls)
   * use `BriefRepository.getStored` directly (T11's `GET` route), never this
   * method.
   */
  async generate(
    workspaceId: string,
    prId: string,
  ): Promise<StoredBrief | BriefGenerationFailure> {
    // Cheap read, done BEFORE the single-flight wrap: we need the PR's current
    // head_sha to compute the coalescing key.
    const pull = await this.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);

    const repoRow = await this.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError(`Repository not found for PR: ${prId}`);

    const key = `${prId}:${pull.headSha}`;
    return this.singleFlight.run(key, () => this.doGenerate(workspaceId, prId, pull, repoRow));
  }

  /**
   * Read-only composition for `GET /pulls/:id/brief` (T11, moved here once
   * `service.ts`'s three-way concurrent-task contention that originally
   * forced this composition into `routes.ts` had landed — see the 2026-08-29
   * INSIGHTS.md entry documenting that as deliberate, reported debt).
   *
   * AC-9 — READ THIS BEFORE "FIXING" THIS METHOD: it makes ZERO LLM calls in
   * EVERY branch, including when the stored brief is stale. It does NOT
   * lazily compute, unlike its two nearest neighbours — `GET /pulls/:id/intent`
   * (compute-on-miss, `modules/intent/routes.ts:22-30`) and `GET
   * /pulls/:id/blast` (always calls the LLM). The divergence is deliberate: a
   * read that spends money means merely loading a page bills the user. The
   * spec's only two spend controls — the 10/min rate limit and the AC-8
   * single-flight guard, both on `generate()` above — rely on generation
   * only ever happening from an explicit user action. Do NOT align this
   * method with `intent` or `blast`, and do not let a reviewer talk you into
   * it.
   */
  async getBriefView(workspaceId: string, prId: string): Promise<BriefResponse> {
    // `getPullHeadSha` returns null for a PR that doesn't exist OR belongs to
    // a different workspace (A01) — either way, 404, never a silent "no
    // brief" that would leak cross-workspace existence.
    const headSha = await this.repo.getPullHeadSha(workspaceId, prId);
    if (headSha === null) throw new NotFoundError(`Pull request not found: ${prId}`);

    const [stored, runRows] = await Promise.all([
      this.repo.getStored(prId),
      this.repo.getLatestRunRows(workspaceId, prId),
    ]);

    // AC-12/EC-5: independent of `brief` — a PR can have no brief AND a
    // completed run, or a brief and no run. Never let one suppress the other.
    const latest_run = selectLatestCompletedRun(runRows);

    // AC-23: no brief ever generated for this PR → 200 with an explicit
    // `brief: null, meta: null, stale: false` — NOT a 404, NOT an error. The
    // client's "no brief yet" card (and `useBrief`'s zero-generation-calls
    // guarantee) renders from exactly this payload.
    if (!stored) {
      return { brief: null, meta: null, stale: false, latest_run };
    }

    const stale = this.repo.isStale(stored, headSha);
    const meta: BriefMeta = {
      head_sha: stored.head_sha,
      generated_at: stored.generated_at,
      provider: stored.provider,
      model: stored.model,
      tokens_in: stored.tokens_in,
      tokens_out: stored.tokens_out,
      cost_usd: stored.cost_usd,
      duration_ms: stored.duration_ms,
      input_tokens_measured: stored.input_tokens_measured,
      degraded: stored.degraded,
    };
    return { brief: stored.brief, meta, stale, latest_run };
  }

  // ---- private orchestration -------------------------------------------------

  private async doGenerate(
    workspaceId: string,
    prId: string,
    pull: NonNullable<Awaited<ReturnType<ReviewRepository['getPull']>>>,
    repoRow: NonNullable<Awaited<ReturnType<ReviewRepository['getRepo']>>>,
  ): Promise<StoredBrief | BriefGenerationFailure> {
    const startedAt = Date.now();

    // ---- Assemble BriefInputParts -------------------------------------------

    const changedFiles = await this.repo.getChangedFiles(prId);
    const changedPaths = changedFiles.map((f) => f.path);

    const storedIntent = await this.reviewRepo.getIntent(prId);

    const repoRef = { owner: repoRow.owner, name: repoRow.name };

    const linkedIssue = await this.resolveLinkedIssue(pull.body, repoRef);
    const blastSummary = await this.resolveBlastSummary(repoRow.id, changedPaths);

    // AC-15: an absent intent / blast summary / linked issue proceeds to
    // generation rather than failing it — recorded here as 'omitted', before
    // fitToBudget runs, so fitToBudget's own shedding (which only touches an
    // input that is still present) can never produce a second, duplicate
    // entry for the same input.
    const absentInputDegradations: BriefDegradation[] = [];
    if (!storedIntent) absentInputDegradations.push({ input: 'intent', action: 'omitted' });
    if (!blastSummary) absentInputDegradations.push({ input: 'blast', action: 'omitted' });
    if (!linkedIssue) absentInputDegradations.push({ input: 'linked_issue', action: 'omitted' });

    const parts: BriefInputParts = {
      pr: {
        title: pull.title,
        body: pull.body,
        author: pull.author,
        branch: pull.branch,
        base: pull.base,
        headSha: pull.headSha,
        status: pull.status,
      },
      diffStats: {
        additions: pull.additions,
        deletions: pull.deletions,
        filesCount: pull.filesCount,
      },
      changedFiles,
      intent: storedIntent ?? null,
      blastSummary,
      linkedIssue,
      // Project-context docs are always [] in v1 — see types.ts.
      projectContextDocs: [],
    };

    // ---- Fit to budget + build the prompt -----------------------------------

    const { parts: fitted, degraded: budgetDegraded } = fitToBudget(
      parts,
      this.container.tokenizer,
      BRIEF_TOKEN_BUDGET,
    );
    // AC-14 + AC-15, one mechanism: the array reaching storage is the union
    // of the budget pass's 'reduced' entries and the absent-input 'omitted'
    // ones above, in a stable (budget-pass-first) order.
    const degraded: BriefDegradation[] = [...budgetDegraded, ...absentInputDegradations];
    const userMessage = buildBriefUserMessage(fitted);

    // ---- Exactly ONE structured model call (AC-2) ---------------------------

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');

    let result: StructuredResult<PrBrief>;
    try {
      const llm = await this.container.llm(provider);
      result = await llm.completeStructured({
        model,
        schema: PrBrief,
        schemaName: 'PrBrief',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,
      });
    } catch (err) {
      return this.failure(prId, this.classifyThrow(err));
    }

    // AC-16 (T9): re-validate the model's own result before trusting it — a
    // `StructuredResult<T>`'s `T` is a compile-time label, not a runtime
    // guarantee (EC-10: an out-of-set `risk_level` reaches here as a
    // validation failure even for an adapter that returns rather than
    // throws).
    const validatedResult = PrBrief.safeParse(result.data);
    if (!validatedResult.success) {
      return this.failure(prId, 'invalid_result');
    }

    // ---- Ground against the PR's real changed paths (AC-5) ------------------

    const { brief: groundedBrief, dropped } = groundBrief(validatedResult.data, changedPaths);

    // Defensive: `groundBrief` cannot currently produce an invalid shape (it
    // only removes elements, never adds — see grounding.ts), but a brief
    // reaching storage is exactly what AC-16 promises never happens on any
    // invalid path, so this is re-checked rather than assumed.
    const validatedGrounded = PrBrief.safeParse(groundedBrief);
    if (!validatedGrounded.success) {
      return this.failure(prId, 'invalid_result');
    }

    const durationMs = Date.now() - startedAt;

    // ---- Persist the full envelope (AC-10, NFR-6) ---------------------------
    // model/tokens_in/tokens_out/cost_usd come from the StructuredResult
    // itself — NOT discarded the way IntentService discards them (AC-10,
    // NFR-6 require all four persisted).
    const stored: StoredBrief = {
      schema_version: BRIEF_SCHEMA_VERSION,
      head_sha: pull.headSha,
      generated_at: new Date().toISOString(),
      provider,
      model: result.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd ?? 0,
      duration_ms: durationMs,
      // The prompt actually sent was measured via `container.tokenizer.count()`
      // in `fitToBudget` (never a chars/4 heuristic) — always true here.
      input_tokens_measured: true,
      degraded,
      brief: groundedBrief,
    };

    await this.repo.upsert(prId, stored);

    // NFR-6 audit trail: model, tokens, cost, duration, degradations. NEVER a
    // SecretsProvider value (NFR-7) — nothing below reads through `secrets`.
    this.logger?.info(
      {
        prId,
        provider: stored.provider,
        model: stored.model,
        tokensIn: stored.tokens_in,
        tokensOut: stored.tokens_out,
        costUsd: stored.cost_usd,
        durationMs: stored.duration_ms,
        degraded: stored.degraded,
        groundingDropped: dropped.length,
      },
      `brief: generated for pr ${prId} (${stored.model}, ${stored.tokens_in}+${stored.tokens_out} tokens, $${stored.cost_usd})`,
    );

    return stored;
  }

  /**
   * AC-16 (T9) — build the discriminated failure. `store NOTHING` holds by
   * construction: every call site returns this directly, before
   * `repository.upsert` is ever reached in `doGenerate`. `hasPriorBrief`
   * comes from a fresh `repository.getStored` read (never a cached copy —
   * something an earlier concurrent generation, unrelated to this one, could
   * have written moments ago) so the client's presentation branch reflects
   * what is actually in storage right now.
   */
  private async failure(
    prId: string,
    reason: BriefGenerationFailure['reason'],
  ): Promise<BriefGenerationFailure> {
    const prior = await this.repo.getStored(prId);
    this.logger?.warn(
      { prId, reason, hasPriorBrief: prior !== null },
      `brief: generation failed for pr ${prId} (${reason})`,
    );
    return { reason, hasPriorBrief: prior !== null };
  }

  /**
   * Classifies a thrown error from the `container.llm(provider)` /
   * `llm.completeStructured` pair (see this file's header comment for why
   * "schema" is the shared signal both real providers and `MockLLMProvider`
   * use for "the structured result never validated"). Anything else —
   * network/timeout errors, `ConfigError` from a missing API key — is a
   * `model_error`: the call itself could not be completed, as distinct from
   * completing and returning something invalid.
   */
  private classifyThrow(err: unknown): BriefGenerationFailure['reason'] {
    const message = err instanceof Error ? err.message : String(err);
    return /schema/i.test(message) ? 'invalid_result' : 'model_error';
  }

  /**
   * Best-effort linked issue: parse GitHub refs out of the PR body and fetch
   * the first one, exactly as `IntentService` does (`intent/service.ts:129-160`).
   * `container.github()` rejects with no PAT configured — `.catch(() => null)`
   * it, same as `IntentService` (`intent/service.ts:104`). Any fetch failure
   * (404, rate limit, network) degrades to "no linked issue" — it must never
   * fail brief generation (EC-4).
   */
  private async resolveLinkedIssue(
    body: string | null,
    repoRef: { owner: string; name: string },
  ): Promise<BriefLinkedIssue | null> {
    const github = await this.container.github().catch(() => null);
    if (!github) return null;

    const parsedRefs = parseReferences(body, repoRef);
    const firstGithubRef = parsedRefs.find((r) => r.kind === 'github');
    if (firstGithubRef?.issueNumber == null) return null;

    const n = firstGithubRef.issueNumber;
    const targetRef =
      firstGithubRef.targetOwner && firstGithubRef.targetRepo
        ? { owner: firstGithubRef.targetOwner, name: firstGithubRef.targetRepo }
        : repoRef;

    try {
      const fetched = await github.getIssue(targetRef, n);
      return { title: fetched.title, body: fetched.body ?? null };
    } catch {
      // Fall back to getPullRequest — the reference may point at a PR, not an issue.
      try {
        const pr = await github.getPullRequest(targetRef, n);
        return { title: pr.title, body: pr.body ?? null };
      } catch {
        // Best-effort: no linked issue reachable.
        return null;
      }
    }
  }

  /**
   * Best-effort blast-radius summary, built from `container.repoIntel`'s
   * already-degradable facade (`getBlastRadius` returns an empty/degraded
   * result rather than throwing when the repo has no clone/index — see
   * `repo-intel/service.ts`). Deliberately does NOT call another module's
   * *service* class (that would cross an onion-architecture module boundary
   * this module doesn't own) and does NOT make a second LLM call to
   * paraphrase the numbers — `risk_brief`'s one `completeStructured` call is
   * the only paid call this method makes (AC-2's "exactly one" bound would
   * otherwise no longer describe this generation's total spend).
   */
  private async resolveBlastSummary(
    repoId: string,
    changedPaths: string[],
  ): Promise<string | null> {
    if (changedPaths.length === 0) return null;
    try {
      const blast = await this.container.repoIntel.getBlastRadius(repoId, changedPaths);
      const hasSignal =
        !blast.degraded &&
        (blast.changedSymbols.length > 0 ||
          blast.callers.length > 0 ||
          blast.impactedEndpoints.length > 0);
      if (!hasSignal) return null;
      return `${blast.changedSymbols.length} changed symbol(s), ${blast.callers.length} caller(s), ${blast.impactedEndpoints.length} affected endpoint(s).`;
    } catch {
      // Best-effort: no blast summary available.
      return null;
    }
  }
}
