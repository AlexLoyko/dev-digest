/* SmartDiffViewer — the "Smart order" view: role sections, auto-open on
   findings, inline severity chips, and the split nudge.
   Acceptance criteria come from `client/specs/0003-smart-diff.md`. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

// Renders as: 24 context, 25/26/27 added, 28 context. The context lines on both
// sides are what let these tests prove a wide cited range does not paint them.
const PATCH = `@@ -24,6 +24,10 @@
 export async function rateLimit(req, res, next) {
+  const key = bucketKey(req);
+  const count = await redis.incr(key);
+  if (count === 1) await redis.expire(key, 3600);
   return next();`;

const files: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 84, deletions: 0, patch: PATCH },
  { path: "src/config.ts", additions: 4, deletions: 0, patch: PATCH },
  { path: "package.json", additions: 3, deletions: 1, patch: PATCH },
] as PrFile[];

const finding = (over: Partial<FindingRecord>): FindingRecord =>
  ({
    id: "f-1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/middleware/ratelimit.ts",
    start_line: 26,
    end_line: 26,
    rationale: "r",
    confidence: 0.9,
    kind: "finding",
    ...over,
  }) as FindingRecord;

const smartDiff = (over: Partial<SmartDiff> = {}): SmartDiff => ({
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          pseudocode_summary: null,
          additions: 84,
          deletions: 0,
          finding_lines: [26],
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "src/config.ts",
          pseudocode_summary: null,
          additions: 4,
          deletions: 0,
          finding_lines: [],
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "package.json",
          pseudocode_summary: null,
          additions: 3,
          deletions: 1,
          finding_lines: [],
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 92, proposed_splits: [] },
  ...over,
});

function renderViewer(props: Partial<React.ComponentProps<typeof SmartDiffViewer>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <SmartDiffViewer
        smartDiff={smartDiff()}
        files={files}
        findings={[finding({})]}
        repoFullName="acme/payments-api"
        headSha="a1b2c3d4"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer — role sections", () => {
  it("renders one section per group with its label, description, and file count", () => {
    renderViewer();
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.getByText("The substance of the change — review closely")).toBeInTheDocument();
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
    expect(screen.getAllByText("1 files")).toHaveLength(3);
  });

  it("renders groups in the order the server sent them", () => {
    renderViewer();
    const labels = screen
      .getAllByText(/^(Core logic|Wiring|Boilerplate)$/)
      .map((el) => el.textContent);
    expect(labels).toEqual(["Core logic", "Wiring", "Boilerplate"]);
  });

  it("omits a role the server did not send", () => {
    renderViewer({
      smartDiff: smartDiff({ groups: [smartDiff().groups[0]!] }),
    });
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.queryByText("Boilerplate")).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — auto-open", () => {
  it("expands a file that has finding_lines and leaves the others collapsed", () => {
    renderViewer();
    // The flagged file's patch text is rendered; the unflagged ones' is not.
    expect(screen.getAllByText(/const count = await redis\.incr\(key\);/)).toHaveLength(1);
  });

  it("collapses every file when no review has run yet", () => {
    const doc = smartDiff();
    doc.groups[0]!.files[0]!.finding_lines = [];
    renderViewer({ smartDiff: doc, findings: [] });
    expect(screen.queryByText(/const count = await redis\.incr\(key\);/)).not.toBeInTheDocument();
  });

  it("opens a collapsed file when its header is clicked", () => {
    renderViewer();
    fireEvent.click(screen.getByRole("button", { name: /package\.json/ }));
    expect(screen.getAllByText(/const count = await redis\.incr\(key\);/)).toHaveLength(2);
  });

  // Regression: `open` used to be seeded once via useState(hasFindings). The card's
  // key is the stable file path, so a review completing mid-view (invalidateSmartDiff
  // refetches, finding_lines [] → [26]) left the newly-flagged file collapsed.
  it("expands a file that becomes flagged after a review completes", () => {
    const before = smartDiff();
    before.groups[0]!.files[0]!.finding_lines = [];
    const { rerender } = renderViewer({ smartDiff: before, findings: [] });
    expect(screen.queryByText(/const count = await redis\.incr\(key\);/)).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
        <SmartDiffViewer
          smartDiff={smartDiff()}
          files={files}
          findings={[finding({})]}
          repoFullName="acme/payments-api"
          headSha="a1b2c3d4"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText(/const count = await redis\.incr\(key\);/)).toHaveLength(1);
  });

  // The override must survive a refetch, or the card would fight the user.
  it("keeps a user's manual collapse when the data refetches", () => {
    const { rerender } = renderViewer();
    fireEvent.click(screen.getByRole("button", { name: /ratelimit\.ts/ }));
    expect(screen.queryByText(/const count = await redis\.incr\(key\);/)).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
        <SmartDiffViewer
          smartDiff={smartDiff()}
          files={files}
          findings={[finding({})]}
          repoFullName="acme/payments-api"
          headSha="a1b2c3d4"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(/const count = await redis\.incr\(key\);/)).not.toBeInTheDocument();
  });

  it("marks the collapse state on the toggle for assistive tech", () => {
    renderViewer();
    expect(screen.getByRole("button", { name: /ratelimit\.ts/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /package\.json/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("SmartDiffViewer — severity chips", () => {
  it("labels the chip from the finding's severity", () => {
    renderViewer();
    expect(screen.getByRole("button", { name: /blocker/ })).toBeInTheDocument();
  });

  it.each([
    ["CRITICAL", "blocker"],
    ["WARNING", "warning"],
    ["SUGGESTION", "suggestion"],
  ])("%s renders as %s", (severity, label) => {
    renderViewer({ findings: [finding({ severity: severity as FindingRecord["severity"] })] });
    expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
  });

  it("collapses several findings on one line into a single, uncounted chip", () => {
    // Real case: repos/routes.ts drew three identical `blocker` pills, because
    // several agents flagged the same breaking change (CRITICAL 46-46, 46-48,
    // and a third starting on 47). The chip carries the severity ONLY: a count
    // beside a severity label reads as a count of that severity, which is wrong
    // the moment the findings on a line differ (a WARNING + a CRITICAL rendered
    // as "blocker ×2" asserts two blockers).
    renderViewer({
      findings: [
        finding({ id: "f-a", severity: "CRITICAL", start_line: 26, end_line: 26 }),
        finding({ id: "f-b", severity: "CRITICAL", start_line: 26, end_line: 27 }),
      ],
    });
    const chips = screen.getAllByRole("button", { name: /blocker/ });
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent(/^blocker$/);
  });

  // The fixture patch renders context line 24, then added lines 25, 26, 27.
  /** The rendered diff row that contains a given chip. */
  const rowOf = (chipEl: HTMLElement) => chipEl.closest("div")?.textContent ?? "";

  it("anchors the chip to the first CHANGED line in range, not the cited start", () => {
    // Real case: WARNING 135-142 cited a whole method whose line 135 is untouched
    // `.select()`; the badge belongs on 138, the `.orderBy` that actually changed.
    renderViewer({ findings: [finding({ start_line: 24, end_line: 26 })] });
    const chipEl = screen.getByRole("button", { name: /blocker/ });
    expect(rowOf(chipEl)).toContain("const key = bucketKey(req);"); // line 25, an add
    expect(rowOf(chipEl)).not.toContain("export async function rateLimit");
  });

  it("falls back to the cited start when the range covers no changed line", () => {
    renderViewer({ findings: [finding({ start_line: 24, end_line: 24 })] });
    const chipEl = screen.getByRole("button", { name: /blocker/ });
    expect(rowOf(chipEl)).toContain("export async function rateLimit"); // line 24, context
  });

  it("separates two findings that share a start line but differ in range", () => {
    // This is the 135-135 / 135-142 pair: one stays on the context line it cites,
    // the other moves to the changed line it covers — two chips, two rows.
    renderViewer({
      findings: [
        finding({ id: "f-narrow", severity: "WARNING", start_line: 24, end_line: 24 }),
        finding({ id: "f-wide", severity: "WARNING", start_line: 24, end_line: 26 }),
      ],
    });
    const chips = screen.getAllByRole("button", { name: /warning/ });
    expect(chips).toHaveLength(2);
    expect(chips.map(rowOf).some((r) => r.includes("export async function rateLimit"))).toBe(true);
    expect(chips.map(rowOf).some((r) => r.includes("const key = bucketKey(req);"))).toBe(true);
    expect(chips.every((c) => c.textContent === "warning")).toBe(true);
  });

  it("labels the chip with the WORST severity starting on the line", () => {
    renderViewer({
      findings: [
        finding({ id: "f-sugg", severity: "SUGGESTION" }),
        finding({ id: "f-crit", severity: "CRITICAL" }),
      ],
    });
    expect(screen.getByRole("button", { name: /blocker/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /suggestion/ })).not.toBeInTheDocument();
  });

  it("opens the worst finding on the line, and names them all in the tooltip", () => {
    const onFocusFinding = vi.fn();
    renderViewer({
      findings: [
        finding({ id: "f-sugg", severity: "SUGGESTION", title: "Minor nit" }),
        finding({ id: "f-crit", severity: "CRITICAL", title: "Breaking change" }),
      ],
      onFocusFinding,
    });
    const chipEl = screen.getByRole("button", { name: /blocker/ });
    expect(chipEl).toHaveAttribute("title", "Breaking change\nMinor nit");
    fireEvent.click(chipEl);
    expect(onFocusFinding).toHaveBeenCalledWith("f-crit");
  });

  it("calls onFocusFinding with that finding's id when clicked", () => {
    const onFocusFinding = vi.fn();
    renderViewer({ findings: [finding({ id: "f-42" })], onFocusFinding });

    fireEvent.click(screen.getByRole("button", { name: /blocker/ }));
    expect(onFocusFinding).toHaveBeenCalledWith("f-42");
  });

  it("renders ONE chip for a wide-range finding, on the line it cites", () => {
    // A finding spanning the whole file would otherwise stamp a chip on every
    // row; the edge bar carries the range, the chip marks the anchor.
    renderViewer({ findings: [finding({ start_line: 25, end_line: 27 })] });
    expect(screen.getAllByRole("button", { name: /blocker/ })).toHaveLength(1);
  });

  it("ignores a finding with no start line — it anchors to nothing", () => {
    renderViewer({
      findings: [finding({ start_line: null as unknown as number, end_line: null as unknown as number })],
    });
    expect(screen.queryByRole("button", { name: /blocker/ })).not.toBeInTheDocument();
  });

  it("ignores a finding whose file is not in the diff", () => {
    renderViewer({ findings: [finding({ file: "src/gone.ts" })] });
    expect(screen.queryByRole("button", { name: /blocker/ })).not.toBeInTheDocument();
  });
});

