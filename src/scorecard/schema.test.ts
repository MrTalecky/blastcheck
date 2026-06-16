import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Scorecard, scorecardSchema } from "./schema.js";

/** A minimal but valid git-only scorecard. */
const valid: Scorecard = {
  schema_version: "1",
  run_id: "2026-06-17T00:00:00.000Z",
  agent: null,
  baseline_sha: "abc123",
  head_sha: "def456",
  task_goal: "do the thing",
  verdict: "pass",
  evidence_level: {
    trajectory: "absent",
    checks: { "denied-files": "full", "scope-adhesion": "full", "required-checks": "skipped" },
  },
  gates: { "denied-files": "pass" },
  scores: { scope_adherence: 0.83, churn_discipline: 0.91 },
  findings: [{ check: "scope-adhesion", severity: "info", message: "out of scope", path: "x.ts" }],
  stats: { files_changed: 4, lines_added: 88, lines_removed: 12, churn_pct: 2.1 },
};

describe("scorecardSchema", () => {
  it("accepts a well-formed scorecard", () => {
    expect(scorecardSchema.safeParse(valid).success).toBe(true);
  });

  it("exposes a fixed schema version", () => {
    expect(SCHEMA_VERSION).toBe("1");
  });

  it("rejects a missing schema_version", () => {
    const { schema_version: _omit, ...rest } = valid;
    expect(scorecardSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a wrong schema_version", () => {
    expect(scorecardSchema.safeParse({ ...valid, schema_version: "2" }).success).toBe(false);
  });

  it("rejects an invalid verdict", () => {
    expect(scorecardSchema.safeParse({ ...valid, verdict: "maybe" }).success).toBe(false);
  });

  it("rejects a stray camelCase key (snake_case boundary is enforced)", () => {
    expect(scorecardSchema.safeParse({ ...valid, taskGoal: "leak" }).success).toBe(false);
  });

  it("allows agent and task_goal to be null", () => {
    expect(scorecardSchema.safeParse({ ...valid, agent: null, task_goal: null }).success).toBe(
      true,
    );
  });

  it("rejects a non-pass/fail gate value", () => {
    const bad = { ...valid, gates: { "denied-files": "warn" } };
    expect(scorecardSchema.safeParse(bad).success).toBe(false);
  });
});
