import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 5 Claude sessions total.
 *   - 3 × trace     → 1 session each                      = 3
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): CLAUDE.md "Read When" routing + subagent dispatch, together -----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    name: "API-route task reads api-contracts AND pulls the architecture-reviewer",
    prompt:
      "I'm planning to add a NEW, not-yet-implemented endpoint GET /reviews/:id/export (returns the " +
      "review as markdown). First, check this repo's API conventions. Then you MUST launch the " +
      "architecture-reviewer subagent to evaluate my plan against the onion layers — do not review it yourself.",
    expectFilesRead: ["server/docs/api-contracts.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): two "Read When" rows at once -----------------------------------------
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read When" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("figure out how everything is wired") sent the model
    // straight into schema.ts / pipeline.run.ts and it never opened the routed doc. One anchor doc
    // (pipeline.md) keeps this a deterministic routing check — asserting two docs in one session is
    // inherently flaky.
    name: "pipeline task follows CLAUDE.md routing to pipeline.md",
    prompt:
      "I'm about to change the review pipeline. Before touching any code, check this repo's guidance " +
      "(CLAUDE.md) for which docs to read when changing the pipeline, and read exactly those docs.",
    expectFilesRead: ["reviewer-core/docs/pipeline.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): CLAUDE.md "Hit unexpected behavior" routing -> gotchas ----------------
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path and read gotchas.md, making the negative flaky. As a single-session trace it
  // reliably checks the same routing rule: in the real repo, the discovery prompt reads gotchas.md.
  {
    kind: "trace",
    name: "CLAUDE.md routes a gotchas lookup to reviewer-core/insights",
    prompt:
      "In reviewer-core I ran into unexpected behavior — something isn't working the way I expected. " +
      "Per this repo's guidance, where might this already be documented? Read that file.",
    expectFilesRead: ["reviewer-core/insights/gotchas.md"],
    maxTurns: 5,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "I just figured out why the pgvector query was returning zero rows — the column dimension " +
      "didn't match after changing the embedding model. I want to record this so I don't hit it again.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt: "Explain how column dimensions work in pgvector and why a mismatch returns zero rows.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
