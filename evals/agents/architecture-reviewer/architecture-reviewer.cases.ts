import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("checkout-service.diff")}`;

// A second real diff whose violations map onto DevDigest-SPECIFIC rule names
// (`reviewer-core-zero-io`, `reviewer-core-ground-findings-gate`) that a competent model will
// describe in prose but will not spontaneously name unless the agent forces a citation. This is
// the discriminating case for the strict-vs-lite A/B: both variants should FIND both problems,
// but only the strict variant (which keeps the "cite the exact documented rule per finding" hard
// rule) should reliably emit the identifier. The checkout diff's textbook violations don't
// discriminate — the model volunteers `inward-only-dependencies`/`di-wiring-drift` either way.
//
// NOTE: `reviewer-core-zero-io` is one of the three mechanical rules the agent's own prompt
// explicitly delegates to `scripts/arch-check.sh` ("do not re-derive those three rules by hand" —
// see architecture-reviewer.md's "What you do NOT check"). Since this eval only pastes diff text
// into the prompt (it never applies the diff to a working tree), the script cannot see the
// violation either. So the practice below accepts either the exact rule id OR an explicit note
// that this is the zero-I/O rule normally enforced by arch-check.sh — both are grounded, correct
// behavior; only silence or mislabeling under an unrelated rule should fail it.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation of the inward-only dependency rule between Domain and Presentation layers",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of DI wiring (concrete adapters/repositories must be constructed only in the composition root / container, not instantiated directly in a service)",
      "names the specific documented rule identifier for EVERY finding (e.g. `inward-only-dependencies`, `di-wiring-drift`) rather than describing the problem only in prose",
      "assigns a severity (critical/high/medium/low/info) to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      // A second finding for the `reply?: FastifyReply` parameter is fine — it's a distinct line
      // that's a second instance of the SAME inward-only-dependencies violation (a Fastify type
      // leaking into the domain function signature). What must not happen is inventing an
      // unrelated rule for it (e.g. `business-logic-in-routes` on a non-route file) or a
      // runtime/security-flavored finding (unused param, null-safety, injection) dressed up as an
      // architecture violation.
      "every finding about the `reply?: FastifyReply` parameter, if reported separately from the import, is cited under `inward-only-dependencies` (or merged into that same finding) — not under an unrelated or inapplicable rule, and not as a runtime bug or security finding",
      "stays scoped to structural/layering/DI findings and does not comment on naming, style, or test coverage",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the DevDigest-specific rule identifier for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/review/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that reviewPullRequest now builds `ground` from `merged.findings` directly instead of calling `groundFindings()`, skipping the mandatory grounding gate before emitting findings",
      "for the fs-import finding, either names the exact documented rule identifier `reviewer-core-zero-io`, OR explicitly states this is the zero-I/O rule normally enforced mechanically by `scripts/arch-check.sh` — either counts; only silence or citing an unrelated rule (e.g. `inward-only-dependencies`) fails this",
      "names the exact documented rule identifier `reviewer-core-ground-findings-gate` for the skipped-gate finding rather than only describing it in prose",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit PASS/FAIL gate verdict based on whether any critical or high findings exist",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign rename (or records only `info`-level, non-blocking observations) — it does not invent a critical/high/medium finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
