/* BriefCard.anatomy.test.tsx — AC-20. Proves the three-region anatomy
   (leading status / main / trailing) holds across every state this task
   (T16) renders: the loaded-with-brief state, varied by risk level and by
   whether inputs degraded. The never-generated state is T31's own branch,
   with its own test file (BriefCard.nobrief.test.tsx) — not exercised here. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BriefMeta, BriefResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { BriefCard } from "./BriefCard";
import { BRIEF_CARD_TESTIDS } from "./constants";
import { s } from "./styles";

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
    latest_run: null,
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
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
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

describe("BriefCard anatomy (loaded-with-brief)", () => {
  it("renders all three regions with the risk headline, what/why prose and the regenerate control", async () => {
    renderCard("pr-1", makeBriefResponse());
    const { leading, main, trailing } = await findRegions();

    expect(leading).toBeInTheDocument();
    expect(main).toBeInTheDocument();
    expect(trailing).toBeInTheDocument();

    expect(within(main).getByText(messages.card.riskLevel.medium)).toBeInTheDocument();
    expect(
      within(main).getByText(
        "Adds a Redis-backed rate limiter as middleware on every public route.",
      ),
    ).toBeInTheDocument();
    expect(
      within(main).getByText(
        "Unauthenticated clients can currently call the public endpoints without limit.",
      ),
    ).toBeInTheDocument();

    expect(
      within(trailing).getByRole("button", { name: messages.card.regenerateAriaLabel }),
    ).toBeInTheDocument();
  });

  it("never adds or drops a region, and keeps the main region's flex/minWidth identical, across risk levels", async () => {
    renderCard("pr-high", makeBriefResponse({ brief: { ...makeBriefResponse().brief!, risk_level: "high" } }));
    const high = await findRegions();
    expect(high.leading).toBeInTheDocument();
    expect(high.trailing).toBeInTheDocument();
    const highMainStyle = high.main.getAttribute("style");

    cleanup();

    renderCard("pr-low", makeBriefResponse({ brief: { ...makeBriefResponse().brief!, risk_level: "low" } }));
    const low = await findRegions();
    expect(low.leading).toBeInTheDocument();
    expect(low.trailing).toBeInTheDocument();
    const lowMainStyle = low.main.getAttribute("style");

    expect(highMainStyle).toBe(lowMainStyle);
    expect(highMainStyle).toContain("flex: 1");
    expect(highMainStyle).toContain("min-width: 0");
  });

  it("renders exactly one degradation badge, itemising every degraded input in its title, regardless of count", async () => {
    renderCard(
      "pr-degraded",
      makeBriefResponse({
        meta: {
          ...BASE_META,
          degraded: [
            { input: "intent", action: "reduced" },
            { input: "linked_issue", action: "omitted" },
          ],
        },
      }),
    );
    const { main } = await findRegions();

    const badges = within(main).getAllByText(messages.card.degraded.badge);
    expect(badges).toHaveLength(1);
    expect(badges[0]!.closest("[title]")?.getAttribute("title")).toBe(
      [messages.card.degraded.intent.reduced, messages.card.degraded.linked_issue.omitted].join(
        "\n",
      ),
    );
  });

  it("renders no degradation badge when nothing degraded", async () => {
    renderCard("pr-clean", makeBriefResponse());
    const { main } = await findRegions();
    expect(within(main).queryByText(messages.card.degraded.badge)).not.toBeInTheDocument();
  });

  it("reserves a non-zero trailing-region footprint (AC-20) for the score ring a later task renders here", () => {
    expect(s.trailing.minWidth).toBe(52);
  });
});
