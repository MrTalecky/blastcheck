/**
 * Serialize domain objects → `scorecard.json` (AR5, NFR9, spec §4).
 *
 * This is the camelCase→snake_case crossing on the way OUT (consistency rule #1):
 * every key the verdict engine and checks speak in camelCase becomes snake_case
 * here, and NOWHERE else. The product is run through `scorecardSchema` before it
 * is returned, so a serialization bug is caught here, not on a consumer's plate.
 *
 * Two key namespaces (story Dev Notes):
 *  - check IDENTITY (`gates`, `evidence_level.checks`, `findings[].check`) stays
 *    `CheckId` kebab-case — it is the single source of truth (AR7).
 *  - `scores` is re-keyed to score-id snake_case via {@link CHECK_ID_TO_SCORE_ID}
 *    (camel) → {@link camelToSnake}.
 */

import type { CheckResult, Contract, DiffEntry, EvidenceLevel } from "../types.js";
import { SCHEMA_VERSION, type Scorecard, scorecardSchema } from "./schema.js";
import { GATE_CHECK_IDS, scoreIdFor } from "./verdict.js";

/** Everything `serialize` needs to assemble a git-only scorecard. */
export interface SerializeInput {
  results: CheckResult[];
  evidenceLevel: EvidenceLevel;
  contract: Contract;
  baselineSha: string;
  headSha: string;
  verdict: "pass" | "warn" | "fail";
  /** ISO timestamp; non-deterministic — never pinned in tests. */
  runId: string;
  /** Diff used for the git-only `stats` block. */
  diff: DiffEntry[];
  /** Tracked-file count at baseline (`git ls-files`) — the churn-% denominator. */
  repoSize: number;
  /** Agent identity; `null` in git-only runs (no trajectory). */
  agent?: string | null;
}

/** camelCase → snake_case. Used ONLY for score ids at this output boundary. */
function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const GATE_IDS = GATE_CHECK_IDS as readonly string[];

/**
 * Git-only `stats` subset (spec §4). `churn_pct` inherits the files-proxy
 * denominator decision from the `churn` check (Story 1.3 deferred debt #3): with
 * no baseline LINE count available, `repoSize` is the tracked-FILE count. A
 * non-positive repo size yields `0` rather than a NaN/Infinity.
 */
function computeStats(diff: DiffEntry[], repoSize: number): Scorecard["stats"] {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const d of diff) {
    linesAdded += d.added ?? 0;
    linesRemoved += d.removed ?? 0;
  }
  const churnPct =
    repoSize > 0 && Number.isFinite(repoSize) ? ((linesAdded + linesRemoved) / repoSize) * 100 : 0;
  return {
    files_changed: diff.length,
    lines_added: linesAdded,
    lines_removed: linesRemoved,
    churn_pct: churnPct,
  };
}

/** Gate results → `{ checkId: 'pass'|'fail' }`. A skipped gate is omitted (no data). */
function buildGates(results: CheckResult[]): Scorecard["gates"] {
  const gates: Record<string, "pass" | "fail"> = {};
  for (const r of results) {
    if (GATE_IDS.includes(r.check) && (r.status === "pass" || r.status === "fail")) {
      gates[r.check] = r.status;
    }
  }
  return gates;
}

/** Scored results → `{ score_id_snake: number }`. Gate checks carry no score. */
function buildScores(results: CheckResult[]): Scorecard["scores"] {
  const scores: Record<string, number> = {};
  for (const r of results) {
    if (r.score === undefined) continue;
    // A non-finite score (NaN/Infinity) is a producer bug. Drop it rather than
    // crash the whole audit: `z.number()` rejects NaN, so emitting it would
    // throw at `scorecardSchema.parse` below. This mirrors the verdict engine,
    // which already ignores non-finite scores (degradation over refusal, NFR2).
    if (!Number.isFinite(r.score)) continue;
    const scoreId = scoreIdFor(r.check);
    if (scoreId === undefined) continue; // defensive: a gate should never carry a score.
    scores[camelToSnake(scoreId)] = r.score;
  }
  return scores;
}

/** All findings, flattened, each tagged with its producing `CheckId`. */
function buildFindings(results: CheckResult[]): Scorecard["findings"] {
  return results.flatMap((r) =>
    r.findings.map((f) => ({
      check: r.check,
      severity: f.severity,
      message: f.message,
      ...(f.path !== undefined ? { path: f.path } : {}),
      ...(f.evidence !== undefined ? { evidence: f.evidence } : {}),
    })),
  );
}

/**
 * Build, validate, and return the `scorecard.json` object. The returned value is
 * the parsed (schema-validated) {@link Scorecard}; a serialization bug surfaces
 * as a thrown `ZodError` here rather than as malformed output downstream.
 */
export function serialize(input: SerializeInput): Scorecard {
  const candidate = {
    schema_version: SCHEMA_VERSION,
    run_id: input.runId,
    agent: input.agent ?? null,
    baseline_sha: input.baselineSha,
    head_sha: input.headSha,
    task_goal: input.contract.goal,
    verdict: input.verdict,
    evidence_level: {
      trajectory: input.evidenceLevel.trajectory,
      checks: input.evidenceLevel.checks,
    },
    gates: buildGates(input.results),
    scores: buildScores(input.results),
    findings: buildFindings(input.results),
    stats: computeStats(input.diff, input.repoSize),
  };
  // Self-validation: the output trust boundary (rule #1). Throws on our own bug.
  return scorecardSchema.parse(candidate);
}