describe("SmartDiffViewer — line highlighting", () => {
  /** The severity bar colour on the row rendering a given piece of code. */
  const barOn = (code: string | RegExp) => {
    const row = screen.getByText(code).closest("div") as HTMLElement;
    return row.style.borderLeftColor;
  };

  it("paints only the CHANGED lines a wide finding covers, not the context between", () => {
    // The real case: SUGGESTION 23-33 covered `id: r.id,` and
    // `cloned: Boolean(…)`, neither of which it said anything about.
    renderViewer({ findings: [finding({ start_line: 24, end_line: 28 })] });
    expect(barOn(/const key = bucketKey/)).toBe("var(--crit)"); // 25, added
    expect(barOn(/const count = await redis/)).toBe("var(--crit)"); // 26, added
    expect(barOn(/export async function rateLimit/)).toBe("transparent"); // 24, context
    expect(barOn(/return next\(\)/)).toBe("transparent"); // 28, context
  });

  it("leaves a line covered by no finding undecorated", () => {
    renderViewer({ findings: [finding({ start_line: 25, end_line: 25 })] });
    expect(barOn(/const key = bucketKey/)).toBe("var(--crit)");
    expect(barOn(/const count = await redis/)).toBe("transparent");
  });

  it("clamps an absurd end_line to the server's span cap", () => {
    // The grounding gate keeps `1-999999` (it does intersect a hunk), so the
    // client must cap it too — otherwise it walks a million numbers per render
    // and disagrees with the server's `finding_lines`.
    renderViewer({ findings: [finding({ start_line: 25, end_line: 999_999 })] });
    // Line 25 is inside the cap and added; the chip anchors there, once.
    expect(screen.getAllByRole("button", { name: /blocker/ })).toHaveLength(1);
    expect(barOn(/const key = bucketKey/)).toBe("var(--crit)");
  });

  it("paints a context line when the finding's range changed nothing", () => {
    // Otherwise a finding about untouched code would be invisible.
    renderViewer({ findings: [finding({ start_line: 24, end_line: 24 })] });
    expect(barOn(/export async function rateLimit/)).toBe("var(--crit)");
  });

  it("takes the worst severity when findings overlap on a line", () => {
    renderViewer({
      findings: [
        finding({ id: "f-sugg", severity: "SUGGESTION", start_line: 25, end_line: 27 }),
        finding({ id: "f-crit", severity: "CRITICAL", start_line: 26, end_line: 26 }),
      ],
    });
    expect(barOn(/const key = bucketKey/)).toBe("var(--sugg)"); // 25, suggestion only
    expect(barOn(/const count = await redis/)).toBe("var(--crit)"); // 26, both
  });
});

