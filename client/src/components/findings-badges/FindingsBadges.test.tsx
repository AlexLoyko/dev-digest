/**
 * FindingsBadges — the severity breakdown and its hover preview (L01,
 * specs/0002-findings-badges.md). The behaviours pinned here are the ones that
 * are easy to regress: no badge for a severity with no findings, nothing at all
 * when there is nothing outstanding, and a preview that only exists on hover.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { Finding } from "@devdigest/shared";
import { FindingsBadges } from "./FindingsBadges";
import { countBySeverity, sortForDisplay, lineLabel, placePopover } from "./helpers";
import { POPOVER_MAX_HEIGHT, POPOVER_WIDTH, VIEWPORT_MARGIN } from "./constants";

afterEach(cleanup);

function finding(o: Partial<Finding>): Finding {
  return {
    id: "f-1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key in commit",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Line 12 contains a literal sk_live_ Stripe secret key.",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    ...o,
  };
}

function renderBadges(findings: Finding[]) {
  return render(<FindingsBadges findings={findings} popoverLabel={`${findings.length} findings`} />);
}

function anchorOf(container: HTMLElement): HTMLElement {
  return container.querySelector('[tabindex="0"]') as HTMLElement;
}

describe("countBySeverity", () => {
  it("counts each severity and drops the ones with none", () => {
    expect(
      countBySeverity([
        finding({ id: "a", severity: "CRITICAL" }),
        finding({ id: "b", severity: "CRITICAL" }),
        finding({ id: "c", severity: "SUGGESTION" }),
      ]),
    ).toEqual([
      { severity: "CRITICAL", count: 2 },
      { severity: "SUGGESTION", count: 1 },
    ]);
  });

  it("returns nothing for no findings", () => {
    expect(countBySeverity([])).toEqual([]);
  });
});

describe("sortForDisplay", () => {
  it("puts the worst severity first, then the most confident", () => {
    const sorted = sortForDisplay([
      finding({ id: "sugg", severity: "SUGGESTION" }),
      finding({ id: "warn-low", severity: "WARNING", confidence: 0.4 }),
      finding({ id: "crit", severity: "CRITICAL" }),
      finding({ id: "warn-high", severity: "WARNING", confidence: 0.9 }),
    ]);
    expect(sorted.map((f) => f.id)).toEqual(["crit", "warn-high", "warn-low", "sugg"]);
  });

  it("does not mutate its input", () => {
    const input = [
      finding({ id: "sugg", severity: "SUGGESTION" }),
      finding({ id: "crit", severity: "CRITICAL" }),
    ];
    sortForDisplay(input);
    expect(input.map((f) => f.id)).toEqual(["sugg", "crit"]);
  });
});

describe("lineLabel", () => {
  it("renders a single line as one number and a span as a range", () => {
    expect(lineLabel({ start_line: 12, end_line: 12 })).toBe("12");
    expect(lineLabel({ start_line: 45, end_line: 52 })).toBe("45-52");
  });
});

describe("placePopover", () => {
  const viewport = { width: 1400, height: 900 };

  it("aligns to the left edge of the badges and sits below them", () => {
    const pos = placePopover({ left: 300, top: 100, bottom: 120 }, viewport);
    expect(pos.left).toBe(300);
    expect(pos.top).toBe(126);
    expect(pos.bottom).toBeUndefined();
  });

  it("flips above the badges when there is no room below", () => {
    const pos = placePopover({ left: 300, top: 840, bottom: 860 }, viewport);
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(viewport.height - 840 + 6);
  });

  it("keeps the panel inside the viewport when the badges are near the right edge", () => {
    const pos = placePopover({ left: 1380, top: 100, bottom: 120 }, viewport);
    expect(pos.left).toBe(viewport.width - POPOVER_WIDTH - VIEWPORT_MARGIN);
  });

  it("never places the panel off the left edge on a narrow viewport", () => {
    const pos = placePopover(
      { left: 10, top: 100, bottom: 120 },
      { width: POPOVER_WIDTH, height: POPOVER_MAX_HEIGHT * 3 },
    );
    expect(pos.left).toBe(VIEWPORT_MARGIN);
  });
});

describe("FindingsBadges", () => {
  it("renders one badge per severity present, with its count", () => {
    renderBadges([
      finding({ id: "a", severity: "CRITICAL" }),
      finding({ id: "b", severity: "CRITICAL" }),
      finding({ id: "c", severity: "WARNING" }),
    ]);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders nothing at all when there is nothing outstanding", () => {
    const { container } = renderBadges([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows no preview until the badges are hovered", () => {
    const { container } = renderBadges([finding({})]);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.mouseEnter(anchorOf(container));
    const popover = screen.getByRole("tooltip");
    expect(popover).toHaveTextContent("1 findings");
    expect(popover).toHaveTextContent("Hardcoded Stripe secret key in commit");
    expect(popover).toHaveTextContent("src/config.ts:12");
    expect(popover).toHaveTextContent("98% conf");
    expect(popover).toHaveTextContent("Line 12 contains a literal sk_live_ Stripe secret key.");
  });

  it("lists every finding behind the badges, worst first", () => {
    const { container } = renderBadges([
      finding({ id: "b", severity: "SUGGESTION", title: "Extract magic number 3600" }),
      finding({ id: "a", severity: "CRITICAL", title: "Hardcoded Stripe secret key in commit" }),
    ]);
    fireEvent.mouseEnter(anchorOf(container));
    const text = screen.getByRole("tooltip").textContent ?? "";
    expect(text.indexOf("Hardcoded Stripe")).toBeLessThan(text.indexOf("Extract magic number"));
  });

  it("closes on mouse-out, after the travel grace period", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderBadges([finding({})]);
      fireEvent.mouseEnter(anchorOf(container));
      fireEvent.mouseLeave(anchorOf(container));

      // Still open during the grace period — this is what lets the pointer
      // reach the panel to scroll it.
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays open when the pointer moves from the badges into the panel", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderBadges([finding({})]);
      fireEvent.mouseEnter(anchorOf(container));
      fireEvent.mouseLeave(anchorOf(container));
      fireEvent.mouseEnter(screen.getByRole("tooltip"));
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByRole("tooltip")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens on focus, so the preview is reachable without a mouse", () => {
    const { container } = renderBadges([finding({})]);
    fireEvent.focus(anchorOf(container));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(anchorOf(container));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not let a click inside the preview reach the row underneath", () => {
    const onRowClick = vi.fn();
    const { container } = render(
      <div onClick={onRowClick}>
        <FindingsBadges findings={[finding({})]} popoverLabel="1 findings" />
      </div>,
    );
    fireEvent.mouseEnter(anchorOf(container));
    fireEvent.click(screen.getByRole("tooltip"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("closes when the page scrolls, since the panel is positioned once", () => {
    const { container } = renderBadges([finding({})]);
    fireEvent.mouseEnter(anchorOf(container));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("stays open while the panel itself is scrolled", () => {
    // The panel has a max height and scrolls internally. Its scroll events
    // reach the same capture listener that closes on a page scroll, so without
    // the origin check the first wheel tick over a long findings list closes
    // the panel and scrolls the page instead — making the list unreadable.
    const { container } = renderBadges(
      Array.from({ length: 12 }, (_, i) =>
        finding({ id: `f-${i}`, title: `Finding number ${i}` }),
      ),
    );
    fireEvent.mouseEnter(anchorOf(container));
    const popover = screen.getByRole("tooltip");

    fireEvent.scroll(popover);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});
