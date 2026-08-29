/* BriefCard.a11y.test.tsx — NFR-4, the automatable half. `BriefCard.tsx`,
   `.../OverviewTab/RiskAreas.tsx` and `.../ReviewFocusCard/ReviewFocusCard.tsx`
   are finished and NOT owned by this task — this file only asserts against
   their existing, unedited behaviour. `useBrief`/`useGenerateBrief` are
   mocked at the hooks barrel (same convention as `ReviewFocusCard.test.tsx`)
   so every state each clause needs is reachable directly, without wiring a
   real `fetch`/`QueryClient` round trip through three different components.

   One `it()` per clause, in the order the task states them:
     1. the regenerate control has a TEXT accessible name, never the icon alone
     2. generation completion is announced via a polite live region
     3. generation failure carries role="alert" (announced without moving focus)
     4. every review-focus entry and every risk row is keyboard-reachable/operable
     5. risk level is conveyed by icon-and-label, not colour alone
     6. the score has a text equivalent
     7. no element this feature introduces carries an inline `animation` style —
        the jsdom gotcha (client/insights/gotchas.md) means the global
        prefers-reduced-motion block can't be exercised here; this asserts the
        precondition that makes that block sufficient — no competing inline
        `animation:` declaration on any of this feature's elements. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type {
  BriefLatestRun,
  BriefMeta,
  BriefResponse,
  PrBrief,
  ReviewFocusEntry,
  Risk,
} from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import commonMessages from "../../../../../../../../messages/en/common.json";
import { ApiError } from "@/lib/api";
import { BRIEF_CARD_TESTIDS } from "./constants";

const useBriefMock = vi.fn();
const useGenerateBriefMock = vi.fn();

vi.mock("../../../../../../../lib/hooks", () => ({
  useBrief: (...args: unknown[]) => useBriefMock(...args),
  useGenerateBrief: (...args: unknown[]) => useGenerateBriefMock(...args),
}));

import { BriefCard } from "./BriefCard";
import { RiskAreas } from "../OverviewTab/RiskAreas";
import { ReviewFocusCard } from "../ReviewFocusCard/ReviewFocusCard";

afterEach(() => {
  cleanup();
  useBriefMock.mockReset();
  useGenerateBriefMock.mockReset();
});

const BASE_META: BriefMeta = {
  head_sha: "sha-a11y-1",
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
  run_id: "run-a11y-1",
  verdict: "request_changes",
  findings_count: 5,
  blockers: 2,
  score: 61,
  cost_usd: 0.045,
  tokens_in: 8200,
  tokens_out: 1300,
  agent_name: "Security Reviewer",
};

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    kind: "auth",
    title: "Auth surface touched",
    explanation: "The middleware now sits in front of every public route.",
    severity: "high",
    file_refs: [{ path: "src/middleware/ratelimit.ts", start_line: 12, end_line: 18 }],
    ...overrides,
  };
}

const REVIEW_FOCUS_ENTRIES: ReviewFocusEntry[] = [
  { file: { path: "src/config.ts", start_line: 12 }, reason: "Secret committed in plaintext" },
  { file: { path: "src/api/users.ts", start_line: 46, end_line: 48 }, reason: "N+1 query" },
];

const BRIEF: PrBrief = {
  what: "Adds a Redis-backed rate limiter as middleware on every public route.",
  why: "Unauthenticated clients can currently call the public endpoints without limit.",
  risk_level: "high",
  risks: [risk()],
  review_focus: REVIEW_FOCUS_ENTRIES,
};

function briefData(overrides: Partial<BriefResponse> = {}): BriefResponse {
  return {
    brief: BRIEF,
    meta: BASE_META,
    stale: false,
    latest_run: BASE_RUN,
    ...overrides,
  };
}

function renderBriefCard({
  data,
  isGenerating = false,
  generate = {},
}: {
  data: BriefResponse;
  isGenerating?: boolean;
  generate?: Partial<{
    isPending: boolean;
    isError: boolean;
    error: unknown;
    mutate: () => void;
  }>;
}) {
  useBriefMock.mockReturnValue({ data, isGenerating });
  useGenerateBriefMock.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    ...generate,
  });

  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ brief: briefMessages, prReview: prReviewMessages, common: commonMessages }}
    >
      <BriefCard prId="pr-a11y-1" />
    </NextIntlClientProvider>,
  );
}

function renderRiskAreas(data: BriefResponse) {
  useBriefMock.mockReturnValue({ data, isLoading: false });
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <RiskAreas prId="pr-a11y-1" />
    </NextIntlClientProvider>,
  );
}

function renderReviewFocusCard(data: BriefResponse) {
  useBriefMock.mockReturnValue({ data });
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
      <ReviewFocusCard prId="pr-a11y-1" repoFullName="acme/widgets" headSha="deadbeef" />
    </NextIntlClientProvider>,
  );
}

/** Every element carrying a `style` attribute, anywhere under `container` —
 *  used by clause 7 to prove none of them declares `animation` inline. */
function styledElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[style]"));
}

