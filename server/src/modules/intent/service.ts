import type { PrIntent, PrIntentRecord, RepoRef, UnifiedDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { PullRow, RepoRow } from '../../db/rows.js';
import { defaultFeatureModel, getFeatureModelOverride } from '../settings/feature-models.js';
import { resolveSources } from './sources.js';
import { buildIntentPrompt } from './prompt.js';
import { computeConfidence } from './confidence.js';
import { renderIntentBlock } from './render.js';
import { IntentDraft, type Logger } from './constants.js';

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
          {
            prId: pull.id,
            headSha: pull.headSha,
            cached: true,
            confidence: cached.confidence,
            // Which model produced this intent, so EVERY path records it — a
            // cache hit builds no prompt, so this line is the only trace it gets.
            provider: cached.provider,
            model: cached.model,
          },
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
        {
          prId: pull.id,
          headSha: pull.headSha,
          docsResolved,
          docsDropped,
          bodyChars,
          // The full list, dropped docs included — those never reach the prompt,
          // so this line is the only place they are visible.
          sources,
        },
        'intent: sources resolved',
      );

      // `resolveFeatureModel` is `(await getFeatureModelOverride(…)) ?? DEFAULTS[id]`;
      // splitting it into its two halves costs no extra query and is the only way
      // to know WHICH of the two the model came from.
      const override = await getFeatureModelOverride(this.container, workspaceId, 'review_intent');
      const choice = override ?? defaultFeatureModel('review_intent');

      logger?.info(
        {
          prId: pull.id,
          headSha: pull.headSha,
          feature: 'review_intent',
          provider: choice.provider,
          model: choice.model,
          choiceSource: override ? 'workspace_override' : 'registry_default',
        },
        'intent: model selected',
      );

      const prompt = buildIntentPrompt({
        title: pull.title,
        body: pull.body,
        docTexts,
        diff,
      });

      // The request, as sent. Verbatim and un-abridged on purpose: a truncated
      // prompt log hides exactly what it exists to surface — an embedded
      // instruction in a PR body, or a doc ref that resolved to the wrong file.
      // Every field here is an explicit key; never spread `res`/`intent` into a
      // log object or the model's own prose and `raw` ride along.
      logger?.info(
        {
          prId: pull.id,
          headSha: pull.headSha,
          provider: choice.provider,
          model: choice.model,
          system: prompt.system,
          user: prompt.user,
          parts: prompt.parts,
          systemChars: prompt.systemChars,
          userChars: prompt.userChars,
          digestFilesListed: prompt.digestFilesListed,
          digestFilesTotal: prompt.digestFilesTotal,
          digestOverflow: prompt.digestOverflow,
          estTokensIn: prompt.estTokensIn,
        },
        'intent: prompt',
      );

      const llm = await this.container.llm(choice.provider);

      const start = Date.now();
      const res = await llm.completeStructured<IntentDraft>({
        model: choice.model,
        schema: IntentDraft,
        schemaName: 'IntentDraft',
        temperature: 0,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
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

      // The `sources` literal is annotated via `PrIntent` so a jsonb-destined
      // shape is checked at the write site (server/INSIGHTS.md).
      const intent: PrIntent = {
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
          // Providers may substitute; this is what actually answered.
          modelReturned: res.model,
          type: intent.type,
          confidence,
          clamped,
          tokensIn: res.tokensIn,
          tokensOut: res.tokensOut,
          costUsd: res.costUsd,
          durationMs,
          attempts: res.attempts,
          // Repeated from `intent: prompt` so estimate-vs-actual reads off ONE
          // line. Expect a systematically POSITIVE drift: `tokensIn` also counts
          // the JSON-schema/tool-definition envelope `completeStructured` wraps
          // our messages in, which a chars/4 estimate over the prompt text does
          // not model. Don't "fix" the estimate to chase it.
          estTokensIn: prompt.estTokensIn,
          tokensInDrift: res.tokensIn - prompt.estTokensIn,
          tokensInDriftPct:
            res.tokensIn > 0
              ? Math.round(((res.tokensIn - prompt.estTokensIn) / res.tokensIn) * 100)
              : null,
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
