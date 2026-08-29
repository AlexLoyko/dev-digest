/* BriefCard.failure.test.tsx — AC-16. "IF the model call fails, or its
   result fails validation against the brief contract, THEN the system
   shall store no brief, leave any previously stored brief unchanged, and
   present a plain-language statement of why generation failed together
   with a control to try again — stating that no earlier brief exists when
   there is none, and otherwise keeping that earlier brief readable at
   reduced emphasis and saying it is being shown instead."

   Two branches, per `design/states/Failed.dc.html` (no earlier brief) and
   `design/states/FailedWithPrior.dc.html` (an earlier brief survives the
   failed attempt untouched). Both carry `role="alert"` (NFR-4: announced
   without moving focus) and exactly one recovery affordance — the inline
   "Try again" button — never a second control alongside it.

   The server's POST failure body is the discriminated `{reason,
   hasPriorBrief}` shape (`server/docs/api-contracts.md`). `apiFetch`
   (`client/src/lib/api.ts`, T15, not owned by this task) preserves that
   body on `ApiError.body` even though it isn't `{error: {...}}`-wrapped.
   These tests mock `fetch` with the real, unwrapped `{reason,
   hasPriorBrief}` body (exactly what the server actually sends) to prove
   the card resolves a reason-specific, plain-language cause sentence
   (`card.failure.cause.<reason>`) when the reason is recognised, and falls
   back to `apiFetch`'s own generic `"${status} ${statusText}"` line — never
   blank, never a bare translation key — when it isn't. The prior-brief
   branch is selected from the brief already on screen, never from a
   `hasPriorBrief` field the client can't actually see. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, act, renderHook, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { BriefLatestRun, BriefMeta, BriefResponse } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import commonMessages from "../../../../../../../../messages/en/common.json";
import { ApiError } from "@/lib/api";
import { useGenerateBrief } from "@/lib/hooks";
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
  head_sha: "sha-failure-1",
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
  run_id: "run-failure-1",
  verdict: "request_changes",
  findings_count: 5,
  blockers: 2,
  score: 61,
  cost_usd: 0.045,
  tokens_in: 8200,
  tokens_out: 1300,
  agent_name: "Security Reviewer",
};

const FRESH_WITH_BRIEF_RESPONSE: BriefResponse = {
  brief: {
    what: "Adds a Redis-backed rate limiter as middleware on every public route.",
    why: "Unauthenticated clients can currently call the public endpoints without limit.",
    risk_level: "high",
    risks: [],
    review_focus: [],
  },
  meta: BASE_META,
  stale: false,
  latest_run: BASE_RUN,
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

/** The real server failure body — a discriminated `{reason, hasPriorBrief}`
 *  object, unwrapped (`server/src/modules/brief/routes.ts`). Deliberately
 *  NOT shaped as `{error: {...}}` — that would silently exercise a
 *  different, easier code path in `apiFetch` than the one the real backend
 *  actually sends. */
