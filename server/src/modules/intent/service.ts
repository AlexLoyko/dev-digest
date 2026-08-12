import type { Intent, PrIntentRecord, RepoRef, UnifiedDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PullRow, RepoRow } from '../../db/rows.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { resolveSources } from './sources.js';
import { buildCodeDigest } from './digest.js';
import { computeConfidence } from './confidence.js';
import { renderIntentBlock } from './render.js';
import { IntentDraft, MAX_BODY_CHARS, SYSTEM_PROMPT, type Logger } from './constants.js';

/**
 * Derives a PR's intent — what it's trying to do, and what it deliberately
 * is not — cached by (PR + head SHA), one structured LLM call per cache miss.
 *
 * Called once per PR (before the agent fan-out), NOT once per agent — see
 * `run-executor.ts`'s "Loads the diff + intent once" comment.
 */
export class IntentService {
  constructor(private container: Container) {}

  /**
   * Renders a cached/fresh `PrIntentRecord` into the prompt's `## Derived
   * intent (advisory)` inner payload. Delegates to `render.ts` — callers
   * outside this module (e.g. `reviews/run-executor.ts`) must go through
   * `container.intent.renderBlock` rather than importing `render.ts`
   * directly (server/AGENTS.md: no reaching into another module's folder).
   */
  renderBlock(record: PrIntentRecord): string {
    return renderIntentBlock(record);
  }

  /**
   * NEVER throws. Every failure path (no GitHub token, clone read error, LLM
   * error, bad parse) is caught, logged, and returns `undefined` so the
   * review proceeds with the intent slot simply omitted — context enrichment
   * is best-effort (`server/AGENTS.md`).
   *
   * @param force When `true`, bypasses the `(pr_id, head_sha)` cache check
   *   entirely and always reclassifies, overwriting the stored row — used by
   *   `POST /pulls/:id/intent` (Recompute). Default `false` preserves the
   *   automatic-only cache-first behaviour used by `executeRuns`.
   */
  async ensureForPull(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    diff: UnifiedDiff,
    logger?: Logger,
    force = false,
  ): Promise<PrIntentRecord | undefined> {
    try {
      // Cache key (pr_id, head_sha). A stale/missing row misses and reclassifies.
      const cached = await this.container.reviewRepo.getIntentRecord(pull.id);
      if (force) {
        logger?.info({ prId: pull.id, headSha: pull.headSha }, 'intent: recompute forced');
      } else if (cached && cached.head_sha === pull.headSha) {
        logger?.info(
          { prId: pull.id, headSha: pull.headSha, cached: true, confidence: cached.confidence },
          'intent: cache hit',
        );
        return cached;
      }

      const ref: RepoRef = { owner: repo.owner, name: repo.name };
      const { sources, docTexts } = await resolveSources(
        this.container,
        ref,
        repo.fullName,
        pull.id,
        pull.title,
        pull.body,
        logger,
      );

      const docsResolved = sources.filter((s) => s.kind === 'doc' && s.resolved).length;
      const docsDropped = sources.filter((s) => s.kind === 'doc' && !s.resolved).length;
      const bodyChars = (pull.body ?? '').trim().length;

      logger?.info(
        { prId: pull.id, docsResolved, docsDropped, bodyChars },
        'intent: sources resolved',
      );

      // Always the changed-file list from hunk headers — never hunk content,
      // never conditional (L03 §1).
      const codeDigest = buildCodeDigest(diff);

      const userSections = [
        `PR title: ${pull.title}`,
        pull.body
          ? `PR description:\n${pull.body.trim().slice(0, MAX_BODY_CHARS)}`
          : 'PR description: (none given)',
        docTexts.length > 0
          ? docTexts.map((d) => `Doc "${d.path}":\n${d.text}`).join('\n\n')
          : undefined,
        `Code digest:\n${codeDigest}`,
      ].filter((s): s is string => Boolean(s));

      const choice = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
      const llm = await this.container.llm(choice.provider);

      const start = Date.now();
      const res = await llm.completeStructured<IntentDraft>({
        model: choice.model,
        schema: IntentDraft,
        schemaName: 'IntentDraft',
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userSections.join('\n\n') },
        ],
      });
      const durationMs = Date.now() - start;

      if (res.data.embedded_instructions_detected) {
        logger?.warn(
          { prId: pull.id, headSha: pull.headSha },
          'intent: embedded instructions detected in pr text — reported, not followed',
        );
      }

      const { confidence, clamped } = computeConfidence(sources, res.data.sources_used, bodyChars);

      // The `sources` literal is annotated via `Intent` so a jsonb-destined
      // shape is checked at the write site (server/INSIGHTS.md).
      const intent: Intent = {
        intent: res.data.intent,
        in_scope: res.data.in_scope,
        out_of_scope: res.data.out_of_scope,
        type: res.data.type,
        confidence,
        sources,
      };

      await this.container.reviewRepo.upsertIntent(pull.id, intent, {
        headSha: pull.headSha,
        provider: choice.provider,
        model: choice.model,
      });

      logger?.info(
        {
          prId: pull.id,
          headSha: pull.headSha,
          provider: choice.provider,
          model: choice.model,
          type: intent.type,
          confidence,
          clamped,
          tokensIn: res.tokensIn,
          tokensOut: res.tokensOut,
          costUsd: res.costUsd,
          durationMs,
        },
        'intent: classified',
      );

      // Re-read so the returned record carries the DB-computed `classified_at`.
      return await this.container.reviewRepo.getIntentRecord(pull.id);
    } catch (err) {
      logger?.warn(
        { prId: pull.id, err: (err as Error).message },
        'intent: classification failed — continuing without intent',
      );
      return undefined;
    }
  }
}