describe("SmartDiffViewer — split nudge", () => {
  it("is absent when the PR is not too big", () => {
    renderViewer();
    expect(screen.queryByText(/This PR is large/)).not.toBeInTheDocument();
  });

  it("renders the banner and the proposed splits when too big", () => {
    renderViewer({
      smartDiff: smartDiff({
        split_suggestion: {
          too_big: true,
          total_lines: 812,
          proposed_splits: [
            { name: "core", files: ["src/middleware/ratelimit.ts"] },
            { name: "boilerplate", files: ["package.json", "pnpm-lock.yaml"] },
          ],
        },
      }),
    });
    expect(screen.getByText("This PR is large (812 changed lines)")).toBeInTheDocument();
    expect(screen.getByText(/core · 1 files/)).toBeInTheDocument();
    expect(screen.getByText(/boilerplate · 2 files/)).toBeInTheDocument();
  });
});

describe("SmartDiffViewer — GitHub links", () => {
  it("links a file path to its blob at the head sha", () => {
    renderViewer();
    // The link is a trailing icon sibling of the collapse button (a <button> may
    // not contain a link), so its accessible name comes from its aria-label.
    const link = screen.getByRole("link", {
      name: "Open src/middleware/ratelimit.ts on GitHub",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/a1b2c3d4/src/middleware/ratelimit.ts",
    );
  });

  it("renders plain text instead of a dead link when the sha is missing", () => {
    // An empty sha would yield `…/blob//path` — a 404, not a catchable error.
    renderViewer({ headSha: "" });
    expect(
      screen.queryByRole("link", { name: /src\/middleware\/ratelimit\.ts/ }),
    ).not.toBeInTheDocument();
    const header = screen.getByRole("button", { name: /ratelimit\.ts/ });
    expect(within(header).getByText("src/middleware/ratelimit.ts")).toBeInTheDocument();
  });
});
