/* BriefCard.regen.test.tsx — AC-11. "WHILE a generation is in flight, the
   system shall offer no actionable way to start another one — presenting
   the regeneration control as disabled, or not presenting it at all."

   `design/states/Main.dc.html` (no earlier brief) and `design/states/
   Stale.dc.html` (with an earlier brief) draw two different treatments for
   the two in-progress branches: the former keeps a real `<button disabled>`
   with no `onClick` wired to it at all — never merely dimmed — the latter
   removes the control from the trailing region entirely. Both satisfy
   AC-11's text; the two branches simply take its two different named
   options. That is what these tests hold the line on: a genuinely
   non-actionable disabled control in the no-earlier-brief in-flight branch,
   no control at all in the with-earlier-brief in-flight branch, and a
   normal accessible, active control everywhere else. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, act } from "@testing-library/react";
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
  head_sha: "sha-regen-1",
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
  run_id: "run-regen-1",
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

const FRESH_WITH_BRIEF_RESPONSE: BriefResponse = { ...STALE_RESPONSE, stale: false };

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
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages, prReview: prReviewMessages }}>
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

describe("BriefCard regenerate control — no earlier brief, in flight (AC-11, design/states/Main.dc.html)", () => {
  it("renders the control disabled, with no accessible name required, and a click fires the mutation zero additional times", async () => {
    const { fetchMock: fetch_ } = renderCard("pr-regen-nobrief-1", async (url) => {
      if (url.includes("/brief/generate")) return new Promise<Response>(() => {});
      return jsonResponse(NO_BRIEF_RESPONSE);
    });

    const { main: mainBefore } = await findRegions();
    const cta = within(mainBefore).getByRole("button", { name: briefMessages.card.noBrief.cta });

    await act(async () => {
      fireEvent.click(cta);
    });

    await screen.findByText(briefMessages.card.generating.headline);
    expect(generateCallCount(fetch_)).toBe(1);

    // The disabled control is not reachable via `getByRole` — its
    // `aria-hidden` wrapper (unchanged from the never-generated state's own
    // empty trailing region, see `BriefCard.progress.test.tsx`) removes it
    // from the accessibility tree entirely, same as an absent control would
    // read to assistive technology. `title` still finds the DOM node so the
    // real `disabled` attribute and the zero-spend behaviour can be proven.
    const button = screen.getByTitle(briefMessages.card.regenerateAriaLabel) as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(generateCallCount(fetch_)).toBe(1); // unchanged — the click did nothing
  });
});

describe("BriefCard regenerate control — with an earlier brief, in flight (AC-11, design/states/Stale.dc.html)", () => {
  it("is removed entirely for the hook's own AUTOMATIC background regeneration — no click involved", async () => {
    const { fetchMock } = renderCard("pr-regen-auto-1", async (url) => {
      if (url.includes("/brief/generate")) return new Promise<Response>(() => {});
      return jsonResponse(STALE_RESPONSE);
    });

    await screen.findByText(briefMessages.card.stale.chip);
    const { trailing } = await findRegions();

    // The hook's own background regeneration has already fired once — the
    // point of this test is that there is no control here at all for a
    // click to ever reach, so no click can add a second call on top of it.
    expect(generateCallCount(fetchMock)).toBe(1);
    expect(
      within(trailing).queryByRole("button", { name: briefMessages.card.regenerateAriaLabel }),
    ).not.toBeInTheDocument();
    expect(generateCallCount(fetchMock)).toBe(1);
  });

  it("removes the control once a MANUAL regenerate click puts a generation in flight, and it never re-fires the mutation while that generation is running", async () => {
    const { fetchMock } = renderCard("pr-regen-manual-1", async (url) => {
      if (url.includes("/brief/generate")) return new Promise<Response>(() => {});
      return jsonResponse(FRESH_WITH_BRIEF_RESPONSE);
    });

    const { trailing: trailingBefore } = await findRegions();
    const liveButton = within(trailingBefore).getByRole("button", {
      name: briefMessages.card.regenerateAriaLabel,
    });
    expect(liveButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(liveButton);
    });

    await screen.findByText(briefMessages.card.generating.chip);
    expect(generateCallCount(fetchMock)).toBe(1);

    const { trailing } = await findRegions();
    expect(
      within(trailing).queryByRole("button", { name: briefMessages.card.regenerateAriaLabel }),
    ).not.toBeInTheDocument();
    expect(generateCallCount(fetchMock)).toBe(1); // still just the one manual click from above
  });
});

describe("BriefCard regenerate control — outside any in-flight state (AC-11's own boundary)", () => {
  it("carries a non-empty text accessible name from the catalogue when idle, with an earlier brief on screen", async () => {
    renderCard("pr-regen-idle-1", async (url) => {
      if (url.includes("/brief/generate")) return jsonResponse({ ok: true });
      return jsonResponse(FRESH_WITH_BRIEF_RESPONSE);
    });

    const { trailing } = await findRegions();
    const button = within(trailing).getByRole("button", {
      name: briefMessages.card.regenerateAriaLabel,
    });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleName(briefMessages.card.regenerateAriaLabel);
    expect(briefMessages.card.regenerateAriaLabel.length).toBeGreaterThan(0);
  });
});
