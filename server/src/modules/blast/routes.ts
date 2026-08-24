import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module routes.
 *
 * GET /pulls/:id/blast → "what else could this diff touch?" — changed
 * symbols → their callers → downstream HTTP endpoints/crons reachable via
 * the import graph, derived from the repo-intel persistent index.
 *
 * Onion layer: presentation — thin handler: getContext → one service call →
 * reply. No business logic here.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.get('/pulls/:id/blast', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const service = new BlastService(app.container, req.log);
    return service.forPull(workspaceId, req.params.id);
  });
}
