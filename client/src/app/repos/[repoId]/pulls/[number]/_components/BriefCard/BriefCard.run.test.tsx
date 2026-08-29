/* BriefCard.run.test.tsx — AC-12. Proves the run-derived elements T17 adds
   to the loaded-with-brief state (T16's anatomy stays untouched — see
   BriefCard.anatomy.test.tsx): when `latest_run` is present, the headline
   text and colour come from `VERDICT_META[verdict]` IN PLACE OF the risk
   level, the header chip carries the finding/blocker counts, the trailing
   region gets a `CircularScore` under the "PR score" label with an
   accessible text equivalent, and a muted meta row renders the run's cost
   and token volume via `formatCost`/`formatTokens`. */
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

const BASE_META: BriefMeta = {
  head_sha: "sha-1",
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
  run_id: "run-1",
  verdict: "approve",
  findings_count: 4,
  blockers: 2,
  score: 61,
  cost_usd: 0.045,
  tokens_in: 8200,
  tokens_out: 1300,
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

describe("BriefCard run-derived elements (AC-12)", () => {
  it("takes the headline text and colour from the run's verdict, not the risk level", async () => {
    renderCard("pr-run-1", makeBriefResponse());
    const { leading, main } = await findRegions();

    // `latest_run.verdict` is "approve" while `brief.risk_level` is
    // "medium" — the two colour/label systems disagree by construction, so
    // seeing the verdict's copy/colour and NOT the risk level's proves the
    // substitution, not a coincidence of shared wording.
    expect(within(main).getByText(prReviewMessages.verdict.approve)).toBeInTheDocument();
    expect(within(main).queryByText(briefMessages.card.riskLevel.medium)).not.toBeInTheDocument();

    const leadingStyle = leading.getAttribute("style") ?? "";
    expect(leadingStyle).toContain("var(--ok)");
    expect(leadingStyle).not.toContain("var(--warn)");
  });

  it("shows the run's finding and blocker counts in the header chip", async () => {
    renderCard("pr-run-2", makeBriefResponse());
    const { main } = await findRegions();

    expect(
      within(main).getByText(
        (_, node) =>
          node?.textContent ===
          `${prReviewMessages.verdict.findingsCount.replace("{count}", "4")}${prReviewMessages.verdict.blockers.replace("{count}", "2")}`,
      ),
    ).toBeInTheDocument();
  });

  it("omits the blockers suffix when the run has no blockers", async () => {
    renderCard("pr-run-3", makeBriefResponse({ latest_run: { ...BASE_RUN, blockers: 0 } }));
    const { main } = await findRegions();

    expect(
      within(main).getByText(briefMessages.card.findingsCount.replace("{count}", "4")),
    ).toBeInTheDocument();
  });

  it("renders the score ring under the 'PR score' label, with an accessible text equivalent", async () => {
    renderCard("pr-run-4", makeBriefResponse());
    const { trailing } = await findRegions();

    expect(
      within(trailing).getByRole("img", {
        name: briefMessages.card.score.accessibleLabel.replace("{score}", "61"),
      }),
    ).toBeInTheDocument();
    expect(within(trailing).getByText("61")).toBeInTheDocument();
    expect(within(trailing).getByText(briefMessages.card.score.label)).toBeInTheDocument();
  });

  it("renders a muted meta row with the run's cost and token volume via the shared formatters", async () => {
    renderCard("pr-run-5", makeBriefResponse());
    const { main } = await findRegions();

    expect(
      within(main).getByText(`${formatCost(BASE_RUN.cost_usd)} · ${formatTokens(8200, 1300)}`),
    ).toBeInTheDocument();
    // Locks in the lowercase-`k` convention (AC-22) against the uppercase
    // form some design assets show — the product convention wins.
    expect(formatTokens(8200, 1300)).toBe("8k→1.3k");
  });

  it("still renders exactly the three fixed regions with a run present", async () => {
    renderCard("pr-run-6", makeBriefResponse());
    const { leading, main, trailing } = await findRegions();
    expect(leading).toBeInTheDocument();
    expect(main).toBeInTheDocument();
    expect(trailing).toBeInTheDocument();
  });
});
