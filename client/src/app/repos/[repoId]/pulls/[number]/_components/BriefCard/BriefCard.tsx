/* BriefCard — the PR brief's fixed three-region anatomy (AC-20): a leading
   40x40 status region, a flexible main column, and a trailing region. All
   three are present in EVERY state this component renders, so the main
   column's measure never changes as the card moves between states — the
   reservation `Failed.dc.html` documents for the trailing region is the
   requirement, not decoration.

   T16 owns the loaded-with-brief state; T31 (this task) owns the
   never-generated state below. Later, sequential tasks add their own
   branches to this same file (run-derived headline/chip/score: T17;
   no-completed-run copy: T18; in-progress: T19; regen-disable rules: T20;
   failure: T21) — each adding a branch, never touching the three-region
   anatomy itself. */
"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, CircularScore, Icon, IconBtn, SEV, Skeleton } from "@devdigest/ui";
import type { BriefDegradation, BriefLatestRun, BriefMeta } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useBrief, useGenerateBrief } from "@/lib/hooks";
import { formatCost, formatTokens } from "@/lib/utils/format";
import { riskLevelToSeverity } from "@/lib/utils/riskSeverity";
import { VERDICT_META } from "../VerdictBanner/constants";
import { s as verdictStyles } from "../VerdictBanner/styles";
import { BRIEF_CARD_TESTIDS } from "./constants";
import { s } from "./styles";

/** Neutral informational treatment for the never-generated state's leading
 *  icon box (AC-23) — matches `design/states/NoBriefYet.dc.html` exactly.
 *  Deliberately NOT a `SEV`/risk tint and NOT a verdict tint: nothing has
 *  been generated, so there is nothing to grade yet. */
const NEUTRAL_BG = "rgba(107,114,128,0.12)";
const NEUTRAL_FG = "#6b7280";

/** Informational (in-progress) treatment for the leading icon while a brief
 *  is actively generating (AC-18), no earlier brief on screen yet — matches
 *  `design/states/Main.dc.html` exactly. Distinct from `NEUTRAL_*` (which
 *  reads "nothing to grade") and from any risk/verdict tint (which reads
 *  "graded") — this one reads "in progress right now". */
const GENERATING_BG = "rgba(59,130,246,0.12)";
const GENERATING_FG = "#93bbfc";

/** Positions the "Generate brief" control 14px below the explanatory line —
 *  the same slot the failed states (`Failed.dc.html`) reserve for
 *  "Try again". Module-level: a static object, not recreated on render. */
const generateCtaWrap: CSSProperties = { marginTop: 14 };

/** Two placeholder bars where the prose will land once generation finishes
 *  (AC-18, no-earlier-brief branch) — `design/states/Main.dc.html`'s exact
 *  layout. Module-level: a static object, not recreated on render. */
const generatingSkeletonWrap: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  marginTop: 12,
};

/** Reduced-emphasis treatment for a superseded-but-not-hidden brief while a
 *  newer generation is in flight (AC-18 / EC-2) — a dimmed brief still
 *  beats no brief at all, so this only ever adds `opacity`, never swaps
 *  content for a placeholder. Module-level: a static object, spread onto
 *  each dimmed element's own style rather than wrapping them in an extra
 *  DOM node, so it never disturbs the surrounding flex layout/gaps. */
const dimStyle: CSSProperties = { opacity: 0.5 };

/** The brief's OWN generation cost/token meta row (AC-10) — the fully muted,
 *  supplementary line of the bottom-right cost block: same muted treatment
 *  as `s.why`, one step more muted than the run's own cost row below
 *  (`runCostRow`), which is the primary, design-styled line. `styles.ts` is
 *  this task's own owned file too, so a shared style there would work
 *  equally well — this stays local per the established pattern for
 *  BriefCard-only, single-consumer styles. Renders in the bottom-right cost
 *  block of the TRAILING region (`design/01-loaded-overview.png`), beneath
 *  the run's own line — not in the main column under the prose, which is
 *  where an earlier instruction mistakenly placed it. */
