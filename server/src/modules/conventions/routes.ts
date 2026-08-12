import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

const AcceptBody = z.object({ accepted: z.boolean() });

/**
 * Conventions module (L02 lab).
 *   POST   /repos/:id/conventions/extract     → scan the clone, replace the candidate set
 *   GET    /repos/:id/conventions             → persisted candidates
 *   GET    /repos/:id/conventions/skill-draft → prefill for the Create-skill modal
 *   PATCH  /conventions/:id                   → { accepted } toggle
 *   DELETE /conventions/:id                   → reject (hard delete)
 *
 * Row-level mutations live at top-level `/conventions/:id` rather than under
 * `/repos/:id/conventions/:cid`, so no literal segment ever competes with a
 * `:param` at the same position (see INSIGHTS: Fastify matches `import` as a
 * uuid param and 422s).
 *
 * Skill creation is deliberately NOT here — `POST /skills` already accepts every
 * field the modal edits (name/description/type/source/body/enabled), so the
 * client saves the edited draft through that.
 */
export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.post(
    '/repos/:id/conventions/extract',
    {
      schema: { params: IdParams },
      // One model call over a dozen files — same class of expense as a review.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.get('/repos/:id/conventions/skill-draft', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.skillDraft(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: AcceptBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const updated = await service.setAccepted(workspaceId, req.params.id, req.body.accepted);
      if (!updated) throw new NotFoundError('Convention not found');
      return updated;
    },
  );

  app.delete('/conventions/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const removed = await service.reject(workspaceId, req.params.id);
    if (!removed) throw new NotFoundError('Convention not found');
    return { ok: true };
  });
}
