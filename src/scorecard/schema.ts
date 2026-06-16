/**
 * Output schema for `scorecard.json` — the trust boundary on the WAY OUT
 * (AR5, AR11, consistency rule #1).
 *
 * This is the second (and only other) place the camelCase↔snake_case boundary
 * is crossed: `contract/schema.ts` validates external input, this validates the
 * machine-readable output before it is printed. Every field here is snake_case;
 * `serialize.ts` runs its product through this schema so a stray camelCase key
 * or a malformed shape is caught before it reaches `stdout`, not after.
 *
 * Two key NAMESPACES coexist (story Dev Notes — do not conflate):
 *  - check IDENTITY (`evidence_level.checks` keys, `gates` keys, `findings[].check`)
 *    is `CheckId` kebab-case (`denied-files`, `scope-adhesion`, …).
 *  - `scores` is keyed by score id snake_case (`scope_adherence`, `churn_discipline`, …).
 *
 * `schema_version` is forward-compat metadata (AR11): a fixed string `"1"` in
 * v1, so a future consumer can branch on it.
 */

import { z } from "zod";

/** Forward-compatibility version of the scorecard format (AR11). */
export const SCHEMA_VERSION = "1";

/** Coverage of one check in the evidence profile (mirrors `CheckCoverage`). */
const coverageSchema = z.enum(["full", "partial", "skipped", "absent"]);

/** One finding in the scorecard. `check` is a `CheckId` kebab-case identity. */
const findingSchema = z
  .object({
    check: z.string(),
    severity: z.enum(["info", "warn", "high"]),
    message: z.string(),
    path: z.string().optional(),
    // Debug raw material, preserved in the machine output but never consumed by
    // the verdict engine (consistency: verdict reads status/severity/score only).
    evidence: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** Git-only stats subset (Story 1.4). Trajectory stats (tool calls, …) — Epic 2. */
const statsSchema = z
  .object({
    files_changed: z.number(),
    lines_added: z.number(),
    lines_removed: z.number(),
    churn_pct: z.number(),
  })
  .strict();

/**
 * The full `scorecard.json` shape. `.strict()` rejects any unknown top-level key
 * — a camelCase leak (e.g. `taskGoal`) fails validation rather than silently
 * shipping. Dynamic-key maps (`gates`/`scores`/`evidence_level.checks`) use
 * `z.record`, since their keys are check/score ids, not a fixed set.
 */
export const scorecardSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    run_id: z.string(),
    /** Agent identity — `null` in git-only runs (no trajectory; Epic 2/3 fill it). */
    agent: z.string().nullable(),
    baseline_sha: z.string(),
    head_sha: z.string(),
    task_goal: z.string().nullable(),
    verdict: z.enum(["pass", "warn", "fail"]),
    evidence_level: z
      .object({
        trajectory: z.enum(["present", "absent"]),
        checks: z.record(z.string(), coverageSchema),
      })
      .strict(),
    /** Gate checks only (`denied-files`/`required-checks`); skipped gates omitted. */
    gates: z.record(z.string(), z.enum(["pass", "fail"])),
    /** Score-based checks only, keyed by snake_case score id. */
    scores: z.record(z.string(), z.number()),
    findings: z.array(findingSchema),
    stats: statsSchema,
  })
  .strict();

/**
 * The canonical machine-readable audit output. This is the ONE domain object in
 * snake_case (it *is* the JSON boundary); everything upstream is camelCase.
 * `runAudit` returns it; `cli.ts` serializes it verbatim to `stdout`.
 */
export type Scorecard = z.infer<typeof scorecardSchema>;