const runMetaRow: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  marginTop: 2,
};

/** The run's own cost/token line (AC-12) — the bottom-right cost block's
 *  PRIMARY, design-styled line (`design/01-loaded-overview.png`): a muted
 *  `$` glyph, the amount in the product's positive/success tone
 *  (`var(--ok)` — confirmed the correct green token for this codebase,
 *  never `var(--success)`/`var(--green)`, which don't exist), and the token
 *  volume in muted grey. `formatCost` stays the single source of the cost
 *  string (AC-22) — this only splits its already-formatted output
 *  (`"$0.045"`) into its `$` and numeric parts for per-piece styling, never
 *  reformats the number itself. Falls back to an all-muted `formatCost`
 *  output (e.g. "n/a") when the provider didn't report a cost — a
 *  positive/green tint on "n/a" would misread as a real, favourable number. */
const runCostRow: CSSProperties = { fontSize: 12, marginTop: 0 };

function splitRunCost(costUsd: number | null): { symbol: string; amount: string } {
  const formatted = formatCost(costUsd);
  return formatted.startsWith("$")
    ? { symbol: "$", amount: formatted.slice(1) }
    : { symbol: "", amount: formatted };
}

function RunCostRow({ run, dim }: { run: BriefLatestRun; dim: boolean }) {
  const { symbol, amount } = splitRunCost(run.cost_usd);
  return (
    <p style={{ ...runCostRow, ...(dim ? dimStyle : {}) }}>
      <span style={{ color: "var(--text-muted)" }}>{symbol}</span>
      <span style={{ color: symbol ? "var(--ok)" : "var(--text-muted)" }}>{amount}</span>
      <span style={{ color: "var(--text-muted)" }}> · {tokensLabel(run)}</span>
    </p>
  );
}

/** Visual footprint of `IconBtn` (`client/src/vendor/ui/primitives/IconBtn.tsx`)
 *  reproduced locally for the disabled state (AC-11) — that primitive has no
 *  `disabled`/`loading` prop and is not this task's to edit. `cursor:
 *  not-allowed` plus a muted, non-interactive-looking colour signal the same
 *  thing a real `disabled` attribute enforces underneath: this is not a
 *  spend control right now. Module-level: a static object, not recreated on
 *  render. */
const disabledRegenerateBtn: CSSProperties = {
  width: 30,
  height: 30,
  display: "inline-grid",
  placeItems: "center",
  borderRadius: 6,
  border: "1px solid transparent",
  background: "transparent",
  color: "var(--text-muted)",
  opacity: 0.5,
  cursor: "not-allowed",
};

/** The regenerate control (AC-11 / NFR: "the disabled state is a real spend
 *  control, not decoration"), used only in the no-earlier-brief in-progress
 *  branch — `design/states/Main.dc.html`'s exact treatment: a genuinely
 *  non-actionable `<button disabled>`, no `onClick` wired at all, so there
 *  is no handler for a click to ever reach. The with-earlier-brief
 *  in-progress branch does NOT use this component — `design/states/
 *  Stale.dc.html` draws that case with the control removed entirely, not
 *  disabled, so that branch renders nothing in its place instead (see the
 *  trailing region below). Outside a generation, this is exactly the
 *  pre-existing live `IconBtn`, unchanged. */
function RegenerateControl({
  generating,
  label,
  onClick,
}: {
  generating: boolean;
  label: string;
  onClick: () => void;
}) {
  if (generating) {
    return (
      <button type="button" aria-label={label} title={label} disabled style={disabledRegenerateBtn}>
        <Icon.RefreshCw size={16} />
      </button>
    );
  }
  return <IconBtn icon="RefreshCw" label={label} onClick={onClick} />;
}

interface BriefCardProps {
  prId: string | number | null;
  /** Not read yet — threaded through for the review-focus-style file links
   *  a later task adds here. `OverviewTab` doesn't have these to pass until
   *  T27 wires them up. */
  repoFullName?: string | null;
  headSha?: string | null;
}

