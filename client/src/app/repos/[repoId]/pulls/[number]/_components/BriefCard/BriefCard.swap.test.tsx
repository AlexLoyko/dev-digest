/* BriefCard.swap.test.tsx — AC-19. "The system shall treat the arrival of a
   completed agent run as a change of the brief card's headline and colour
   treatment, from describing the PR's risk to describing the review's
   verdict, without regenerating the brief."

   T17/T18 (BriefCard.run.test.tsx / BriefCard.norun.test.tsx) each prove one
   side of this swap in isolation. This file proves the swap itself: the
   SAME fixture brief, rendered once with `latest_run` present and once with
   it absent, must differ ONLY in the headline text and its colour — the
   brief's own `what`/`why` prose must be byte-identical either way, and the
   run's arrival must never trigger a regeneration (the generate mutation's
   endpoint must see zero calls in either render). The fixture is
   deliberately non-stale (`stale: false`) so `useBrief`'s own background
   regeneration effect never fires — see the "Two guards" note in this
   task's brief and `client/src/lib/hooks/brief.ts`'s `stale` guard. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BriefLatestRun, BriefMeta, BriefResponse } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import { BriefCard } from "./BriefCard";
import { BRIEF_CARD_TESTIDS } from "./constants";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BASE_META: BriefMeta = {
  head_sha: "sha-swap-1",
  generated_at: "2026-01-01T00:00:00.000Z",
  provider: "test",
  model: "test-model",
  tokens_in: 100,
  tokens_out: 50,
  cost_usd: 0.01,
  duration_ms: 500,
  input_tokens_measured: true,
  degraded: [],
};

const BASE_RUN: BriefLatestRun = {
  run_id: "run-swap-1",
  verdict: "approve",
  findings_count: 4,
  blockers: 0,
  score: 61,
  cost_usd: 0.045,
  tokens_in: 8200,
  tokens_out: 1300,
  agent_name: "Security Reviewer",
};

/** The one fixture brief both renders share — `risk_level: "medium"` (→
 *  `SEV.WARNING` / `var(--warn)`) deliberately disagrees with `BASE_RUN`'s
 *  `verdict: "approve"` (→ `VERDICT_META.approve` / `var(--ok)`), the same
 *  way `BriefCard.run.test.tsx` picks its fixture — so a passing "headline
 *  and colour differ" assertion proves the swap actually happened rather
 *  than the two systems coincidentally agreeing. */
const FIXTURE_BRIEF = {
  what: "Adds a Redis-backed rate limiter as middleware on every public route.",
  why: "Unauthenticated clients can currently call the public endpoints without limit.",
  risk_level: "medium" as const,
  risks: [],
  review_focus: [],
};

function makeBriefResponse(overrides: Partial<BriefResponse> = {}): BriefResponse {
  return {
    brief: FIXTURE_BRIEF,
    meta: BASE_META,
    stale: false,
    latest_run: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function renderCard(prId: string, response: BriefResponse) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/brief/generate")) {
      throw new Error("unexpected call to the generate mutation's endpoint");
    }
    return jsonResponse(response);
  });
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale="en"
        messages={{ brief: briefMessages, prReview: prReviewMessages }}
      >
        <BriefCard prId={prId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

  return { ...view, fetchMock };
}

async function findRegions() {
  const leading = await screen.findByTestId(BRIEF_CARD_TESTIDS.leading);
  const main = screen.getByTestId(BRIEF_CARD_TESTIDS.main);
  const trailing = screen.getByTestId(BRIEF_CARD_TESTIDS.trailing);
  return { leading, main, trailing };
}

function generateCallCount(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("/brief/generate")).length;
}

describe("BriefCard run-arrival swap (AC-19)", () => {
  it("changes only the headline text and its colour when a completed run arrives — the brief's own prose stays byte-identical, and nothing regenerates", async () => {
    // Same fixture brief, without a completed run.
    const without = renderCard("pr-swap-without-1", makeBriefResponse({ latest_run: null }));
    const withoutRegions = await findRegions();
    const withoutHeadline = within(withoutRegions.main).getByText(
      briefMessages.card.riskLevel.medium,
    ).textContent;
    const withoutLeadingStyle = withoutRegions.leading.getAttribute("style") ?? "";
    const withoutWhat = within(withoutRegions.main).getByText(FIXTURE_BRIEF.what).textContent;
    const withoutWhy = within(withoutRegions.main).getByText(FIXTURE_BRIEF.why).textContent;
    without.unmount();

    // Same fixture brief, now with a completed run attached.
    const withRun = renderCard("pr-swap-with-1", makeBriefResponse({ latest_run: BASE_RUN }));
    const withRegions = await findRegions();
    const withHeadline = within(withRegions.main).getByText(
      prReviewMessages.verdict.approve,
    ).textContent;
    const withLeadingStyle = withRegions.leading.getAttribute("style") ?? "";
    const withWhat = within(withRegions.main).getByText(FIXTURE_BRIEF.what).textContent;
    const withWhy = within(withRegions.main).getByText(FIXTURE_BRIEF.why).textContent;

    // Headline text changed: risk-level copy → verdict copy.
    expect(withoutHeadline).toBe(briefMessages.card.riskLevel.medium);
    expect(withHeadline).toBe(prReviewMessages.verdict.approve);
    expect(withHeadline).not.toBe(withoutHeadline);
    expect(within(withRegions.main).queryByText(briefMessages.card.riskLevel.medium)).not.toBeInTheDocument();
    expect(within(withoutRegions.main).queryByText(prReviewMessages.verdict.approve)).not.toBeInTheDocument();

    // Headline colour changed: `SEV.WARNING` (`var(--warn)`) → the
    // "approve" verdict's own colour (`var(--ok)`), never both/neither.
    expect(withoutLeadingStyle).toContain("var(--warn)");
    expect(withoutLeadingStyle).not.toContain("var(--ok)");
    expect(withLeadingStyle).toContain("var(--ok)");
    expect(withLeadingStyle).not.toContain("var(--warn)");
    expect(withLeadingStyle).not.toBe(withoutLeadingStyle);

    // The brief's own `what`/`why` prose is untouched — byte-identical in
    // both renders, independent of whether a run is present.
    expect(withWhat).toBe(withoutWhat);
    expect(withWhy).toBe(withoutWhy);
    expect(withWhat).toBe(FIXTURE_BRIEF.what);
    expect(withWhy).toBe(FIXTURE_BRIEF.why);

    // The run's arrival never regenerates the brief: zero calls ever reach
    // the generate mutation's endpoint, in either render.
    expect(generateCallCount(without.fetchMock)).toBe(0);
    expect(generateCallCount(withRun.fetchMock)).toBe(0);
  });
});
