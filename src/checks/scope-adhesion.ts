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
 *    (omitted); there is nothing to measure adherence over and the story is
 *    already decided by the gate. `status:'pass'`.
 *  - `0 < denom < SMALL_CHANGESET` WITH out-of-scope files → a partial ratio over
 *    1–4 files is statistically noisy (1 file = 25%+) and must not be thresholded
 *    against the hard floor, so we do NOT compute it; instead we list every
 *    out-of-scope file as an `info` finding. `status:'pass'`.
 *  - otherwise → `score = |in_scope| / denom`. This INCLUDES a perfectly clean
 *    small changeset (everything in scope → `score = 1.0`): a passing scope check
 *    is emitted explicitly, never as silence — green must read as clearly as red.
 *    An empty `allow` on a large changeset means everything non-forbidden is
 *    out_of_scope → `score = 0` (an honest penalty for no pre-commitment).
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

  // denom === 0 → forbidden-only or empty changeset: nothing to measure, score
  // is null (omitted) — the gate already decides the story.
  if (denom === 0) {
    return { check: "scope-adhesion", status: "pass", findings };
  }

  // Small changeset WITH out-of-scope files → a noisy partial ratio: list the
  // offenders as info and withhold the score rather than threshold 1–4 files.
  if (denom < SMALL_CHANGESET && outOfScope.length > 0) {
    return { check: "scope-adhesion", status: "pass", findings };
  }

  // Everything else is scored explicitly — including a fully in-scope small
  // changeset (score 1.0), so a clean result surfaces instead of going silent.
  const score = inScope / denom;
  return { check: "scope-adhesion", status: "pass", score, findings };
}

export const check: Check = {
  id: "scope-adhesion",
  cls: "git-only",
  requires: ["diff", "contract"],
  run,
};
