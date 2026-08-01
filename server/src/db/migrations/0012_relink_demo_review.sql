-- Repair demo data seeded before specs/0002-findings-badges.md.
--
-- The old seed wrote ONE review for the demo PR with `run_id` and `agent_id`
-- both NULL. The Agent-runs timeline attributes findings to a run through
-- `reviews.run_id`, so that review's findings could not attach to anything and
-- every run row fell back to its plain "N finding(s)" text. The PR list was
-- unaffected — it joins on `reviews.pr_id`, which the row does have.
--
-- `run_id IS NULL` can only come from that old seed: ReviewRunExecutor creates
-- the agent_runs row BEFORE the review and always passes runId, so no real
-- review can lack one. Combined with `model = 'seed'` this targets exactly the
-- legacy row and nothing a user or a real run produced.
--
-- UPDATE only — nothing is deleted. Both statements are strict no-ops on a
-- fresh database: migrations run before the seed, so there are no agent_runs
-- rows to match yet.

-- 1. Attach the orphan to the newest COMPLETED run on its PR, and adopt that
--    run's agent so the Review-runs accordion stops rendering a nameless
--    "Agent". Only runs that do not already own a review are eligible.
UPDATE "reviews" AS r
SET "run_id" = ar."id",
    "agent_id" = ar."agent_id"
FROM (
  SELECT DISTINCT ON (a."pr_id") a."id", a."pr_id", a."agent_id"
  FROM "agent_runs" a
  WHERE a."status" = 'done'
    AND NOT EXISTS (SELECT 1 FROM "reviews" x WHERE x."run_id" = a."id")
  ORDER BY a."pr_id", a."ran_at" DESC
) AS ar
WHERE r."pr_id" = ar."pr_id"
  AND r."model" = 'seed'
  AND r."run_id" IS NULL;
--> statement-breakpoint
-- 2. Realign that run's denormalised counters with the review it now owns. The
--    timeline renders the severity badges from the findings and the "· N
--    blockers" suffix from the run row, so leaving the old counts would put two
--    contradictory numbers on one line (badges totalling 2 beside "3 findings").
--    `blockers` counts findings that trip the gate, i.e. CRITICAL.
UPDATE "agent_runs" AS a
SET "findings_count" = agg."total",
    "blockers" = agg."crit",
    "score" = agg."score"
FROM (
  SELECT r."run_id",
         r."score",
         count(f."id") AS "total",
         count(f."id") FILTER (WHERE f."severity" = 'CRITICAL') AS "crit"
  FROM "reviews" r
  LEFT JOIN "findings" f ON f."review_id" = r."id"
  WHERE r."model" = 'seed' AND r."run_id" IS NOT NULL
  GROUP BY r."run_id", r."score"
) AS agg
WHERE a."id" = agg."run_id"
  AND a."findings_count" IS DISTINCT FROM agg."total";
