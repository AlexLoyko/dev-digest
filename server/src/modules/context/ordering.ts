import type { EffectiveContextDoc } from '@devdigest/shared';

/** One document directly attached to the agent. */
export interface AgentDocInput {
  path: string;
  position: number;
}

/** One document inherited via a skill attached to the agent. */
export interface SkillDocInput {
  skillId: string;
  /** The agent_skills.order value for the skill this document was inherited from. */
  skillOrder: number;
  path: string;
  position: number;
}

export interface BuildEffectiveSetInput {
  agentDocs: AgentDocInput[];
  skillDocs: SkillDocInput[];
}

/**
 * Orders the documents that will be injected into a run's prompt (AC-12):
 * agent-attached documents first, in their stored position order, followed
 * by skill-inherited documents ordered by skill order and then document
 * position within that skill.
 *
 * Deduplicates by path, keeping the FIRST occurrence in that order (AC-13,
 * EC-9) — an agent-attached path wins over any skill-inherited copy, and
 * among skill-inherited copies of the same path, the one from the
 * earlier-ordered skill wins.
 *
 * Pure function: no I/O, no DB, no container. `tokens` / `tokens_approximate`
 * / `missing` are left as placeholder defaults (0 / false / false) — the
 * caller (T11/T12) fills them in once the document content is resolved.
 */
export function buildEffectiveSet(input: BuildEffectiveSetInput): EffectiveContextDoc[] {
  const orderedAgentDocs = [...input.agentDocs].sort((a, b) => a.position - b.position);

  const orderedSkillDocs = [...input.skillDocs].sort((a, b) => {
    if (a.skillOrder !== b.skillOrder) return a.skillOrder - b.skillOrder;
    return a.position - b.position;
  });

  const seen = new Set<string>();
  const result: EffectiveContextDoc[] = [];

  for (const doc of orderedAgentDocs) {
    if (seen.has(doc.path)) continue;
    seen.add(doc.path);
    result.push({
      path: doc.path,
      position: doc.position,
      source: 'agent',
      skill_id: null,
      tokens: 0,
      tokens_approximate: false,
      missing: false,
    });
  }

  for (const doc of orderedSkillDocs) {
    if (seen.has(doc.path)) continue;
    seen.add(doc.path);
    result.push({
      path: doc.path,
      position: doc.position,
      source: 'skill',
      skill_id: doc.skillId,
      tokens: 0,
      tokens_approximate: false,
      missing: false,
    });
  }

  return result;
}