function failureResponse(status: number, statusText: string, body: unknown): Response {
  return { ok: false, status, statusText, json: async () => body } as Response;
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
        messages={{ brief: briefMessages, prReview: prReviewMessages, common: commonMessages }}
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

describe("BriefCard failure — no earlier brief (AC-16, design/states/Failed.dc.html)", () => {
  it("announces the failure via role=alert, states the cause and that no earlier brief exists, and offers exactly one recovery control", async () => {
    const { fetchMock } = renderCard("pr-failure-nobrief-1", async (url) => {
      if (url.includes("/brief/generate")) {
        return failureResponse(502, "Bad Gateway", { reason: "model_error", hasPriorBrief: false });
      }
      return jsonResponse(NO_BRIEF_RESPONSE);
    });

    const { main: mainBefore } = await findRegions();
    const cta = within(mainBefore).getByRole("button", { name: briefMessages.card.noBrief.cta });

    await act(async () => {
      fireEvent.click(cta);
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();

    const { leading, main, trailing } = await findRegions();

    // The neutral headline text, not a technical one — the CRITICAL tint
    // lives on the leading icon, not on this label.
    expect(within(main).getByText(briefMessages.card.failure.headline)).toBeInTheDocument();

    // The plain-language cause: reason-keyed copy resolved from
    // `error.body.reason`, not `apiFetch`'s generic status line.
    expect(within(main).getByText(briefMessages.card.failure.cause.model_error)).toBeInTheDocument();

    // States plainly that no earlier brief exists for this pull request —
    // reusing the existing `card.noBrief.body` string rather than adding a
    // new `card.failure.*` key.
    expect(within(main).getByText(briefMessages.card.noBrief.body)).toBeInTheDocument();

    // Exactly one recovery affordance: the inline "Try again" button. The
    // never-generated CTA is gone, and there is no second control anywhere
    // in the card.
    const retry = within(main).getByRole("button", { name: briefMessages.card.failure.retry });
    expect(within(main).queryByRole("button", { name: briefMessages.card.noBrief.cta })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    // No chip and no score ring (AC-16's no-prior branch has neither).
    expect(within(main).queryByRole("img")).not.toBeInTheDocument();

    // The trailing region stays reserved-but-empty and hidden from
    // assistive technology (AC-20) — the same footprint every other state
    // reserves it for.
    expect(trailing).toBeInTheDocument();
    expect(trailing).toBeEmptyDOMElement();
    expect(trailing).toHaveAttribute("aria-hidden", "true");
    expect(leading).not.toBeEmptyDOMElement();

    // "Try again" re-fires the exact same mutation — a second POST, no
    // second affordance appears while it goes out.
    expect(generateCallCount(fetchMock)).toBe(1);
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(generateCallCount(fetchMock)).toBe(2);
  });

  it("renders a distinct sentence for reason: 'invalid_result', not the 'model_error' copy", async () => {
    renderCard("pr-failure-nobrief-invalid-1", async (url) => {
      if (url.includes("/brief/generate")) {
        return failureResponse(422, "Unprocessable Entity", { reason: "invalid_result", hasPriorBrief: false });
      }
      return jsonResponse(NO_BRIEF_RESPONSE);
    });

    const { main: mainBefore } = await findRegions();
    const cta = within(mainBefore).getByRole("button", { name: briefMessages.card.noBrief.cta });
    await act(async () => {
      fireEvent.click(cta);
    });
    await screen.findByRole("alert");

    const { main } = await findRegions();
    expect(within(main).getByText(briefMessages.card.failure.cause.invalid_result)).toBeInTheDocument();
    expect(within(main).queryByText(briefMessages.card.failure.cause.model_error)).not.toBeInTheDocument();
    // The two reason-keyed sentences are genuinely different strings.
    expect(briefMessages.card.failure.cause.invalid_result).not.toBe(briefMessages.card.failure.cause.model_error);
  });

  it("falls back to the generic status-line cause when the failure body carries no reason", async () => {
    renderCard("pr-failure-nobrief-noreason-1", async (url) => {
      if (url.includes("/brief/generate")) {
        return failureResponse(502, "Bad Gateway", {});
      }
      return jsonResponse(NO_BRIEF_RESPONSE);
    });

    const { main: mainBefore } = await findRegions();
    const cta = within(mainBefore).getByRole("button", { name: briefMessages.card.noBrief.cta });
    await act(async () => {
      fireEvent.click(cta);
    });
    await screen.findByRole("alert");

    const { main } = await findRegions();
    // Neither reason-keyed sentence appears — this is the untranslated
    // fallback, not a coincidental match.
    expect(within(main).queryByText(briefMessages.card.failure.cause.model_error)).not.toBeInTheDocument();
    expect(within(main).queryByText(briefMessages.card.failure.cause.invalid_result)).not.toBeInTheDocument();
    // The generic fallback renders `apiFetch`'s own status line — never
    // blank, and never a raw "card.failure.cause..." translation key.
    const causeEl = within(main).getByText("502 Bad Gateway");
    expect(causeEl.textContent).not.toMatch(/card\.failure\.cause/);
  });
});

describe("BriefCard failure — with an earlier brief (AC-16, design/states/FailedWithPrior.dc.html)", () => {
  it("keeps the earlier brief readable at reduced emphasis behind a full-emphasis failure chip, with exactly one recovery control", async () => {
    const { fetchMock } = renderCard("pr-failure-withbrief-1", async (url) => {
      if (url.includes("/brief/generate")) {
        return failureResponse(422, "Unprocessable Entity", {
          reason: "invalid_result",
          hasPriorBrief: true,
        });
      }
      return jsonResponse(FRESH_WITH_BRIEF_RESPONSE);
    });

    const { trailing: trailingBefore } = await findRegions();
    const regenerateButton = within(trailingBefore).getByRole("button", {
      name: briefMessages.card.regenerateAriaLabel,
    });

    await act(async () => {
      fireEvent.click(regenerateButton);
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();

    const { leading, main, trailing } = await findRegions();

    // The earlier brief's own headline, "what" and "why" are still in the
    // DOM, all at reduced emphasis.
    const headlineEl = within(main).getByText(prReviewMessages.verdict.requestChanges);
    expect(headlineEl.getAttribute("style") ?? "").toContain("opacity: 0.5");
    expect(leading.getAttribute("style") ?? "").toContain("opacity: 0.5");

    const whatEl = within(main).getByText(FRESH_WITH_BRIEF_RESPONSE.brief!.what);
    const whyEl = within(main).getByText(FRESH_WITH_BRIEF_RESPONSE.brief!.why);
    expect(whatEl.getAttribute("style") ?? "").toContain("opacity: 0.5");
    expect(whyEl.getAttribute("style") ?? "").toContain("opacity: 0.5");

    // The failure chip is the one thing at FULL emphasis.
    const chipText = within(main).getByText(briefMessages.card.failure.chipWithPrior);
    const chip = chipText.closest("span");
    expect(chip?.getAttribute("style") ?? "").not.toContain("opacity");

    // The regular findings/blockers/no-run chip never coexists with the
    // failure chip — one clear indication, not a contradicting second one.
    expect(
      within(main).queryByText(prReviewMessages.verdict.findingsCount.replace("{count}", "5")),
    ).not.toBeInTheDocument();
    expect(within(main).queryByText(briefMessages.card.noRun.chip)).not.toBeInTheDocument();

    // The score ring survives, dimmed — the trailing region's footprint
    // never collapses even though its regenerate control is gone.
    const scoreRing = within(trailing).getByRole("img", {
      name: briefMessages.card.score.accessibleLabel.replace("{score}", "61"),
    });
    expect(scoreRing.getAttribute("style") ?? "").toContain("opacity: 0.5");

    // Exactly one recovery affordance: the inline "Try again" button below
    // the prose. The trailing region's own regenerate `IconBtn` is gone —
    // no second affordance for the same action.
    const retry = within(main).getByRole("button", { name: briefMessages.card.failure.retry });
    expect(
      within(trailing).queryByRole("button", { name: briefMessages.card.regenerateAriaLabel }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);

    expect(generateCallCount(fetchMock)).toBe(1);
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(generateCallCount(fetchMock)).toBe(2);
  });
});

/* Proves the fix in `client/src/lib/api.ts`: the server's real, unwrapped
   `{reason, hasPriorBrief}` failure body now survives onto `ApiError.body`
   instead of being silently discarded. `useGenerateBrief(prId)`'s `error`
   is exactly what `BriefCard.tsx`'s `generate.error` is — the same mutation
   hook, not a stand-in — so asserting on it here proves the body reaches
   the same object the component reads from, not just `api.ts` in
   isolation. The `{error: {...}}`-wrapped path (every other route) is left
   completely alone by the fix and isn't re-tested here — that's `api.ts`'s
   own existing, unedited behaviour. */
describe("BriefCard failure — the fixed apiFetch forwards {reason, hasPriorBrief} to the mutation the card reads", () => {
  function wrapperFor(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  it("preserves reason: 'model_error' and hasPriorBrief: false from a 502 failure body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => failureResponse(502, "Bad Gateway", { reason: "model_error", hasPriorBrief: false })),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useGenerateBrief("pr-body-forward-1"), {
      wrapper: wrapperFor(queryClient),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(ApiError);
    const error = result.current.error as ApiError;
    expect(error.body?.reason).toBe("model_error");
    expect(error.body?.hasPriorBrief).toBe(false);
    // The generic status-line fallback survives unchanged — this body shape
    // has no known `message` field for `apiFetch` to pull a nicer one from.
    expect(error.message).toBe("502 Bad Gateway");
  });

  it("preserves reason: 'invalid_result' and hasPriorBrief: true from a 422 failure body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        failureResponse(422, "Unprocessable Entity", { reason: "invalid_result", hasPriorBrief: true }),
      ),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { result } = renderHook(() => useGenerateBrief("pr-body-forward-2"), {
      wrapper: wrapperFor(queryClient),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(ApiError);
    const error = result.current.error as ApiError;
    expect(error.body?.reason).toBe("invalid_result");
    expect(error.body?.hasPriorBrief).toBe(true);
    expect(error.message).toBe("422 Unprocessable Entity");
  });
});
