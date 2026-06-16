import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGET, DEFAULT_DENY, DEFAULT_THRESHOLDS } from "../contract/defaults.js";
import type { CheckResult, Contract, DiffEntry, EvidenceLevel } from "../types.js";
import { scorecardSchema } from "./schema.js";
import { type SerializeInput, serialize } from "./serialize.js";

const contract: Contract = {
  baselineSha: "base000",
  goal: "implement the feature",
  deny: [...DEFAULT_DENY],
  allow: ["src/**"],
  requiredChecks: [],
  budget: { ...DEFAULT_BUDGET },
  thresholds: { ...DEFAULT_THRESHOLDS },
};

const diff: DiffEntry[] = [
  { path: "src/a.ts", added: 50, removed: 8 },
  { path: "src/b.ts", added: 38, removed: 4 },
];

const evidenceLevel: EvidenceLevel = {
  trajectory: "absent",
  checks: {
    "denied-files": "full",
    "scope-adhesion": "full",
    churn: "full",
    "required-checks": "skipped",
  },
};

function baseInput(results: CheckResult[]): SerializeInput {
  return {
    results,
    evidenceLevel,
    contract,
    baselineSha: "base000",
    headSha: "head111",
    verdict: "pass",
    runId: "2026-06-17T00:00:00.000Z",
    diff,
    repoSize: 100,
  };
}

describe("serialize", () => {
  const results: CheckResult[] = [
    { check: "denied-files", status: "pass", findings: [] },
    {
      check: "scope-adhesion",
      status: "pass",
      score: 0.83,
      findings: [{ severity: "info", message: "out of scope: src/x.ts", path: "src/x.ts" }],
    },
    { check: "churn", status: "pass", score: 0.91, findings: [] },
    { check: "required-checks", status: "skipped", reason: "no trajectory", findings: [] },
  ];

  it("produces a scorecard that passes its own schema", () => {
    const sc = serialize(baseInput(results));
    expect(scorecardSchema.safeParse(sc).success).toBe(true);
  });

  it("includes schema_version and the run identity", () => {
    const sc = serialize(baseInput(results));
    expect(sc.schema_version).toBe("1");
    expect(sc.run_id).toBe("2026-06-17T00:00:00.000Z");
    expect(sc.agent).toBeNull();
    expect(sc.baseline_sha).toBe("base000");
    expect(sc.head_sha).toBe("head111");
    expect(sc.task_goal).toBe("implement the feature");
  });

  it("keys scores by snake_case score id, NOT by CheckId", () => {
    const sc = serialize(baseInput(results));
    expect(sc.scores).toEqual({ scope_adherence: 0.83, churn_discipline: 0.91 });
    // The CheckId kebab form must NOT appear as a score key.
    expect(sc.scores["scope-adhesion"]).toBeUndefined();
    expect(sc.scores.churn).toBeUndefined();
  });

  it("maps extraneous-tool-calls → tool_efficiency (multi-word camel→snake)", () => {
    // The snake key is DERIVED by a regex, not pinned to the spec table; pin the
    // one multi-word id whose transform isn't exercised by the cases above.
    const withToolEff: CheckResult[] = [
      { check: "extraneous-tool-calls", status: "pass", score: 0.42, findings: [] },
    ];
    const sc = serialize(baseInput(withToolEff));
    expect(sc.scores).toEqual({ tool_efficiency: 0.42 });
    expect(sc.scores.toolEfficiency).toBeUndefined();
  });

  it("drops a non-finite score instead of crashing the schema", () => {
    // verdict ignores non-finite scores; serialize must do the same — `z.number()`
    // rejects NaN, so emitting it would throw at the schema boundary.
    const malformed: CheckResult[] = [
      { check: "scope-adhesion", status: "pass", score: Number.NaN, findings: [] },
      { check: "churn", status: "pass", score: 0.91, findings: [] },
    ];
    const sc = serialize(baseInput(malformed));
    expect(scorecardSchema.safeParse(sc).success).toBe(true);
    expect(sc.scores).toEqual({ churn_discipline: 0.91 });
    expect("scope_adherence" in sc.scores).toBe(false);
  });

  it("keeps check identity (gates / evidence / findings.check) as CheckId kebab-case", () => {
    const sc = serialize(baseInput(results));
    expect(sc.gates).toEqual({ "denied-files": "pass" });
    expect(sc.evidence_level.checks["denied-files"]).toBe("full");
    expect(sc.findings[0]?.check).toBe("scope-adhesion");
  });

  it("a gate appears in gates and never in scores", () => {
    const sc = serialize(baseInput(results));
    expect("denied-files" in sc.gates).toBe(true);
    expect(Object.keys(sc.scores)).not.toContain("denied-files");
  });

  it("omits a skipped gate from gates (no data)", () => {
    const sc = serialize(baseInput(results));
    expect("required-checks" in sc.gates).toBe(false);
  });

  it("computes the git-only stats subset from the diff", () => {
    const sc = serialize(baseInput(results));
    expect(sc.stats.files_changed).toBe(2);
    expect(sc.stats.lines_added).toBe(88);
    expect(sc.stats.lines_removed).toBe(12);
    // (88 + 12) / 100 * 100 = 100
    expect(sc.stats.churn_pct).toBeCloseTo(100, 5);
  });

  it("a failing gate is serialized as fail", () => {
    const failing: CheckResult[] = [
      {
        check: "denied-files",
        status: "fail",
        findings: [{ severity: "high", message: "touched .env", path: ".env" }],
      },
    ];
    const sc = serialize({ ...baseInput(failing), verdict: "fail" });
    expect(sc.gates).toEqual({ "denied-files": "fail" });
    expect(sc.findings).toHaveLength(1);
    expect(sc.findings[0]?.severity).toBe("high");
  });

  it("yields churn_pct 0 for a non-positive repo size", () => {
    const sc = serialize({ ...baseInput(results), repoSize: 0 });
    expect(sc.stats.churn_pct).toBe(0);
  });
});
