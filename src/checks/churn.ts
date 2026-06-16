/**
 * Check `churn` — "rewrote half the project" detector (FR9). Class: git-only.
 *
 * From `git diff --numstat` (`ctx.diff`):
 *  - `linesAdded` / `linesRemoved` — summed across files (binary files report
 *    `null` counts and contribute 0).
 *  - `filesChanged` — number of diff entries.
 *  - `churnPct = (linesAdded + linesRemoved) / repoSize * 100`.
 *  - `thrashFiles` — files written then largely reverted (see THRASH_CUTOFF).
 *
 * Two-level gate against `budget.maxChurnPct`:
 *  - `churnPct > maxChurnPct`      → `warn` (+ `warn` finding)
 *  - `churnPct > 2 * maxChurnPct`  → `fail` (+ `high` finding)
 *
 * `score = churnDiscipline = clamp(1 − churnPct / (2 * maxChurnPct), 0, 1)` is
 * always set. Thresholds for the score are applied by the verdict engine
 * (Story 1.4); this check only produces status + score + findings.
 *
 * DENOMINATOR — files-proxy (decision, Story 1.3): the spec's `churn_pct` wants
 * `baseline_repo_lines`, but the foundation wires `ctx.repoSize` from
 * `git ls-files` = the count of tracked FILES, not lines. No baseline line count
 * is available, so for v1 we use the file count as the denominator and document
 * the deviation here. `maxChurnPct` calibration is relative to this proxy.
 */

import type { Check, CheckContext, CheckResult, CheckStatus, Finding } from "../types.js";

/** A file counts as thrash when reverted lines are ≥ half the written lines. */
const THRASH_CUTOFF = 0.5;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function run(ctx: CheckContext): CheckResult {
  const { contract } = ctx;
  const diff = ctx.diff ?? [];
  const repoSize = ctx.repoSize ?? 0;
  const maxChurnPct = contract.budget.maxChurnPct;

  let linesAdded = 0;
  let linesRemoved = 0;
  const thrashFiles: string[] = [];

  for (const d of diff) {
    const added = d.added ?? 0;
    const removed = d.removed ?? 0;
    linesAdded += added;
    linesRemoved += removed;
    // Thrash = written then reverted. Skip binary files (null line counts).
    if (d.added !== null && d.removed !== null && added > 0 && removed > 0) {
      const ratio = Math.min(added, removed) / Math.max(added, removed);
      if (ratio >= THRASH_CUTOFF) thrashFiles.push(d.path);
    }
  }

  // Guard divide-by-zero: with no usable baseline size a percentage is
  // meaningless. Reject non-finite (NaN/Infinity) too, not just `<= 0` — a NaN
  // would slip past a bare `<= 0` test and poison `churnPct`/`score`.
  // Degradation, not refusal — skip with a reason rather than emit a bad number.
  if (!Number.isFinite(repoSize) || repoSize <= 0) {
    return {
      check: "churn",
      status: "skipped",
      reason: "baseline repo size unavailable (repoSize must be a positive number)",
      findings: [],
    };
  }

  const filesChanged = diff.length;
  const churnPct = ((linesAdded + linesRemoved) / repoSize) * 100;
  // `budget2x` is the fail threshold AND the score denominator. When it is not a
  // positive finite number (e.g. `max_churn_pct: 0`, reachable via .blastcheck.yml
  // since zod allows non-negative), `1 − churnPct/budget2x` would be NaN (0/0) or
  // ±Infinity — and `clamp` does NOT sanitize NaN. Handle the degenerate budget
  // explicitly: zero tolerance ⇒ any churn is worst discipline, none is perfect.
  const budget2x = 2 * maxChurnPct;
  let churnDiscipline: number;
  if (budget2x > 0 && Number.isFinite(budget2x)) {
    churnDiscipline = clamp(1 - churnPct / budget2x, 0, 1);
  } else {
    churnDiscipline = churnPct > 0 ? 0 : 1;
  }

  const findings: Finding[] = thrashFiles.map((path) => ({
    severity: "info",
    message: `file written then largely reverted (thrash): ${path}`,
    path,
  }));

  let status: CheckStatus = "pass";
  if (churnPct > budget2x) {
    status = "fail";
    findings.push({
      severity: "high",
      message: `churn ${churnPct.toFixed(1)}% exceeds 2× budget (${budget2x}%)`,
      evidence: { churnPct, filesChanged, linesAdded, linesRemoved },
    });
  } else if (churnPct > maxChurnPct) {
    status = "warn";
    findings.push({
      severity: "warn",
      message: `churn ${churnPct.toFixed(1)}% exceeds budget (${maxChurnPct}%)`,
      evidence: { churnPct, filesChanged, linesAdded, linesRemoved },
    });
  }

  return { check: "churn", status, score: churnDiscipline, findings };
}

export const check: Check = {
  id: "churn",
  cls: "git-only",
  requires: ["diff", "contract", "repoSize"],
  run,
};
