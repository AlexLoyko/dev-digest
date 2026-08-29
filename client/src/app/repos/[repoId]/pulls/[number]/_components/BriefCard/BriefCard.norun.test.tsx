/* BriefCard.norun.test.tsx — AC-13. Proves the no-completed-run state: a
   stored brief exists but `latest_run` is `null`. The headline and colour
   still come from the brief's own `risk_level` (T16's already-loaded path —
   this task adds no second colouring path), the header chip reads "No
   review run yet" (`card.noRun.chip`), and everything that only makes sense
   once a run has completed — the finding count, the blocker count, the
   score ring, and THE RUN'S OWN cost/token row — is absent from the DOM
   entirely, not rendered as a placeholder, a dash or a zero.

   This is scoped to the run's data specifically (AC-13's own wording), not
   to every `$`/token string on screen: the brief's own generation cost
   (`data.meta`, AC-10 — a separate, already-metered call, distinct from any
   agent run) keeps rendering here on purpose, and every fixture below
   carries a non-null `meta` for exactly that reason.

   A failed run reaches this exact same branch: `selectLatestCompletedRun`
   (server-side, T6) excludes any run that isn't a terminal success, so
   `latest_run` is `null` for "never reviewed" and for "the one review that
   ran, failed" alike (EC-5). Both fixtures below assert the identical
   absence set for that reason. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BriefMeta, BriefResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
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

/** Asserts the full absence set this branch owns: no finding/blocker
 *  counts, no score ring anywhere in the document, and no RUN cost/token
 *  row. Shared between the never-run and failed-run fixtures since both
 *  must produce byte-for-byte the same absence — there is no run-status
 *  logic of this component's own to tell them apart.
 *
 *  AC-13 says "shall omit ... the cost and token row" for THE RUN — it says
 *  nothing about the brief's own generation cost (`meta`, a different call;
 *  see AC-10), which every fixture here carries non-null and which is
 *  expected to keep rendering. A blanket `/\$/`/`/k→/` search over the whole
 *  main region would also catch that row and produce a false failure, so
 *  the run's row is identified by its own DOM shape instead: it renders as
 *  `${formatCost(run.cost_usd)} · ${tokensLabel(run)}` with NO wrapping
 *  `<span>`s (see `BriefCard.run.test.tsx`), so both `$` and `k→` land as
 *  DIRECT text-node children of the same `<p>`. `getNodeText` (which
 *  `getByText`'s matcher receives as its first argument) only joins a
 *  node's own direct child text nodes — the brief's own meta row wraps
 *  model/cost/tokens in separate `<span>`s, so no single node there ever
 *  carries both markers together, and this matcher correctly leaves it
 *  alone. */
function expectNoRunOutputAbsent(main: HTMLElement) {
  expect(within(main).queryByText(/findings/i)).not.toBeInTheDocument();
  expect(within(main).queryByText(/blockers/i)).not.toBeInTheDocument();
  expect(
    within(main).queryByText(
      (content) => /\$/.test(content) && /k→/.test(content),
    ),
  ).not.toBeInTheDocument();
  expect(within(main).queryByText("0")).not.toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
}

describe("BriefCard no-completed-run state (AC-13)", () => {
  it("takes the headline text and colour from the brief's own risk level, and shows the 'no review run yet' chip", async () => {
    renderCard("pr-norun-1", makeBriefResponse());
    const { leading, main } = await findRegions();

    expect(within(main).getByText(messages.card.riskLevel.medium)).toBeInTheDocument();
    expect(within(main).getByText(messages.card.noRun.chip)).toBeInTheDocument();

    // The medium-risk severity tint (`SEV.WARNING` → `var(--warn)`), not a
    // verdict colour — there is no run to derive a verdict tint from.
    const leadingStyle = leading.getAttribute("style") ?? "";
    expect(leadingStyle).toContain("var(--warn)");
  });

  it("omits the finding count, blocker count, score and cost/token row entirely — not as placeholders", async () => {
    renderCard("pr-norun-2", makeBriefResponse());
    const { main } = await findRegions();
    expectNoRunOutputAbsent(main);
  });

  it("renders identically for a failed-run fixture — the server already nulls latest_run for a non-terminal-success run", async () => {
    renderCard(
      "pr-norun-failed",
      makeBriefResponse({
        brief: {
          what: "Adds a Redis-backed rate limiter as middleware on every public route.",
          why: "Unauthenticated clients can currently call the public endpoints without limit.",
          risk_level: "high",
          risks: [],
          review_focus: [],
        },
      }),
    );
    const { main } = await findRegions();

    expect(within(main).getByText(messages.card.riskLevel.high)).toBeInTheDocument();
    expect(within(main).getByText(messages.card.noRun.chip)).toBeInTheDocument();
    expectNoRunOutputAbsent(main);
  });

  it("still renders exactly the three fixed regions, with the trailing region's footprint intact", async () => {
    renderCard("pr-norun-3", makeBriefResponse());
    const { leading, main, trailing } = await findRegions();
    expect(leading).toBeInTheDocument();
    expect(main).toBeInTheDocument();
    expect(trailing).toBeInTheDocument();
    expect(
      within(trailing).getByRole("button", { name: messages.card.regenerateAriaLabel }),
    ).toBeInTheDocument();
  });
});
