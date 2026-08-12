import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, ExternalServiceError } from '../../platform/errors.js';
import { loadDiff } from '../reviews/diff-loader.js';

/**
 * intent module (L03).
 *   GET  /pulls/:id/intent → the PR's cached `PrIntentRecord`; 404 when none
 *                            exists yet.
 *   POST /pulls/:id/intent → force reclassification, bypassing the
 *                            `(pr_id, head_sha)` cache; returns the fresh
 *                            `PrIntentRecord`. Wired to the reference UI's
 *                            Recompute control [2026-08-12].
 *
 * Automatic classification still runs once per PR inside
 * `ReviewRunExecutor.executeRuns` via `container.intent.ensureForPull`,
 * cached by (PR + head SHA); POST is the explicit escape hatch for that
 * cache, not a replacement for it.
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    // Tenancy guard: confirm the PR belongs to this workspace before
    // returning its intent, mirroring `GET /pulls/:id` (modules/pulls/routes.ts).
    const pull = await container.reviewRepo.getPull(workspaceId, req.params.id);
    if (!pull) throw new NotFoundError('Pull request not found');

    const record = await container.reviewRepo.getIntentRecord(req.params.id);
    if (!record) throw new NotFoundError('Intent not found');
    return record;
  });

  app.post(
    '/pulls/:id/intent',
    {
      schema: { params: IdParams },
      // House rule for LLM-backed routes (conventions/routes.ts,
      // reviews/routes.ts): one structured classification call per hit.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      // Same tenancy guard as the GET — `pr_intent` deliberately has no
      // `workspace_id` column and relies on this check (server/AGENTS.md).
      const pull = await container.reviewRepo.getPull(workspaceId, req.params.id);
      if (!pull) throw new NotFoundError('Pull request not found');

      const repo = await container.reviewRepo.getRepo(pull.repoId);
      if (!repo) throw new NotFoundError('Repo not found');

      // Reuse the same diff-loading path `executeRuns` uses, rather than
      // inventing a second one (modules/reviews/diff-loader.ts).
      const diff = await loadDiff(container, container.reviewRepo, workspaceId, pull, repo);

      const record = await container.intent.ensureForPull(workspaceId, pull, repo, diff, req.log, true);
      if (!record) {
        // ensureForPull never throws — a `force` call returning `undefined`
        // means classification itself failed (LLM error, bad parse, …).
        // A 200 with no body would hide that from the Recompute button.
        throw new ExternalServiceError('Intent classification failed');
      }
      return record;
    },
  );
}
