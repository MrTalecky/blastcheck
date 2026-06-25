import { describe, expect, it } from "vitest";
import type { Scorecard } from "../scorecard/schema.js";
import { verdictDetail, verdictHeadline } from "./verdict-text.js";

function scorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    schema_version: "1",
    run_id: "test-run",
    agent: null,
    baseline_sha: "base",
    head_sha: "head",
    task_goal: null,
    verdict: "pass",
    evidence_level: { trajectory: "absent", checks: {} },
    gates: {},
    scores: {},
    findings: [],
    stats: { files_changed: 0, lines_added: 0, lines_removed: 0, churn_pct: 0 },
    ...overrides,
  };
}

describe("verdictHeadline", () => {
  it("pass reads as a calm all-clear line", () => {
    expect(verdictHeadline(scorecard({ verdict: "pass" }))).toBe("blastcheck: ✓ pass — all clear");
  });

  it("warn leads with the severity-mix, then git scale", () => {
    const sc = scorecard({
      verdict: "warn",
      findings: [{ severity: "warn", check: "churn", message: "high churn" }],
    });
    expect(verdictHeadline(sc)).toBe("blastcheck: ‼ warn — 1 warn · 0 files, churn 0.0%");
  });

  it("fail leads with the failed gate · severity-mix · scale, and upper-cases FAIL", () => {
    const sc = scorecard({
      verdict: "fail",
      gates: { "denied-files": "fail", churn: "pass" },
      findings: [
        { severity: "high", check: "denied-files", message: "touched .env", path: ".env" },
        { severity: "warn", check: "churn", message: "churn" },
      ],
    });
    expect(verdictHeadline(sc)).toBe(
      "blastcheck: ✗ FAIL — denied-files failed · 1 high, 1 warn · 0 files, churn 0.0%",
    );
  });

  it("names a sub-floor score as a failing dimension (not a gate)", () => {
    // scope_adherence (0.2) is below its 0.5 hard floor → a score-driven fail with
    // no failed gate; the dimension is named from the snake_case score id.
    const sc = scorecard({
      verdict: "fail",
      scores: { scope_adherence: 0.2 },
      findings: [{ severity: "high", check: "scope-adhesion", message: "out of scope" }],
    });
    expect(verdictHeadline(sc)).toBe(
      "blastcheck: ✗ FAIL — scope_adherence below floor · 1 high · 0 files, churn 0.0%",
    );
  });

  it("renders the severity-mix loudest-first (high → warn → info), omitting zero buckets", () => {
    const sc = scorecard({
      verdict: "fail",
      findings: [
        { severity: "info", check: "churn", message: "i" },
        { severity: "high", check: "denied-files", message: "h" },
        { severity: "warn", check: "churn", message: "w1" },
        { severity: "warn", check: "churn", message: "w2" },
      ],
    });
    // Insertion order is info→high→warn→warn, but the render is high→warn→info.
    expect(verdictHeadline(sc)).toBe(
      "blastcheck: ✗ FAIL — 1 high, 2 warn, 1 info · 0 files, churn 0.0%",
    );
  });

  it("non-pass with no gates or findings still carries the scale segment", () => {
    // The always-present scale segment means `reason()` is never empty for a
    // non-pass verdict, so the `see scorecard` fallback no longer fires here.
    expect(verdictHeadline(scorecard({ verdict: "warn" }))).toBe(
      "blastcheck: ‼ warn — 0 files, churn 0.0%",
    );
  });
});

describe("verdictDetail", () => {
  it("restates the verdict, failing gates, findings, and where to look", () => {
    const sc = scorecard({
      verdict: "fail",
      gates: { "denied-files": "fail" },
      findings: [
        { severity: "high", check: "denied-files", message: "touched .env", path: ".env" },
      ],
    });
    const detail = verdictDetail(sc);
    expect(detail).toContain("blastcheck: ✗ FAIL");
    expect(detail).toContain("gate failed: denied-files");
    expect(detail).toContain("[high] denied-files: touched .env (.env)");
    expect(detail).toContain(".blastcheck/scorecard.json");
  });
});
