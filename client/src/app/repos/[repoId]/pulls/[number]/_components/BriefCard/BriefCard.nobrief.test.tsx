/* BriefCard.nobrief.test.tsx — AC-23. Proves the never-generated state: no
   stored brief and no generation in flight. All three regions still render
   (AC-20), the leading treatment is neutral (not risk- or verdict-derived),
   the headline carries no chip, exactly one control offers to generate a
   brief and it lives in the main region (not the trailing one), the
   trailing region is present/empty/hidden from assistive technology, and
   there is no score ring anywhere in the card. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BriefResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
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

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function renderCard(prId: string, response: BriefResponse = NO_BRIEF_RESPONSE) {
  const fetchMock = vi.fn(async () => jsonResponse(response));
  vi.stubGlobal("fetch", fetchMock);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <BriefCard prId={prId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

  return { fetchMock };
}

async function findRegions() {
  const leading = await screen.findByTestId(BRIEF_CARD_TESTIDS.leading);
  const main = screen.getByTestId(BRIEF_CARD_TESTIDS.main);
  const trailing = screen.getByTestId(BRIEF_CARD_TESTIDS.trailing);
  return { leading, main, trailing };
}

describe("BriefCard never-generated state", () => {
  it("renders all three regions with a neutral leading treatment, the headline, the explanatory line and one generate control", async () => {
    renderCard("pr-never-generated");
    const { leading, main, trailing } = await findRegions();

    expect(leading).toBeInTheDocument();
    expect(main).toBeInTheDocument();
    expect(trailing).toBeInTheDocument();

    // Neutral informational treatment — grey, not a SEV risk tint or a
    // verdict tint. jsdom normalizes the inline style (spacing, hex → rgb).
    const leadingStyle = leading.getAttribute("style") ?? "";
    expect(leadingStyle).toContain("rgba(107, 114, 128, 0.12)");
    expect(leadingStyle).toContain("color: rgb(107, 114, 128)");

    expect(within(main).getByText(messages.card.noBrief.headline)).toBeInTheDocument();
    expect(within(main).getByText(messages.card.noBrief.body)).toBeInTheDocument();

    // No chip alongside the headline.
    expect(within(main).queryByText(messages.card.degraded.badge)).not.toBeInTheDocument();
  });

  it("renders exactly one control offering to generate a brief, inside the main region, and not in the trailing region", async () => {
    renderCard("pr-never-generated-2");
    const { main, trailing } = await findRegions();

    const generateButtons = within(main).getAllByRole("button", {
      name: messages.card.noBrief.cta,
    });
    expect(generateButtons).toHaveLength(1);

    expect(within(trailing).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("leaves the trailing region present, empty and hidden from assistive technology, with no score ring", async () => {
    renderCard("pr-never-generated-3");
    const { trailing } = await findRegions();

    expect(trailing).toHaveAttribute("aria-hidden", "true");
    expect(trailing).toBeEmptyDOMElement();
  });

  it("calls the generate mutation when the control is activated, and never on mount by itself", async () => {
    const { fetchMock } = renderCard("pr-never-generated-4");
    const { main } = await findRegions();

    // Merely opening an unbriefed PR must never spend money: no POST fires
    // just from mounting the card.
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/brief/generate"), expect.anything());

    const button = within(main).getByRole("button", { name: messages.card.noBrief.cta });

    await act(async () => {
      fireEvent.click(button);
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("/brief/generate"),
          expect.objectContaining({ method: "POST" }),
        );
      });
    });
  });
});