describe("NFR-4 accessibility — BriefCard, RiskAreas, ReviewFocusCard (automatable half)", () => {
  it("1. gives the regenerate control a text accessible name, never relying on its icon alone, in every state where it is actually rendered", () => {
    // With an earlier brief, idle: the live `IconBtn` in the trailing region.
    renderBriefCard({ data: briefData() });
    const liveButton = screen.getByRole("button", { name: briefMessages.card.regenerateAriaLabel });
    expect(liveButton).toHaveAccessibleName(briefMessages.card.regenerateAriaLabel);
    expect(briefMessages.card.regenerateAriaLabel.length).toBeGreaterThan(0);
    cleanup();

    // No earlier brief, in flight: a genuine `<button disabled>` is rendered
    // (per the task's own gotcha) — its `aria-hidden` ancestor removes it
    // from the accessibility tree, so `getByTitle` (a plain DOM attribute
    // lookup, not an accessibility-tree query) is what proves the control
    // itself still carries a real text label rather than being icon-only.
    renderBriefCard({
      data: briefData({ brief: null, meta: null, latest_run: null }),
      generate: { isPending: true },
    });
    const disabledButton = screen.getByTitle(briefMessages.card.regenerateAriaLabel) as HTMLButtonElement;
    expect(disabledButton.tagName).toBe("BUTTON");
    expect(disabledButton.getAttribute("aria-label")).toBe(briefMessages.card.regenerateAriaLabel);
    expect(disabledButton).toBeDisabled();
  });

  it("2. announces generation completion via an aria-live=\"polite\" region on the main column, both mid-generation and once settled", () => {
    // Mid-generation (no earlier brief) — the region that will hold the
    // completed content once generation finishes.
    renderBriefCard({
      data: briefData({ brief: null, meta: null, latest_run: null }),
      generate: { isPending: true },
    });
    expect(screen.getByTestId(BRIEF_CARD_TESTIDS.main)).toHaveAttribute("aria-live", "polite");
    cleanup();

    // Settled/loaded — the same region, now holding the finished content,
    // still carries the live-region attribute that announced the change.
    renderBriefCard({ data: briefData() });
    expect(screen.getByTestId(BRIEF_CARD_TESTIDS.main)).toHaveAttribute("aria-live", "polite");
  });

  it("3. announces a failed generation via role=\"alert\", in both the no-earlier-brief and with-earlier-brief branches", () => {
    const error = new ApiError("502 Bad Gateway", 502, undefined, undefined, {
      reason: "model_error",
      hasPriorBrief: false,
    });

    renderBriefCard({
      data: briefData({ brief: null, meta: null, latest_run: null }),
      generate: { isError: true, error },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    cleanup();

    renderBriefCard({
      data: briefData(),
      isGenerating: false,
      generate: { isError: true, error },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("4. keeps every review-focus entry and every risk row reachable and operable by keyboard", () => {
    renderReviewFocusCard(briefData());
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(REVIEW_FOCUS_ENTRIES.length);
    for (const link of links) {
      expect(link).not.toHaveAttribute("tabindex", "-1");
      link.focus();
      expect(link).toHaveFocus();
    }
    cleanup();

    renderRiskAreas(
      briefData({
        brief: {
          ...BRIEF,
          risks: [risk({ title: "Auth surface touched" }), risk({ title: "New dependency", kind: "dependency", severity: "medium" })],
        },
      }),
    );
    const rows = screen.getAllByRole("button", { name: "Show more" });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.tagName).toBe("BUTTON");
      expect(row).not.toHaveAttribute("tabindex", "-1");
      row.focus();
      expect(row).toHaveFocus();
    }
  });

  it("5. conveys each risk row's severity by icon and label together, never by colour alone", () => {
    renderRiskAreas(
      briefData({
        brief: {
          ...BRIEF,
          risks: [
            risk({ title: "High risk row", severity: "high" }),
            risk({ title: "Medium risk row", severity: "medium" }),
          ],
        },
      }),
    );

    const highLabel = screen.getByText("Critical");
    const highBadge = highLabel.closest("span");
    expect(highBadge?.querySelector("svg")).toBeTruthy();
    expect(highBadge).toHaveTextContent("Critical");

    const mediumLabel = screen.getByText("Warning");
    const mediumBadge = mediumLabel.closest("span");
    expect(mediumBadge?.querySelector("svg")).toBeTruthy();
    expect(mediumBadge).toHaveTextContent("Warning");
  });

  it("6. gives the score ring a text equivalent via role=\"img\" and an aria-label carrying the numeric score", () => {
    renderBriefCard({ data: briefData({ latest_run: BASE_RUN }) });
    const scoreImg = screen.getByRole("img", {
      name: briefMessages.card.score.accessibleLabel.replace("{score}", String(BASE_RUN.score)),
    });
    expect(scoreImg).toBeInTheDocument();
    expect(scoreImg.getAttribute("aria-label")?.length).toBeGreaterThan(0);
  });

  it("7. never sets an inline `animation` style on any element this feature introduces — animated affordances go through classes the global reduced-motion block covers", () => {
    // The spinning icon in the no-earlier-brief in-progress branch is the
    // one place this feature could regress into an inline `animation:`
    // declaration instead of the `animate-spin` class.
    const noBriefGenerating = renderBriefCard({
      data: briefData({ brief: null, meta: null, latest_run: null }),
      generate: { isPending: true },
    });
    for (const el of styledElements(noBriefGenerating.container)) {
      expect(el.getAttribute("style") ?? "").not.toMatch(/animation/i);
    }
    cleanup();

    // The with-earlier-brief in-progress branch's own spinning chip icon.
    const withBriefGenerating = renderBriefCard({
      data: briefData({ stale: true }),
      isGenerating: true,
    });
    for (const el of styledElements(withBriefGenerating.container)) {
      expect(el.getAttribute("style") ?? "").not.toMatch(/animation/i);
    }
    cleanup();

    const riskAreas = renderRiskAreas(briefData());
    for (const el of styledElements(riskAreas.container)) {
      expect(el.getAttribute("style") ?? "").not.toMatch(/animation/i);
    }
    cleanup();

    const reviewFocus = renderReviewFocusCard(briefData());
    for (const el of styledElements(reviewFocus.container)) {
      expect(el.getAttribute("style") ?? "").not.toMatch(/animation/i);
    }
  });
});