/** One line per degraded input, for the degradation badge's `title`
 *  tooltip — a single badge regardless of how many inputs degraded
 *  (AC-14/AC-15). */
function degradedTitle(
  t: (key: string) => string,
  degraded: readonly BriefDegradation[],
): string {
  return degraded.map((d) => t(`card.degraded.${d.input}.${d.action}`)).join("\n");
}

/** The run's token volume, or "–" when the provider didn't report token
 *  counts (`BriefLatestRun.tokens_in`/`tokens_out` are independently
 *  nullable — see `contracts/brief.ts`). Lowercase `k` suffix per
 *  `formatTokens`'s own convention (AC-22) — never "corrected" to uppercase. */
function tokensLabel(run: BriefLatestRun): string {
  return run.tokens_in != null && run.tokens_out != null
    ? formatTokens(run.tokens_in, run.tokens_out)
    : "–";
}

/** The brief's OWN generation model/cost/tokens (AC-10) — `data.meta`, never
 *  `latest_run` (a separate call against the same PR; `BriefLatestRun`'s own
 *  cost/tokens render via the design-styled `RunCostRow` ABOVE this row,
 *  untouched). Model, cost and token volume are each their own element
 *  rather than one concatenated string, so each is independently findable
 *  by exact text (`BriefCard.cost.test.tsx`) without colliding with the
 *  run's row, which already owns the single-concatenated-string convention.
 *  Gated on `data.meta` ALONE (not `run && data.meta`) — the brief's own
 *  generation is a metered, paid call independent of whether any agent run
 *  has ever completed, so a PR with a brief but no completed run (or even no
 *  run attempt at all) still shows what that brief cost.
 *  `BriefCard.norun.test.tsx`'s absence assertion is scoped to THE RUN'S
 *  data specifically (finding/blocker counts, score, the run's own
 *  concatenated cost/token row) and does not forbid this row. Renders in the
 *  bottom-right cost block of the TRAILING region, beneath the run's own
 *  `RunCostRow` — the supplementary, more-muted line carrying the model name
 *  (`design/01-loaded-overview.png` shows a single cost line for the run
 *  only; this second line predates that image, added for AC-10, which is
 *  why it reads secondary rather than matching the image 1:1). */
function BriefMetaCostRow({ meta, dim }: { meta: BriefMeta; dim: boolean }) {
  return (
    <p style={{ ...runMetaRow, ...(dim ? dimStyle : {}) }}>
      <span>{meta.model}</span> · <span>{formatCost(meta.cost_usd)}</span> ·{" "}
      <span>{formatTokens(meta.tokens_in, meta.tokens_out)}</span>
    </p>
  );
}

/** The known `reason` values `POST /pulls/:id/brief/generate` can fail with
 *  (`server/docs/api-contracts.md`) — the only two keys `brief.json`'s
 *  `card.failure.cause.*` block defines copy for. */
const FAILURE_CAUSE_REASONS = ["model_error", "invalid_result"] as const;
type FailureCauseReason = (typeof FAILURE_CAUSE_REASONS)[number];

function isFailureCauseReason(reason: string | undefined): reason is FailureCauseReason {
  return reason !== undefined && (FAILURE_CAUSE_REASONS as readonly string[]).includes(reason);
}

