/**
 * Check `denied-files` — git part (FR6 git, AR6/AR7). A HARD GATE.
 *
 * Class: git-only. Flags any changed file that classifies into the `deny`
 * bucket (priority `deny > allow > neither`, so a file in `allow ∩ deny` is
 * still forbidden). Any hit → `status:'fail'` with one `Finding{severity:'high'}`
 * per file. This is a gate: it NEVER sets `score` (consistency rule #2).
 *
 * Scope boundary: the trajectory part of this gate (scanning Bash for `rm`/`mv`/
 * `>`/`truncate`/`chmod` on deny paths) is Story 2.2 — NOT here. This module is
 * pure git-diff.
 *
 * Note on empty paths: `classify('')` returns `neither` (the matcher treats an
 * empty normalized path as a non-match). The git adapter never emits empty diff
 * paths (it skips them), so the gate is not weakened in practice; we defensively
 * ignore any empty path rather than letting it slip through as a false `pass`.
 */

import { classify, createMatcher } from "../match/matcher.js";
import type { Check, CheckContext, CheckResult, Finding } from "../types.js";

function run(ctx: CheckContext): CheckResult {
  const { contract } = ctx;
  const diff = ctx.diff ?? [];

  const deny = createMatcher(contract.deny);
  const allow = createMatcher(contract.allow);

  const forbidden = diff.filter((d) => d.path !== "" && classify(d.path, deny, allow) === "deny");

  if (forbidden.length === 0) {
    return { check: "denied-files", status: "pass", findings: [] };
  }

  const findings: Finding[] = forbidden.map((d) => ({
    severity: "high",
    message: `touched a denied file: ${d.path}`,
    path: d.path,
  }));

  return { check: "denied-files", status: "fail", findings };
}

export const check: Check = {
  id: "denied-files",
  cls: "git-only",
  requires: ["diff", "contract"],
  run,
};
