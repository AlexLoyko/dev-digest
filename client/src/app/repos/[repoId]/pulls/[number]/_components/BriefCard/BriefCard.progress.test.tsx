/* BriefCard.progress.test.tsx — AC-18 / EC-2. Proves the two in-progress
   states: a generation under way with no earlier brief (placeholders only,
   `design/states/Main.dc.html`) and a generation under way with an earlier
   brief already on screen (that brief dimmed but never hidden, behind a
   full-emphasis "updating"/"generating" indication,
   `design/states/Stale.dc.html`). Neither branch may render an empty
   container, and each carries an `aria-live="polite"` region so completion
   is announced.

   The in-progress treatment is gated on the mutation actually being in
   flight (`generate.isPending`), never on `data.stale` alone — staleness is
   only the reason a generation may have started, not evidence one is
   running. Two extra cases prove that: a manual regenerate of an already
   fresh (non-stale) brief still gets the in-progress treatment, and a
   stale brief with nothing currently in flight shows no spinner at all. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, act, waitFor } from "@testing-library/react";
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

const NO_BRIEF_RESPONSE: BriefResponse = {
  brief: null,
  meta: null,
  stale: false,
  latest_run: null,
};

const BASE_META: BriefMeta = {
  head_sha: "sha-progress-1",
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
  run_id: "run-progress-1",
  verdict: "request_changes",
  findings_count: 5,
  blockers: 2,
  score: 61,
  cost_usd: 0.045,
  tokens_in: 8200,
  tokens_out: 1300,
  agent_name: "Security Reviewer",
};

const STALE_RESPONSE: BriefResponse = {
  brief: {
    what: "Adds a Redis-backed rate limiter as middleware on every public route.",
    why: "Unauthenticated clients can currently call the public endpoints without limit.",
    risk_level: "high",
    risks: [],
    review_focus: [],
  },
  meta: BASE_META,
  stale: true,
  latest_run: BASE_RUN,
};

/** Same brief as `STALE_RESPONSE`, but the server considers it fresh
 *  (`stale: false`) — used to prove a MANUAL regenerate still gets the
 *  in-progress treatment even though staleness isn't why it started. */