/** The failure branches' plain-language cause (AC-16). `generateBrief`'s
 *  POST failure body is the discriminated `{reason, hasPriorBrief}` shape
 *  (`server/docs/api-contracts.md`), and `apiFetch` (`client/src/lib/
 *  api.ts`) preserves it on `ApiError.body` even though it isn't
 *  `{error: {...}}`-wrapped. `brief.json`'s `card.failure.cause.*` has copy
 *  for both known reasons, so a recognised `error.body?.reason` resolves to
 *  a plain-language sentence a reviewer can act on, indexed by reason —
 *  never a mapping table. Falls back to `error.message` — `apiFetch`'s own
 *  real message when the body IS `{error: {...}}`-wrapped, or its generic
 *  `"${status} ${statusText}"` line otherwise — for an unrecognised or
 *  missing reason, so an unexpected status, a network failure, or a
 *  non-JSON body never renders blank or a bare translation key. Falls back
 *  further to the app's own generic error copy (`common.states.error`,
 *  already used the same way by `ContextTab`'s and `SkillEditor`'s error
 *  states) only when `error` isn't the `ApiError` shape `generateBrief`
 *  throws at all. */
function failureCause(
  error: unknown,
  t: (key: string) => string,
  tCommon: (key: string) => string,
): string {
  if (!(error instanceof ApiError)) return tCommon("states.error");
  if (isFailureCauseReason(error.body?.reason)) {
    return t(`card.failure.cause.${error.body.reason}`);
  }
  return error.message;
}

