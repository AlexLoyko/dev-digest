/* BriefCard.cost.test.tsx — AC-10 (client half; the server half is T8).
   Proves the brief card renders the model, cost and token counts of the
   CALL THAT PRODUCED THE BRIEF (`meta.model` / `meta.cost_usd` /
   `meta.tokens_in` / `meta.tokens_out`) — distinct from `latest_run`'s own
   cost/tokens, which come from a separate agent run against the same PR
   (`BriefCard.run.test.tsx` owns those). The two numbers must never render
   in place of one another: `meta` and `latest_run` are deliberately given
   different cost/token values below so a test that accidentally reads the
   wrong field fails instead of passing by coincidence.

   Token volume convention (AC-22 / spec Q-8): lowercase `k`, e.g.
   `formatTokens(8200, 1300) === "8k→1.3k"` — this supersedes the uppercase
   form shown in the design image. Asserted against `formatTokens`/
   `formatCost` directly (`@/lib/utils/format`) rather than a hardcoded
   string, so this test tracks the convention instead of duplicating it.

   `stale: false` throughout (per `useBrief`'s own gotcha): a stale fixture
   triggers a background regeneration this test isn't about. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BriefLatestRun, BriefMeta, BriefResponse } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import { formatCost, formatTokens } from "@/lib/utils/format";
import { BriefCard } from "./BriefCard";
import { BRIEF_CARD_TESTIDS } from "./constants";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The brief's OWN generation call — deliberately distinct from BASE_RUN's
// numbers below so a mix-up (rendering one in place of the other) fails.
const BASE_META: BriefMeta = {
  head_sha: "sha-1",
  generated_at: "2026-01-01T00:00:00.000Z",
  provider: "test",
  model: "claude-brief-model",
  tokens_in: 8200,
  tokens_out: 1300,
  cost_usd: 0.077,
  duration_ms: 500,
  input_tokens_measured: true,
  degraded: [],
};

// The separate agent run against the same PR — its cost/tokens must never
// stand in for meta's.
const BASE_RUN: BriefLatestRun = {
  run_id: "run-1",
  verdict: "approve",
  findings_count: 4,
  blockers: 2,
  score: 61,
  cost_usd: 0.045,
  tokens_in: 500,
  tokens_out: 200,
  agent_name: "Security Reviewer",
};

function makeBriefResponse(overrides: Partial<BriefResponse> = {}): BriefResponse {
  return {
    brief: {
      what: "Adds a Redis-backed rate limiter as middleware on every public route.",
      why: "Unauthenticated clients can currently call the public endpoints without limit.",
      risk_level: "medium",
      risks: [],
      review_focus: [],
    },
    meta: BASE_META,
    stale: false,
    latest_run: BASE_RUN,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function renderCard(prId: string, response: BriefResponse) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(response)),
  );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider
        locale="en"
        messages={{ brief: briefMessages, prReview: prReviewMessages }}
      >
        <BriefCard prId={prId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

async function findRegions() {
  const leading = await screen.findByTestId(BRIEF_CARD_TESTIDS.leading);
  const main = screen.getByTestId(BRIEF_CARD_TESTIDS.main);
  const trailing = screen.getByTestId(BRIEF_CARD_TESTIDS.trailing);
  return { leading, main, trailing };
}

describe("BriefCard brief-generation cost/tokens (AC-10)", () => {
  it("renders the brief's own model", async () => {
    renderCard("pr-cost-1", makeBriefResponse());
    const { main } = await findRegions();

    expect(within(main).getByText(BASE_META.model)).toBeInTheDocument();
  });

  it("renders the brief's own cost, distinguishable from the run's cost", async () => {
    renderCard("pr-cost-2", makeBriefResponse());
    const { main } = await findRegions();

    // The brief's own cost string must appear...
    expect(within(main).getByText(formatCost(BASE_META.cost_usd))).toBeInTheDocument();
    // ...and the run's cost — a different value by construction — must not
    // be presented as if it were the brief's own cost.
    expect(formatCost(BASE_META.cost_usd)).not.toBe(formatCost(BASE_RUN.cost_usd));
  });

  it("renders the brief's own token volume using the product's lowercase-k convention", async () => {
    renderCard("pr-cost-3", makeBriefResponse());
    const { main } = await findRegions();

    const expected = formatTokens(BASE_META.tokens_in, BASE_META.tokens_out);
    expect(expected).toBe("8k→1.3k");
    expect(within(main).getByText(expected)).toBeInTheDocument();

    // The run's token volume — a different value by construction — must be
    // present somewhere (BriefCard.run.test.tsx's own concern) but never
    // stand in for the brief's own volume.
    const runVolume = formatTokens(BASE_RUN.tokens_in as number, BASE_RUN.tokens_out as number);
    expect(runVolume).not.toBe(expected);
  });

  it("keeps meta's cost/tokens and the run's cost/tokens each in their own place, not swapped", async () => {
    renderCard("pr-cost-4", makeBriefResponse());
    const { main } = await findRegions();

    // The brief's own cost renders in its own isolated `<span>` (this row's
    // convention — see `BriefMetaCostRow`), so it is directly findable on
    // its own.
    expect(within(main).getByText(formatCost(BASE_META.cost_usd))).toBeInTheDocument();
    // The run's cost/tokens render via the PRE-EXISTING run row
    // (`BriefCard.run.test.tsx`'s own convention, not this file's to
    // restructure): unwrapped sibling text inside one `<p>`, findable only
    // as its one full concatenated string — an isolation requirement on
    // that row can't coexist with `run.test.tsx`'s own single-string
    // assertion (they'd need contradictory DOM shapes). Asserting the whole
    // row still proves the run's cost/tokens are both present and are the
    // run's OWN numbers, not the brief's.
    expect(
      within(main).getByText(
        `${formatCost(BASE_RUN.cost_usd)} · ${formatTokens(BASE_RUN.tokens_in as number, BASE_RUN.tokens_out as number)}`,
      ),
    ).toBeInTheDocument();

    // Neither value stands in for the other: they differ by construction,
    // and a swap (meta's row showing the run's cost, or vice versa) would
    // fail one of the two `getByText` calls above outright.
    expect(formatCost(BASE_META.cost_usd)).not.toBe(formatCost(BASE_RUN.cost_usd));
  });
});