const FRESH_RESPONSE: BriefResponse = {
  ...STALE_RESPONSE,
  stale: false,
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function renderCard(prId: string, fetchImpl: (url: string) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
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

describe("BriefCard in-progress state — no earlier brief (AC-18)", () => {
  it("shows a spinning leading icon, the generating headline, the reading-inputs chip and two placeholder bars — never an empty container", async () => {
    const { container } = renderCard("pr-progress-nobrief-1", async (url) => {
      if (url.includes("/brief/generate")) {
        // Never resolves — keeps the mutation's `isPending` true for the
        // life of the test, the same way a real in-flight generation would.
        return new Promise<Response>(() => {});
      }
      return jsonResponse(NO_BRIEF_RESPONSE);
    });

    const { main: mainBefore } = await findRegions();
    const button = within(mainBefore).getByRole("button", { name: briefMessages.card.noBrief.cta });

    await act(async () => {
      fireEvent.click(button);
    });

    await screen.findByText(briefMessages.card.generating.headline);
    const { leading, main, trailing } = await findRegions();

    expect(within(main).getByText(briefMessages.card.generating.headline)).toBeInTheDocument();
    expect(within(main).getByText(briefMessages.card.generating.chip)).toBeInTheDocument();

    // Two skeleton placeholder bars where the prose will land.
    expect(container.querySelectorAll(".skeleton")).toHaveLength(2);

    // Neither the leading icon box nor the main region is empty, and the
    // trailing region — while empty, same as the never-generated state — is
    // still present and hidden from assistive technology, not dropped.
    expect(leading).not.toBeEmptyDOMElement();
    expect(main).not.toBeEmptyDOMElement();
    expect(trailing).toBeInTheDocument();
    expect(trailing).toHaveAttribute("aria-hidden", "true");

    // Completion gets announced via a live region, not a one-off toast.
    expect(main).toHaveAttribute("aria-live", "polite");
  });

  it("never renders the never-generated CTA once generation is under way", async () => {
    renderCard("pr-progress-nobrief-2", async (url) => {
      if (url.includes("/brief/generate")) return new Promise<Response>(() => {});
      return jsonResponse(NO_BRIEF_RESPONSE);
    });

    const { main: mainBefore } = await findRegions();
    const button = within(mainBefore).getByRole("button", { name: briefMessages.card.noBrief.cta });

    await act(async () => {
      fireEvent.click(button);
    });

    await screen.findByText(briefMessages.card.generating.headline);
    const { main } = await findRegions();
    expect(within(main).queryByText(briefMessages.card.noBrief.body)).not.toBeInTheDocument();
    expect(within(main).queryByRole("button", { name: briefMessages.card.noBrief.cta })).not.toBeInTheDocument();
  });
});

describe("BriefCard in-progress state — with an earlier brief (AC-18 / EC-2)", () => {
  it("keeps the earlier headline, prose and score ring visible at reduced emphasis behind a full-emphasis updating chip, once a regeneration is actually in flight", async () => {
    renderCard("pr-progress-stale-1", async (url) => {
      if (url.includes("/brief/generate")) return new Promise<Response>(() => {});
      return jsonResponse(STALE_RESPONSE);
    });

    // The in-progress treatment is gated on the mutation being in flight,
    // not on `data.stale` alone — but a `stale: true` response also makes
    // `useBrief`'s own background regeneration effect fire automatically, no
    // click required. By the time the first render settles, that
    // regeneration is already under way and the with-earlier-brief
    // in-progress branch has already removed the regenerate control entirely
    // (design/states/Stale.dc.html) — there is nothing to click here.
    const { trailing: trailingBefore } = await findRegions();
    expect(
      within(trailingBefore).queryByRole("button", {
        name: briefMessages.card.regenerateAriaLabel,
      }),
    ).not.toBeInTheDocument();

    const { leading, main, trailing } = await findRegions();
    await screen.findByText(briefMessages.card.stale.chip);

    // The superseded brief is dimmed, never hidden: headline, prose and the
    // leading icon are all still in the DOM, each carrying opacity 0.5.
    const headlineEl = within(main).getByText(prReviewMessages.verdict.requestChanges);
    expect(headlineEl.getAttribute("style") ?? "").toContain("opacity: 0.5");
    expect(leading.getAttribute("style") ?? "").toContain("opacity: 0.5");

    const whatEl = within(main).getByText(STALE_RESPONSE.brief!.what);
    const whyEl = within(main).getByText(STALE_RESPONSE.brief!.why);
    expect(whatEl.getAttribute("style") ?? "").toContain("opacity: 0.5");
    expect(whyEl.getAttribute("style") ?? "").toContain("opacity: 0.5");

    // The score ring AND its label — not just the prose — stay visible, dimmed.
    const scoreRing = within(trailing).getByRole("img", {
      name: briefMessages.card.score.accessibleLabel.replace("{score}", "61"),
    });
    expect(scoreRing.getAttribute("style") ?? "").toContain("opacity: 0.5");
    const scoreLabel = within(trailing).getByText(briefMessages.card.score.label);
    expect(scoreLabel.getAttribute("style") ?? "").toContain("opacity: 0.5");

    // The "updating" indication itself is at FULL emphasis (EC-2) — no
    // opacity dimming on the chip carrying it.
    const chipText = within(main).getByText(briefMessages.card.stale.chip);
    const chip = chipText.closest("span");
    expect(chip?.getAttribute("style") ?? "").not.toContain("opacity");

    // The regular findings/blockers/no-run chip is not shown alongside the
    // updating chip — one clear "this is about to change" indication, not
    // a second, contradicting one describing the soon-to-be-superseded run.
    expect(
      within(main).queryByText(
        prReviewMessages.verdict.findingsCount.replace("{count}", "5"),
      ),
    ).not.toBeInTheDocument();
    expect(within(main).queryByText(briefMessages.card.noRun.chip)).not.toBeInTheDocument();

    expect(main).toHaveAttribute("aria-live", "polite");
  });

  it("never renders an empty container while updating, and removes the regenerate control entirely (design/states/Stale.dc.html)", async () => {
    renderCard("pr-progress-stale-2", async (url) => {
      if (url.includes("/brief/generate")) return new Promise<Response>(() => {});
      return jsonResponse(STALE_RESPONSE);
    });

    // The hook's own automatic, no-click background regeneration is what
    // puts this branch in flight (`useBrief` fires it as soon as it sees
    // `stale: true`) — no manual click needed to reach the in-progress
    // state here.
    const { leading, main, trailing } = await findRegions();
    await screen.findByText(briefMessages.card.stale.chip);

    // The container itself, and the score ring plus its label inside it,
    // still hold the trailing region's footprint (AC-20) — only the
    // regenerate control is gone from this branch, not the region.
    expect(leading).not.toBeEmptyDOMElement();
    expect(main).not.toBeEmptyDOMElement();
    expect(trailing).not.toBeEmptyDOMElement();
    expect(
      within(trailing).getByRole("img", {
        name: briefMessages.card.score.accessibleLabel.replace("{score}", "61"),
      }),
    ).toBeInTheDocument();
    expect(within(trailing).getByText(briefMessages.card.score.label)).toBeInTheDocument();
    expect(
      within(trailing).queryByRole("button", { name: briefMessages.card.regenerateAriaLabel }),
    ).not.toBeInTheDocument();
  });

  it("shows the in-progress treatment for a manual regenerate on a non-stale brief, using the generating (not stale) chip copy", async () => {
    // AC-18 failure mode #1: clicking regenerate on a brief the server does
    // NOT consider stale must still show the in-progress treatment — the
    // generation is genuinely running even though staleness never triggered it.
    renderCard("pr-progress-fresh-manual-1", async (url) => {
      if (url.includes("/brief/generate")) return new Promise<Response>(() => {});
      return jsonResponse(FRESH_RESPONSE);
    });

    const { trailing: trailingBefore } = await findRegions();
    const regenerateButton = within(trailingBefore).getByRole("button", {
      name: briefMessages.card.regenerateAriaLabel,
    });
    await act(async () => {
      fireEvent.click(regenerateButton);
    });

    const { leading, main } = await findRegions();
    await screen.findByText(briefMessages.card.generating.chip);

    const headlineEl = within(main).getByText(prReviewMessages.verdict.requestChanges);
    expect(headlineEl.getAttribute("style") ?? "").toContain("opacity: 0.5");
    expect(leading.getAttribute("style") ?? "").toContain("opacity: 0.5");

    // The staleness-specific "New commits" copy must not appear — this
    // generation was manually triggered, not because of a stale brief.
    expect(within(main).queryByText(briefMessages.card.stale.chip)).not.toBeInTheDocument();
  });

  it("shows the in-progress treatment for the hook's own AUTOMATIC background regeneration — no click involved", async () => {
    // This is the path that matters most in production: `useBrief` fires
    // this regeneration itself, on mount, because the server reports the
    // stored brief stale (the PR's head moved) — the user never touches the
    // regenerate control. The card must show the exact same dimmed,
    // full-emphasis-chip treatment it shows for a manual regenerate click,
    // driven by `useBrief`'s own `isGenerating` signal rather than
    // `generate.isPending` alone.
    renderCard("pr-progress-auto-1", async (url) => {
      if (url.includes("/brief/generate")) return new Promise<Response>(() => {});
      return jsonResponse(STALE_RESPONSE);
    });

    await screen.findByText(briefMessages.card.stale.chip);
    const { leading, main, trailing } = await findRegions();

    const headlineEl = within(main).getByText(prReviewMessages.verdict.requestChanges);
    expect(headlineEl.getAttribute("style") ?? "").toContain("opacity: 0.5");
    expect(leading.getAttribute("style") ?? "").toContain("opacity: 0.5");

    const chipText = within(main).getByText(briefMessages.card.stale.chip);
    const chip = chipText.closest("span");
    expect(chip?.getAttribute("style") ?? "").not.toContain("opacity");

    // No click ever happened, and per `design/states/Stale.dc.html` the
    // regenerate control is absent entirely in this branch while the
    // background regeneration is under way — not merely disabled.
    expect(
      within(trailing).queryByRole("button", { name: briefMessages.card.regenerateAriaLabel }),
    ).not.toBeInTheDocument();
  });

  it("does not show a spinner for a stale brief once its one-shot background regeneration has already settled", async () => {
    // AC-18 failure mode #2: if a stale-triggered regeneration already
    // settled (or failed), `data.stale` can still read `true` — the card
    // must not spin forever on that alone once nothing is actually running.
    // Mounting `useBrief` twice for the SAME prId+head_sha (the way the
    // brief card and the review-focus card both do on one page) proves the
    // one-shot guard, not just a lucky render timing: the first mount's
    // background regeneration runs to completion, then a fresh mount of the
    // same PR must render idle immediately, with no second call.
    const prId = "pr-progress-stale-idle-1";
    const fetchImpl = async () => jsonResponse(STALE_RESPONSE);

    const first = renderCard(prId, fetchImpl);
    await screen.findByText(prReviewMessages.verdict.requestChanges);
    await waitFor(() => {
      expect(screen.queryByText(briefMessages.card.stale.chip)).not.toBeInTheDocument();
      expect(screen.queryByText(briefMessages.card.generating.chip)).not.toBeInTheDocument();
    });
    first.unmount();

    renderCard(prId, fetchImpl);
    await screen.findByText(prReviewMessages.verdict.requestChanges);
    const { leading, main } = await findRegions();

    expect(within(main).queryByText(briefMessages.card.stale.chip)).not.toBeInTheDocument();
    expect(within(main).queryByText(briefMessages.card.generating.chip)).not.toBeInTheDocument();
    expect(leading.getAttribute("style") ?? "").not.toContain("opacity: 0.5");

    const headlineEl = within(main).getByText(prReviewMessages.verdict.requestChanges);
    expect(headlineEl.getAttribute("style") ?? "").not.toContain("opacity: 0.5");
  });
});