export function BriefCard({ prId }: BriefCardProps) {
  const t = useTranslations("brief");
  // `VERDICT_META`'s `labelKey`s resolve under `prReview`'s own `verdict`
  // namespace (same namespace `VerdictBanner` reads them from) — brief.json
  // has no verdict copy of its own, and duplicating it there isn't this
  // task's call to make.
  const tVerdict = useTranslations("prReview");
  // Only for `failureCause`'s fallback (AC-16) — `brief.json` has no generic
  // "something went wrong" copy of its own, and this task's own gotcha says
  // not to add one under `card.failure.*`.
  const tCommon = useTranslations("common");
  const { data, isGenerating } = useBrief(prId);
  const generate = useGenerateBrief(prId);

  // The initial fetch hasn't resolved yet — `data` is `undefined` whether a
  // brief exists or not, so this is neither "loaded" nor "never generated"
  // (AC-23 needs a confirmed empty result). Render nothing rather than
  // flashing the never-generated state during every load, same as before
  // this task's branch existed.
  if (data === undefined) return null;

  const brief = data.brief;

  // Never-generated state (AC-23): the fetch resolved and no brief has ever
  // been produced for this PR. `useBrief` never auto-generates here — only
  // a stale brief triggers a background regeneration
  // (`src/lib/hooks/brief.ts`) — so this is the only place a first brief
  // ever gets made, via the explicit control below.
  if (!brief) {
    // In-progress, no earlier brief (AC-18, AC-23's own sibling state):
    // `useGenerateBrief`'s mutation is the only thing that can ever produce
    // a first brief (`useBrief` never auto-generates on a missing one — see
    // the hook's own comment), so its `isPending` flag is exactly "a
    // generation is under way right now" here — no server-side status field
    // to poll. Placeholders only: there is no earlier content to fall back
    // to, so nothing to dim.
    if (generate.isPending) {
      return (
        <div style={verdictStyles.wrap}>
          <div
            data-testid={BRIEF_CARD_TESTIDS.leading}
            style={verdictStyles.iconBox(GENERATING_BG, GENERATING_FG)}
          >
            <Icon.RefreshCw size={22} className="animate-spin" />
          </div>

          {/* `aria-live="polite"` here (and on the loaded branch's `main`
             below) is what announces completion (AC-18's own text) — no
             separate announcement string to maintain: whatever this region's
             content becomes once generation finishes is what gets read out,
             the same way any other live-region content change would be. */}
          <div data-testid={BRIEF_CARD_TESTIDS.main} style={verdictStyles.main} aria-live="polite">
            <div style={verdictStyles.titleRow}>
              <span style={verdictStyles.label("var(--text-primary)")}>{t("card.generating.headline")}</span>
              <Badge>{t("card.generating.chip")}</Badge>
            </div>
            <div style={generatingSkeletonWrap}>
              <Skeleton height={14} width="100%" />
              <Skeleton height={14} width="62%" />
            </div>
          </div>

          {/* `aria-hidden` stays on this wrapper unchanged from the
             never-generated state's own empty trailing region — a real
             `disabled` control needs no accessible name of its own (it is
             not reachable either way), and `BriefCard.progress.test.tsx`
             already asserts this exact attribute on this exact testid. The
             disabled button inside is a purely visual affordance matching
             `design/states/Main.dc.html` (AC-11's "present but disabled"
             branch — there is no earlier brief here, so nothing else could
             ever occupy this region). */}
          <div data-testid={BRIEF_CARD_TESTIDS.trailing} style={s.trailing} aria-hidden="true">
            <RegenerateControl generating label={t("card.regenerateAriaLabel")} onClick={() => generate.mutate()} />
          </div>
        </div>
      );
    }

    // Failure, no earlier brief on screen (AC-16, `design/states/
    // Failed.dc.html`): the one generation attempt that could ever have
    // produced a first brief just failed. `hasPriorBrief` is false by
    // construction here — this whole block is already inside `!brief` — so
    // there is nothing to fall back to, no chip, and no score ring.
    // Recovery is the inline "Try again" `<Button>` alone; the trailing
    // region stays reserved-but-empty and `aria-hidden`, exactly like the
    // plain never-generated state below, so the main column's measure never
    // shifts between the two.
    if (generate.isError) {
      return (
        <div style={verdictStyles.wrap} role="alert">
          <div
            data-testid={BRIEF_CARD_TESTIDS.leading}
            style={verdictStyles.iconBox(SEV.CRITICAL.bg, SEV.CRITICAL.c)}
          >
            <Icon.AlertOctagon size={22} />
          </div>

          <div data-testid={BRIEF_CARD_TESTIDS.main} style={verdictStyles.main}>
            <div style={verdictStyles.titleRow}>
              <span style={verdictStyles.label("var(--text-primary)")}>{t("card.failure.headline")}</span>
            </div>
            <p style={verdictStyles.summary}>{failureCause(generate.error, t, tCommon)}</p>
            {/* `card.failure.noPriorBrief` is purpose-written for this
               branch — not `card.noBrief.body`, which is an invitation
               ("what a brief reads") that belongs to the never-generated
               state below, not to a failure. This line states the one
               remaining fact AC-16 requires here: there is no earlier
               brief to fall back on. */}
            <p style={verdictStyles.summary}>{t("card.failure.noPriorBrief")}</p>
            <div style={generateCtaWrap}>
              <Button kind="secondary" icon="RefreshCw" onClick={() => generate.mutate()}>
                {t("card.failure.retry")}
              </Button>
            </div>
          </div>

          <div data-testid={BRIEF_CARD_TESTIDS.trailing} style={s.trailing} aria-hidden="true" />
        </div>
      );
    }

    return (
      <div style={verdictStyles.wrap}>
        <div data-testid={BRIEF_CARD_TESTIDS.leading} style={verdictStyles.iconBox(NEUTRAL_BG, NEUTRAL_FG)}>
          <Icon.FileText size={22} />
        </div>

        <div data-testid={BRIEF_CARD_TESTIDS.main} style={verdictStyles.main}>
          <div style={verdictStyles.titleRow}>
            <span style={verdictStyles.label("var(--text-primary)")}>{t("card.noBrief.headline")}</span>
          </div>
          <p style={verdictStyles.summary}>{t("card.noBrief.body")}</p>
          <div style={generateCtaWrap}>
            <Button
              kind="primary"
              icon="Sparkles"
              loading={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {t("card.noBrief.cta")}
            </Button>
          </div>
        </div>

        <div data-testid={BRIEF_CARD_TESTIDS.trailing} style={s.trailing} aria-hidden="true" />
      </div>
    );
  }

  const severity = riskLevelToSeverity(brief.risk_level);
  const sev = SEV[severity];
  const degraded = data?.meta?.degraded ?? [];

  // AC-12: once at least one completed agent run exists, its verdict takes
  // over the headline and colour treatment IN PLACE OF the risk level — the
  // risk level (`sev`) stays the fallback for a briefed-but-never-reviewed
  // PR, same shape `VerdictBanner` already uses for its own icon/label.
  const run = data.latest_run;
  const verdictMeta = run ? VERDICT_META[run.verdict] : null;
  const headlineColor = verdictMeta?.c ?? sev.c;
  const headlineBg = verdictMeta?.bg ?? sev.bg;
  const HeadlineIcon = Icon[verdictMeta?.icon ?? sev.icon];
  const headline = verdictMeta
    ? tVerdict(`verdict.${verdictMeta.labelKey}`)
    : t(`card.riskLevel.${brief.risk_level}`);

  // In-progress, WITH an earlier brief (AC-18 / EC-2): "a generation is
  // under way" is `useBrief`'s unified `isGenerating` signal — true while
  // EITHER a call this component itself started (`generate`, the
  // regenerate control below) OR `useBrief`'s own background call for a
  // stale brief is in flight — NOT `data.stale`. Staleness is only the
  // REASON a generation may have started; it is not evidence that one is
  // running right now. Gating on staleness alone means a manual regenerate
  // of a non-stale brief renders as idle while a call is in flight, and a
  // failed stale-triggered regeneration spins forever since `stale` never
  // clears itself. Gating on `generate.isPending` alone means the far more
  // common path — the PR's head moving, which triggers `useBrief`'s own
  // background regeneration with no click involved — renders as idle while
  // a paid generation runs. `stale` is kept only to choose which
  // full-emphasis chip copy to show while `generating` is true. A
  // superseded brief still beats no brief at all, so every element below
  // stays mounted and readable; only `dimStyle` changes, spread onto each
  // dimmed element's own style rather than an extra wrapping node, so none
  // of the flex layout/gaps this anatomy depends on (T16/T17) shift
  // underneath it.
  const stale = data.stale;
  const generating = isGenerating;

  // Failure, WITH an earlier brief on screen (AC-16, `design/states/
  // FailedWithPrior.dc.html`): the failed attempt is THIS component's own
  // `generate` mutation — `!generating` excludes the case where a
  // DIFFERENT generation (a fresh manual click, or the hook's own
  // background regeneration for newer commits) is already superseding this
  // stale error, which must show the in-progress treatment instead.
  // Nothing is written on a failed generation (server contract, AC-16), so
  // `brief`/`run` here are still exactly what was on screen before the
  // attempt — a brief already being rendered at all IS "a prior brief
  // exists" (`hasPriorBrief`); no field from the failure response body is
  // needed to know that. Recovery is the inline "Try again" alone — the
  // trailing region's own regenerate `IconBtn` is never rendered here
  // alongside it, so there is only ever one recovery affordance on screen.
  if (generate.isError && !generating) {
    return (
      <div style={verdictStyles.wrap} role="alert">
        <div
          data-testid={BRIEF_CARD_TESTIDS.leading}
          style={{ ...verdictStyles.iconBox(headlineBg, headlineColor), ...dimStyle }}
        >
          <HeadlineIcon size={22} />
        </div>

        <div data-testid={BRIEF_CARD_TESTIDS.main} style={verdictStyles.main}>
          <div style={verdictStyles.titleRow}>
            <span style={{ ...verdictStyles.label(headlineColor), ...dimStyle }}>{headline}</span>
            {/* Full emphasis (no `dimStyle`) — this is the one thing on
               screen that must NOT read as secondary: the earlier brief is
               dimmed precisely because this chip, not it, is now the point. */}
            <Badge color={SEV.CRITICAL.c} bg={SEV.CRITICAL.bg}>
              <Icon.AlertOctagon size={12} />
              {t("card.failure.chipWithPrior")}
            </Badge>
          </div>
          <p style={{ ...s.what, ...dimStyle }}>{brief.what}</p>
          <p style={{ ...s.why, ...dimStyle }}>{brief.why}</p>
          {/* AC-16's cause clause (before the em-dash) binds BOTH failure
             branches, not just the no-prior one — the with-prior chip above
             states THAT an update failed and WHAT is shown instead, but
             never WHY, so a transient blip and a persistently-broken model
             read identically. Same `failureCause()` call as the no-prior
             branch, same reason-keyed `card.failure.cause.*` copy — kept at
             full emphasis (no `dimStyle`) like the chip above it, since this
             is new information about the failure, not part of the dimmed
             earlier brief; still visually subordinate to the chip by virtue
             of reading order and `s.why`'s already-muted treatment. */}
          <p style={s.why}>{failureCause(generate.error, t, tCommon)}</p>
          <div style={generateCtaWrap}>
            <Button kind="secondary" icon="RefreshCw" onClick={() => generate.mutate()}>
              {t("card.failure.retry")}
            </Button>
          </div>
        </div>

        {/* No regenerate control here (AC-16): the inline "Try again" above
           is the only recovery affordance, so the trailing region's top slot
           stays empty — only the score group (middle) and the brief's own
           cost line (bottom) render. */}
        <div data-testid={BRIEF_CARD_TESTIDS.trailing} style={s.trailing}>
          {run?.score != null && (
            <div style={s.scoreGroup}>
              <div
                role="img"
                aria-label={t("card.score.accessibleLabel", { score: run.score })}
                style={dimStyle}
              >
                <CircularScore score={run.score} size={52} stroke={5} />
              </div>
              <span style={{ ...s.scoreLabel, ...dimStyle }}>{t("card.score.label")}</span>
            </div>
          )}
          {data.meta && (
            <div style={s.costGroup}>
              <BriefMetaCostRow meta={data.meta} dim />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={verdictStyles.wrap}>
      <div
        data-testid={BRIEF_CARD_TESTIDS.leading}
        style={{ ...verdictStyles.iconBox(headlineBg, headlineColor), ...(generating ? dimStyle : {}) }}
      >
        <HeadlineIcon size={22} />
      </div>

      {/* `aria-live="polite"` announces completion (AC-18): whatever this
         region's content becomes once the regeneration settles — the fresh,
         full-emphasis headline/chip replacing the dimmed ones below — is
         what gets read out, the same way any other live-region content
         change would be. No separate announcement string to add or
         maintain. */}
      <div data-testid={BRIEF_CARD_TESTIDS.main} style={verdictStyles.main} aria-live="polite">
        <div style={verdictStyles.titleRow}>
          <span style={{ ...verdictStyles.label(headlineColor), ...(generating ? dimStyle : {}) }}>{headline}</span>
          {generating ? (
            // Full-emphasis "updating"/"generating" chip (EC-2) stands in
            // for the findings/no-run/degraded chips while a regeneration
            // is under way — those describe the SUPERSEDED brief's own
            // state, which is secondary to "this is about to change" right
            // now. `stale` only picks the copy: the "new commits" framing
            // when that's what triggered this run, the generic generating
            // copy otherwise (e.g. a manual regenerate of a fresh brief).
            <Badge color={SEV.WARNING.c} bg={SEV.WARNING.bg}>
              <Icon.RefreshCw size={12} className="animate-spin" />
              {stale ? t("card.stale.chip") : t("card.generating.chip")}
            </Badge>
          ) : run ? (
            <Badge color="var(--text-secondary)">
              {t("card.findingsCount", { count: run.findings_count })}
              {run.blockers > 0 ? t("card.blockers", { count: run.blockers }) : ""}
            </Badge>
          ) : (
            // No-completed-run state (AC-13): a failed run also lands here —
            // `selectLatestCompletedRun` (server-side) excludes any run that
            // isn't a terminal success, so `latest_run` is `null` for both
            // "never reviewed" and "the one review that ran, failed". Either
            // way there is no score/finding/cost data to show — just the
            // fact that no review has completed yet.
            <Badge>{t("card.noRun.chip")}</Badge>
          )}
          {!generating && degraded.length > 0 && (
            // `Badge` (vendor/ui, never modified here) has no `title` prop —
            // wrap it instead of forking the primitive for one tooltip.
            <span title={degradedTitle(t, degraded)}>
              <Badge color="var(--text-muted)">{t("card.degraded.badge")}</Badge>
            </span>
          )}
        </div>
        <p style={{ ...s.what, ...(generating ? dimStyle : {}) }}>{brief.what}</p>
        <p style={{ ...s.why, ...(generating ? dimStyle : {}) }}>{brief.why}</p>
      </div>

      {/* The trailing region distributes across the card's full height
         (`s.trailing`'s `justifyContent: "space-between"` + `alignSelf:
         "stretch"`) instead of crowding everything against the ring, per
         `design/01-loaded-overview.png`: the regenerate control at the top,
         the score ring with its label in the middle, and the cost block
         pinned to the bottom-right at the bottom — the layout an earlier
         instruction mistakenly collapsed into one crowded stack beneath the
         "PR score" label. */}
      <div data-testid={BRIEF_CARD_TESTIDS.trailing} style={s.trailing}>
        {/* AC-11 / `design/states/Stale.dc.html`: TOP of the trailing
           column, above the score ring. While a generation is in flight,
           the control is removed from this branch entirely — not merely
           disabled — matching the artboard for "an earlier brief exists and
           a regeneration is under way" exactly. Removing it must never
           collapse the trailing region itself (AC-20): the score ring and
           cost block below still hold this region's footprint. Outside a
           generation, this is the pre-existing live `IconBtn`, carrying its
           accessible name from the catalogue rather than the icon alone. */}
        {!generating && (
          <IconBtn
            icon="RefreshCw"
            label={t("card.regenerateAriaLabel")}
            onClick={() => generate.mutate()}
          />
        )}
        {run?.score != null && (
          // MIDDLE of the trailing column: the score ring with its label
          // beneath it, grouped so `s.trailing`'s `justifyContent:
          // space-between` treats the pair as one item and never splits
          // them apart.
          <div style={s.scoreGroup}>
            {/* A visually-hidden-equivalent text alternative for the score
               ring, via `role="img"` + `aria-label` — never editing the
               shared `CircularScore` primitive, since `VerdictBanner` also
               renders it and has no such need. */}
            <div
              role="img"
              aria-label={t("card.score.accessibleLabel", { score: run.score })}
              style={generating ? dimStyle : undefined}
            >
              <CircularScore score={run.score} size={52} stroke={5} />
            </div>
            <span style={{ ...s.scoreLabel, ...(generating ? dimStyle : {}) }}>
              {t("card.score.label")}
            </span>
          </div>
        )}
        {/* BOTTOM of the trailing column, pinned to the card's bottom-right
           corner (`s.costGroup`'s `alignSelf: "flex-end"` plus being the
           last item under `s.trailing`'s `justifyContent: space-between`).
           Two distinct cost/token lines (AC-10 / AC-12), stacked: the run's
           own line (`RunCostRow`, design-styled — muted `$`, positive/green
           amount, muted token volume) reads as PRIMARY, and the brief's own
           generation cost (`data.meta`, gated on `data.meta` alone, never
           `run && data.meta` — AC-10, a brief is a paid call, including one
           triggered automatically with no click, so its cost must stay
           visible even with no completed run) reads as SUPPLEMENTARY below
           it, more muted and carrying its model name. Neither ever stands
           in for the other (`BriefCard.cost.test.tsx` /
           `BriefCard.run.test.tsx`). Both dim via the same per-element
           `dimStyle` spread as everything else here — never a wrapping
           node, so no flex gap collapses. */}
        <div style={s.costGroup}>
          {run && <RunCostRow run={run} dim={generating} />}
          {data.meta && <BriefMetaCostRow meta={data.meta} dim={generating} />}
        </div>
      </div>
    </div>
  );
}
