/**
 * Verdict engine (FR14, spec §4 «Логика вердикта»).
 *
 * A PURE function of `(results, thresholds)`: it reads ONLY `status`, finding
 * `severity`, and `score` — never `finding.evidence` (debug raw material). It
 * never throws and never mutates its inputs. `skipped` results are excluded
 * entirely (they neither fail nor warn) — the audit degrades on missing data,
 * it does not punish it.
 *
 * Priority order (spec §4, FR14) — FIRST match wins:
 *  1. any `status === 'fail'`                                → fail (gate / churn 2×)
 *  2. any `finding.severity === 'high'`                      → fail
 *  3. any scored result `score < hardFloor[scoreId]`         → fail
 *  4. any `status === 'warn'` OR `finding.severity === 'warn'` → warn
 *  5. any scored result `score < threshold[scoreId]`         → warn
 *  6. otherwise                                              → pass
 */

import type { CheckId } from "../checks/registry.js";
import type { CheckResult } from "../types.js";

/**
 * Hard floors below which a score crit-fails the audit (spec §4.1). Keyed by
 * camelCase score id — the SAME namespace as `Contract.thresholds`. These are
 * starting heuristics, NOT validated thresholds.
 *
 * Only two scores have a floor. `churnDiscipline` has none — the `churn` check
 * itself emits `status:'fail'` at 2× budget, so a floor would be redundant.
 * `progress` has none — it is binary (loop-detection, Epic 2). The ABSENCE of a
 * key means "no floor" — do NOT add `0` floors, or the floor test would fire on
 * every legitimately-zero score.
 *
 * `hard_floor` is fixed in v1 — NOT overridable via `.blastcheck.yml` (only the
 * warn thresholds are; calibration is spec §8, out of scope for v1).
 */
export const DEFAULT_HARD_FLOORS: Record<string, number> = {
  scopeAdherence: 0.5,
  toolEfficiency: 0.3,
};

/**
 * Hard floors re-keyed by the snake_case score id used at the `scorecard.json`
 * boundary (`scope_adherence`, `tool_efficiency`) — derived from
 * {@link DEFAULT_HARD_FLOORS} so the floor VALUES stay single-sourced and never
 * drift. The shared `verdict-text` renderer needs to name a sub-floor dimension
 * from a `Scorecard` (whose `scores` keys are snake_case), but cannot reach
 * `serialize.ts`'s private `camelToSnake` without a circular import — so the
 * conversion is duplicated here (one-directional: `verdict-text` → `verdict`).
 */
const camelToSnake = (k: string): string => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const HARD_FLOOR_BY_SCORE_ID: Record<string, number> = Object.fromEntries(
  Object.entries(DEFAULT_HARD_FLOORS).map(([camel, v]) => [camelToSnake(camel), v]),
);

/**
 * Score-producing checks → their camelCase score id (spec §4.1). The SINGLE
 * source of truth for the `CheckId`↔scoreId mapping, reused by `serialize.ts`.
 *
 * Gate checks (`denied-files`, `required-checks`) produce NO score and are
 * deliberately absent. Two key namespaces coexist in `scorecard.json` (story
 * Dev Notes): check IDENTITY is `CheckId` kebab-case; SCORES are keyed by the
 * score id (snake_case at the JSON boundary).
 */
export const CHECK_ID_TO_SCORE_ID = {
  "scope-adhesion": "scopeAdherence",
  "extraneous-tool-calls": "toolEfficiency",
  churn: "churnDiscipline",
  "loop-detection": "progress",
} as const satisfies Partial<Record<CheckId, string>>;

/** Gate checks: `pass`/`fail` status only, never a `score` (consistency rule #2). */
export const GATE_CHECK_IDS = [
  "denied-files",
  "required-checks",
] as const satisfies readonly CheckId[];

/** The camelCase score id for a check, or `undefined` for gate checks. */
export function scoreIdFor(check: CheckId): string | undefined {
  return (CHECK_ID_TO_SCORE_ID as Partial<Record<CheckId, string>>)[check];
}

/**
 * A scored result is below its hard floor. Returns `false` for gate checks
 * (no scoreId), scores whose id has no floor, and non-finite scores (a `NaN`
 * comparison is always `false`, so a malformed score is ignored rather than
 * crashing the gate — degradation over refusal).
 */
function belowHardFloor(r: CheckResult): boolean {
  if (r.score === undefined) return false;
  const scoreId = scoreIdFor(r.check);
  if (scoreId === undefined) return false;
  const floor = DEFAULT_HARD_FLOORS[scoreId];
  return floor !== undefined && r.score < floor;
}

/** A scored result is below its warn threshold (same guards as the floor test). */
function belowWarnThreshold(r: CheckResult, thresholds: Record<string, number>): boolean {
  if (r.score === undefined) return false;
  const scoreId = scoreIdFor(r.check);
  if (scoreId === undefined) return false;
  const threshold = thresholds[scoreId];
  return threshold !== undefined && r.score < threshold;
}

/**
 * Compute the audit verdict from check results and warn thresholds.
 *
 * @param results    every check's {@link CheckResult} (from the runner).
 * @param thresholds warn-below thresholds keyed by camelCase score id
 *                   (`contract.thresholds`, already assembled by the resolver).
 */
export function verdict(
  results: CheckResult[],
  thresholds: Record<string, number>,
): "pass" | "warn" | "fail" {
  // `skipped` never influences the verdict (spec §4) — exclude it up front so
  // the rules below operate only on checks that actually ran.
  const considered = results.filter((r) => r.status !== "skipped");

  // 1. any hard fail (gate `denied-files`/`required-checks`; `churn` at 2×).
  if (considered.some((r) => r.status === "fail")) return "fail";

  // 2. any high-severity finding.
  if (considered.some((r) => r.findings.some((f) => f.severity === "high"))) {
    return "fail";
  }

  // 3. any scored result below its hard floor (where a floor is defined).
  if (considered.some(belowHardFloor)) return "fail";

  // 4. any warn status or warn finding.
  if (
    considered.some((r) => r.status === "warn" || r.findings.some((f) => f.severity === "warn"))
  ) {
    return "warn";
  }

  // 5. any scored result below its warn threshold.
  if (considered.some((r) => belowWarnThreshold(r, thresholds))) return "warn";

  // 6. nothing tripped — clean run.
  return "pass";
}
