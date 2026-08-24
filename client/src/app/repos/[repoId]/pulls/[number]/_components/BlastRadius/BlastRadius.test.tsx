import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusView, BlastSymbolNode } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

const useBlastRadius = vi.fn();

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: (...args: unknown[]) => useBlastRadius(...args),
}));

import { BlastRadius } from "./BlastRadius";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const REPO = "acme/widgets";
const INDEXED_SHA = "indexedsha1111111111111111111111111111";
const HEAD_SHA = "headsha22222222222222222222222222222222";

const CHANGED_SYMBOL: BlastSymbolNode = {
  name: "rateLimit",
  file: "src/api/public/index.ts",
  kind: "function",
  callers: [
    { file: "src/api/public/handlers.ts", symbol: "handleRequest", line: 42, rank: 1 },
  ],
  caller_total: 1,
  callers_truncated: false,
  endpoints: [{ label: "GET /api/public/items", file: "src/api/public/index.ts", depth: 0 }],
  crons: [{ label: "reset-rate-buckets (hourly)", file: "src/jobs/reset.ts", depth: 1 }],
  endpoint_total: 1,
  cron_total: 1,
  facts_truncated: false,
};

const FULL_VIEW: BlastRadiusView = {
  pr_id: "pr-1",
  repo_full_name: REPO,
  indexed_sha: INDEXED_SHA,
  head_sha: HEAD_SHA,
  state: "full",
  reason: "ok",
  explanation: "1 changed symbol, 1 downstream caller.",
  symbols: [CHANGED_SYMBOL],
  counts: { symbols: 1, callers: 1, endpoints: 1, crons: 1 },
  prior_prs: [],
};

const DEGRADED_VIEW: BlastRadiusView = {
  ...FULL_VIEW,
  indexed_sha: null,
  state: "degraded",
  reason: "not_indexed",
  symbols: [],
  counts: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
};

describe("BlastRadius", () => {
  it("renders stat counts and expands a symbol to reveal its callers", () => {
    useBlastRadius.mockReturnValue({ data: FULL_VIEW, isLoading: false, isError: false });
    renderWithIntl(<BlastRadius prId="pr-1" repoFullName={REPO} headSha={HEAD_SHA} />);

    expect(screen.getByText(/1 symbols/i)).toBeInTheDocument();
    expect(screen.getByText(/1 endpoints/i)).toBeInTheDocument();
    expect(screen.getByText(/1 cron\/jobs/i)).toBeInTheDocument();
    // "1 callers" appears twice: the card's aggregate stat badge and the
    // symbol row's own per-symbol caller-total badge.
    expect(screen.getAllByText(/1 callers/i)).toHaveLength(2);

    // Callers are hidden until the symbol row is expanded.
    expect(screen.queryByText(/handlers\.ts/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("function"));
    expect(screen.getByText(/handlers\.ts/)).toBeInTheDocument();
  });

  it("links a caller against indexed_sha with a line anchor, never head_sha", () => {
    useBlastRadius.mockReturnValue({ data: FULL_VIEW, isLoading: false, isError: false });
    renderWithIntl(<BlastRadius prId="pr-1" repoFullName={REPO} headSha={HEAD_SHA} />);

    fireEvent.click(screen.getByText("function"));
    const callerLink = screen.getByRole("link", { name: /handlers\.ts:42/ });
    const href = callerLink.getAttribute("href");
    expect(href).toContain(INDEXED_SHA);
    expect(href).toContain("#L42");
    expect(href).not.toContain(HEAD_SHA);
  });

  it("renders the caller path as plain text (not a link) when indexed_sha is null", () => {
    const noShaView: BlastRadiusView = { ...FULL_VIEW, indexed_sha: null };
    useBlastRadius.mockReturnValue({ data: noShaView, isLoading: false, isError: false });
    renderWithIntl(<BlastRadius prId="pr-1" repoFullName={REPO} headSha={HEAD_SHA} />);

    fireEvent.click(screen.getByText("function"));
    const callerText = screen.getByText(/handlers\.ts:42/);
    expect(callerText.closest("a")).toBeNull();
    expect(screen.queryByRole("link", { name: /handlers\.ts:42/ })).not.toBeInTheDocument();
  });

  it("shows the localized reason and no caller content when degraded", () => {
    useBlastRadius.mockReturnValue({ data: DEGRADED_VIEW, isLoading: false, isError: false });
    renderWithIntl(<BlastRadius prId="pr-1" repoFullName={REPO} headSha={HEAD_SHA} />);

    expect(
      screen.getByText("This repository hasn't been indexed yet — blast radius isn't available."),
    ).toBeInTheDocument();
    expect(screen.queryByText("rateLimit")).not.toBeInTheDocument();
    expect(screen.queryByText(/1 symbols/i)).not.toBeInTheDocument();
  });

  it("switches from tree to graph view when the Graph chip is clicked", () => {
    useBlastRadius.mockReturnValue({ data: FULL_VIEW, isLoading: false, isError: false });
    renderWithIntl(<BlastRadius prId="pr-1" repoFullName={REPO} headSha={HEAD_SHA} />);

    // Tree view is the default — the symbol's kind label ("function") is tree-only.
    expect(screen.getByText("function")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /blast radius graph/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /graph/i }));

    expect(screen.queryByText("function")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /blast radius graph/i })).toBeInTheDocument();
  });
});
