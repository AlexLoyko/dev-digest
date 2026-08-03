import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/conventions.json";
import type { ConventionCandidate } from "../../../../../../lib/hooks/conventions";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const CANDIDATE = (over: Partial<ConventionCandidate> = {}): ConventionCandidate => ({
  id: "c1",
  rule: "Always use async/await instead of .then() chains",
  category: "async",
  evidence_path: "src/api/users.ts",
  evidence_snippet: "const user = await db.users.find(id);",
  evidence_start_line: 23,
  evidence_end_line: 31,
  confidence: 0.91,
  following_files: 6,
  applicable_files: 7,
  accepted: false,
  ...over,
});

const REPO = "acme/payments-api";
const SHA = "66727c85ce06d7b16e64f888925d131d558cbe51";

function renderCard(
  candidate: ConventionCandidate,
  handlers: Partial<{
    onToggleAccept: (a: boolean) => void;
    onReject: () => void;
  }> = {},
  link: { repoFullName?: string | null; scannedSha?: string | null } = {
    repoFullName: REPO,
    scannedSha: SHA,
  }
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard
        candidate={candidate}
        repoFullName={link.repoFullName}
        scannedSha={link.scannedSha}
        onToggleAccept={handlers.onToggleAccept ?? vi.fn()}
        onReject={handlers.onReject ?? vi.fn()}
      />
    </NextIntlClientProvider>
  );
}

describe("ConventionCard", () => {
  it("renders the rule, the file:line ref, the snippet and the consistency", () => {
    renderCard(CANDIDATE());
    expect(screen.getByText("Always use async/await instead of .then() chains")).toBeTruthy();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeTruthy();
    expect(screen.getByText("const user = await db.users.find(id);")).toBeTruthy();
    expect(screen.getByText("Consistency")).toBeTruthy();
    expect(screen.getByText("91%")).toBeTruthy();
  });

  it("shows the basis for the score so it is auditable", () => {
    renderCard(CANDIDATE());
    expect(screen.getByText("Followed in 6 of 7 files")).toBeTruthy();
  });

  it("omits the basis when the counts are unknown (rows from an older scan)", () => {
    renderCard(CANDIDATE({ following_files: null, applicable_files: null }));
    expect(screen.queryByText(/Followed in/)).toBeNull();
    // The score itself still renders.
    expect(screen.getByText("91%")).toBeTruthy();
  });

  it("omits the basis when the rule was never seen to apply", () => {
    renderCard(CANDIDATE({ following_files: 0, applicable_files: 0 }));
    expect(screen.queryByText(/Followed in/)).toBeNull();
  });

  it("collapses a single-line span to path:line", () => {
    renderCard(CANDIDATE({ evidence_start_line: 9, evidence_end_line: 9 }));
    expect(screen.getByText("src/api/users.ts:9")).toBeTruthy();
    expect(screen.queryByText("src/api/users.ts:9-9")).toBeNull();
  });

  it("shows Accept when pending and Accepted once accepted", () => {
    const { rerender } = renderCard(CANDIDATE());
    expect(screen.getByRole("button", { name: /^Accept$/ })).toBeTruthy();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ConventionCard
          candidate={CANDIDATE({ accepted: true })}
          onToggleAccept={vi.fn()}
          onReject={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByRole("button", { name: /Accepted/ })).toBeTruthy();
  });

  it("toggles acceptance both ways", () => {
    const onToggleAccept = vi.fn();
    const { unmount } = renderCard(CANDIDATE(), { onToggleAccept });
    fireEvent.click(screen.getByRole("button", { name: /^Accept$/ }));
    expect(onToggleAccept).toHaveBeenCalledWith(true);
    unmount();

    const onToggleBack = vi.fn();
    renderCard(CANDIDATE({ accepted: true }), { onToggleAccept: onToggleBack });
    fireEvent.click(screen.getByRole("button", { name: /Accepted/ }));
    expect(onToggleBack).toHaveBeenCalledWith(false);
  });

  it("fires onReject from the Reject button", () => {
    const onReject = vi.fn();
    renderCard(CANDIDATE(), { onReject });
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("links the evidence path to the scanned commit, anchored to the cited lines", () => {
    renderCard(CANDIDATE());
    const link = screen.getByRole("link", { name: "src/api/users.ts:23-31" });
    expect(link.getAttribute("href")).toBe(
      `https://github.com/${REPO}/blob/${SHA}/src/api/users.ts#L23-L31`
    );
    // Opening a repo link must not navigate the studio away.
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // The URL is built from full_name — the clone remote embeds a PAT.
    expect(link.getAttribute("href")).not.toContain("github_pat");
  });

  it("collapses the anchor for a single-line span", () => {
    renderCard(CANDIDATE({ evidence_start_line: 9, evidence_end_line: 9 }));
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      `https://github.com/${REPO}/blob/${SHA}/src/api/users.ts#L9`
    );
  });

  it("links to the file with no anchor when the line span is unknown", () => {
    renderCard(CANDIDATE({ evidence_start_line: null, evidence_end_line: null }));
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      `https://github.com/${REPO}/blob/${SHA}/src/api/users.ts`
    );
  });

  it("renders plain text — not a dead control — when the revision is unknown", () => {
    // MonoLink without an href renders a focusable button that does nothing,
    // so the fallback must stay a span.
    renderCard(CANDIDATE(), {}, { repoFullName: REPO, scannedSha: null });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeTruthy();
    // Only accept/reject remain clickable — no phantom third control.
    expect(screen.queryByRole("button", { name: "src/api/users.ts:23-31" })).toBeNull();
  });

  it("renders plain text when the repo is not yet loaded", () => {
    renderCard(CANDIDATE(), {}, { repoFullName: null, scannedSha: SHA });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeTruthy();
  });

  it("disables both actions while a mutation is in flight", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ConventionCard
          candidate={CANDIDATE()}
          pending
          onToggleAccept={vi.fn()}
          onReject={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByRole("button", { name: /^Accept$/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /Reject/ }).hasAttribute("disabled")).toBe(true);
  });
});
