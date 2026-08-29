/* ReviewFocusCard.test.tsx — AC-6. `useBrief` is mocked at the module the
   component imports it from (the hooks barrel), never a real fetch
   (client/insights/gotchas.md: fetch is mocked globally, but mocking the
   hook directly keeps this a pure render test). */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBrief, ReviewFocusEntry } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

const useBriefMock = vi.fn();

vi.mock("../../../../../../../lib/hooks", () => ({
  useBrief: (...args: unknown[]) => useBriefMock(...args),
}));

import { ReviewFocusCard } from "./ReviewFocusCard";

afterEach(() => {
  cleanup();
  useBriefMock.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function briefWith(review_focus: ReviewFocusEntry[]): PrBrief {
  return {
    what: "what",
    why: "why",
    risk_level: "low",
    risks: [],
    review_focus,
  };
}

describe("ReviewFocusCard", () => {
  it("renders nothing when there is no brief yet", () => {
    useBriefMock.mockReturnValue({ data: undefined });
    const { container } = renderWithIntl(
      <ReviewFocusCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders entries in brief order, each with a location and reason", () => {
    const entries: ReviewFocusEntry[] = [
      { file: { path: "src/config.ts", start_line: 12 }, reason: "Secret committed in plaintext" },
      { file: { path: "src/api/users.ts", start_line: 46, end_line: 48 }, reason: "N+1 query" },
    ];
    useBriefMock.mockReturnValue({ data: { brief: briefWith(entries) } });

    renderWithIntl(
      <ReviewFocusCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    // "src/config.ts" has only two segments — nothing to abbreviate.
    expect(links[0]).toHaveTextContent("src/config.ts:12");
    // "src/api/users.ts" has three — displayed as an ellipsis plus its final
    // two segments; the full path still lives in the chip's `title`.
    expect(links[1]).toHaveTextContent("…/api/users.ts:46-48");
    expect(links[1]?.closest("[title]")).toHaveAttribute("title", "src/api/users.ts:46-48");
    expect(screen.getByText(/Secret committed in plaintext/)).toBeInTheDocument();
    expect(screen.getByText(/N\+1 query/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("builds an href with the encoded path and a line anchor", () => {
    const entries: ReviewFocusEntry[] = [
      {
        file: { path: "src/weird dir/file#name.ts", start_line: 5, end_line: 9 },
        reason: "Needs a careful look",
      },
    ];
    useBriefMock.mockReturnValue({ data: { brief: briefWith(entries) } });

    renderWithIntl(
      <ReviewFocusCard prId="pr1" repoFullName="acme/widgets" headSha="deadbeef" />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/blob/deadbeef/src/weird%20dir/file%23name.ts#L5-L9",
    );
    // The reason is rendered as literal text, never markup.
    expect(screen.getByText(/Needs a careful look/)).toBeInTheDocument();
    // The chip shows the abbreviated path (raw, un-encoded) as plain text —
    // never re-interpreted as markup or a URL.
    expect(screen.getByText(/…\/weird dir\/file#name\.ts:5-9/)).toBeInTheDocument();
    // The full, un-abbreviated path stays available via `title` on the chip.
    expect(link.closest("[title]")).toHaveAttribute(
      "title",
      "src/weird dir/file#name.ts:5-9",
    );
  });

  it("abbreviates a long path to a leading ellipsis and its final two segments, leaving short paths untouched", () => {
    const entries: ReviewFocusEntry[] = [
      {
        file: { path: "server/src/modules/reviews/run-executor.ts", start_line: 12 },
        reason: "Long path",
      },
      { file: { path: "src/config.ts", start_line: 3 }, reason: "Short path" },
    ];
    useBriefMock.mockReturnValue({ data: { brief: briefWith(entries) } });

    renderWithIntl(
      <ReviewFocusCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />,
    );

    expect(screen.getByText("…/reviews/run-executor.ts:12")).toBeInTheDocument();
    // A path with two segments or fewer has nothing to abbreviate.
    expect(screen.getByText("src/config.ts:3")).toBeInTheDocument();
  });

  it("opens in a new tab without leaking a referrer", () => {
    const entries: ReviewFocusEntry[] = [
      { file: { path: "src/config.ts", start_line: 12 }, reason: "Secret" },
    ];
    useBriefMock.mockReturnValue({ data: { brief: briefWith(entries) } });

    renderWithIntl(
      <ReviewFocusCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders the standard empty state when review_focus is empty", () => {
    useBriefMock.mockReturnValue({ data: { brief: briefWith([]) } });

    renderWithIntl(
      <ReviewFocusCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />,
    );

    expect(screen.getByText("Nothing to read first")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The brief didn't single out any file in this pull request as needing attention ahead of the rest of the diff.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("keeps every entry reachable by keyboard tab", () => {
    const entries: ReviewFocusEntry[] = [
      { file: { path: "a.ts", start_line: 1 }, reason: "one" },
      { file: { path: "b.ts", start_line: 2 }, reason: "two" },
      { file: { path: "c.ts", start_line: 3 }, reason: "three" },
    ];
    useBriefMock.mockReturnValue({ data: { brief: briefWith(entries) } });

    renderWithIntl(
      <ReviewFocusCard prId="pr1" repoFullName="acme/widgets" headSha="abc123" />,
    );

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const link of links) {
      // Anchors are focusable by default; nothing removes them from the tab
      // order (no tabIndex="-1", no disabled state).
      expect(link).not.toHaveAttribute("tabindex", "-1");
    }
  });
});
