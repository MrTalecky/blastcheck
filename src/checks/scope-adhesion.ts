/**
 * Check `scope-adhesion` — adherence to declared scope (FR7). Class: git-only.
 *
 * `score = |in_scope| / (|in_scope| + |out_of_scope|)`, with `forbidden`
 * (the `deny` bucket) EXCLUDED from the denominator — it is already punished by
 * the `denied-files` gate, so counting it here would be double jeopardy.
 *
 * Buckets come from `classify` (priority `deny > allow > neither`):
 *  - `allow`   → in_scope
 *  - `neither` → out_of_scope
 *  - `deny`    → forbidden (excluded)
 *
 * Edge cases (spec §1.2), evaluated in this order:
 *  - `denom === 0` (changeset entirely forbidden OR empty) → `score` is null
 *    (omitted); the story is already decided by the gate. `status:'pass'`.
 *  - `0 < denom < SMALL_CHANGESET` → a ratio over 1–4 files is statistically
 *    noisy (1 file = 25%+), so we do NOT compute it; instead we list every
 *    out-of-scope file as an `info` finding. `status:'pass'`.
 *  - `denom >= SMALL_CHANGESET` → `score = |in_scope| / denom`. An empty `allow`
 *    means everything non-forbidden is out_of_scope → `score = 0` (an honest
 *    penalty for no pre-commitment).
 *
 * This check only PRODUCES the score; the warn/fail thresholds are applied by
 * the verdict engine in Story 1.4, never here.
 */

import { classify, createMatcher } from "../match/matcher.js";
import type { Check, CheckContext, CheckResult, Finding } from "../types.js";

/** Below this many in/out-of-scope files, a ratio is too noisy to threshold. */
const SMALL_CHANGESET = 5;

function run(ctx: CheckContext): CheckResult {
  const { contract } = ctx;
  const diff = ctx.diff ?? [];

  const deny = createMatcher(contract.deny);
  const allow = createMatcher(contract.allow);

  let inScope = 0;
  const outOfScope: string[] = [];
  for (const d of diff) {
    const bucket = classify(d.path, deny, allow);
    if (bucket === "allow") inScope++;
    else if (bucket === "neither") outOfScope.push(d.path);
    // bucket === "deny" → forbidden, excluded from the denominator.
  }

  const denom = inScope + outOfScope.length;

  const findings: Finding[] = outOfScope.map((path) => ({
    severity: "info",
    message: `changed a file outside declared scope: ${path}`,
    path,
  }));

  // denom === 0 → forbidden-only or empty changeset: score is null (omitted).
  // Small changeset → list out-of-scope as info, but do not score (too noisy).
  if (denom === 0 || denom < SMALL_CHANGESET) {
    return { check: "scope-adhesion", status: "pass", findings };
  }

  const score = inScope / denom;
  return { check: "scope-adhesion", status: "pass", score, findings };
}

export const check: Check = {
  id: "scope-adhesion",
  cls: "git-only",
  requires: ["diff", "contract"],
  run,
};
