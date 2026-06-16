import { describe, expect, it } from "vitest";
import type { CheckId } from "../checks/registry.js";
import { DEFAULT_THRESHOLDS } from "../contract/defaults.js";
import type { CheckResult } from "../types.js";
import { CHECK_ID_TO_SCORE_ID, DEFAULT_HARD_FLOORS, scoreIdFor, verdict } from "./verdict.js";

/** Build a CheckResult, defaulting to a clean `pass` with no findings. */
function result(partial: Partial<CheckResult> & { check: CheckId }): CheckResult {
  return { status: "pass", findings: [], ...partial };
}

const T = DEFAULT_THRESHOLDS; // scopeAdherence 0.9, toolEfficiency 0.6, churnDiscipline 0.5, progress 1.0

describe("verdict", () => {
  it("empty results → pass", () => {
    expect(verdict([], T)).toBe("pass");
  });

  it("a clean run (passing statuses, scores above thresholds) → pass", () => {
    const results = [
      result({ check: "denied-files", status: "pass" }),
      result({ check: "scope-adhesion", status: "pass", score: 0.95 }),
      result({ check: "churn", status: "pass", score: 0.9 }),
    ];
    expect(verdict(results, T)).toBe("pass");
  });

  // --- Rule 1: any fail status → fail -------------------------------------
  it("a gate fail status → fail", () => {
    const results = [
      result({
        check: "denied-files",
        status: "fail",
        findings: [{ severity: "high", message: "touched a denied file" }],
      }),
    ];
    expect(verdict(results, T)).toBe("fail");
  });

  it("fail takes priority over a warn elsewhere", () => {
    const results = [
      result({
        check: "churn",
        status: "warn",
        score: 0.4,
        findings: [{ severity: "warn", message: "churn" }],
      }),
      result({
        check: "denied-files",
        status: "fail",
        findings: [{ severity: "high", message: "x" }],
      }),
    ];
    expect(verdict(results, T)).toBe("fail");
  });

  // --- Rule 2: any high finding → fail ------------------------------------
  it("a high-severity finding on an otherwise non-fail result → fail", () => {
    const results = [
      result({
        check: "scope-adhesion",
        status: "pass",
        findings: [{ severity: "high", message: "synthetic high finding" }],
      }),
    ];
    expect(verdict(results, T)).toBe("fail");
  });

  // --- Rule 3: score below hard floor → fail ------------------------------
  it("a score below its hard floor → fail", () => {
    // scopeAdherence floor is 0.5; 0.4 < 0.5.
    const results = [result({ check: "scope-adhesion", status: "pass", score: 0.4 })];
    expect(verdict(results, T)).toBe("fail");
  });

  it("a score exactly at the hard floor does NOT fail (strict <)", () => {
    const results = [result({ check: "scope-adhesion", status: "pass", score: 0.5 })];
    // 0.5 is not < 0.5 floor, but 0.5 < 0.9 warn threshold → warn, not fail.
    expect(verdict(results, T)).toBe("warn");
  });

  it("churn has no hard floor — a low churn score warns but never crit-fails", () => {
    // churnDiscipline has no DEFAULT_HARD_FLOORS entry; 0.2 < 0.5 warn threshold.
    const results = [result({ check: "churn", status: "pass", score: 0.2 })];
    expect(verdict(results, T)).toBe("warn");
  });

  // --- Rule 4: warn status / warn finding → warn --------------------------
  it("a warn status → warn", () => {
    const results = [
      result({
        check: "churn",
        status: "warn",
        score: 0.6,
        findings: [{ severity: "warn", message: "churn over budget" }],
      }),
    ];
    expect(verdict(results, T)).toBe("warn");
  });

  it("a warn-severity finding on a pass result → warn", () => {
    const results = [
      result({
        check: "scope-adhesion",
        status: "pass",
        score: 0.95,
        findings: [{ severity: "warn", message: "synthetic warn finding" }],
      }),
    ];
    expect(verdict(results, T)).toBe("warn");
  });

  // --- Rule 5: score below warn threshold → warn --------------------------
  it("a score below its warn threshold (but above the floor) → warn", () => {
    // scopeAdherence: floor 0.5, warn 0.9; 0.7 is between → warn.
    const results = [result({ check: "scope-adhesion", status: "pass", score: 0.7 })];
    expect(verdict(results, T)).toBe("warn");
  });

  it("a score at the warn threshold does NOT warn (strict <)", () => {
    const results = [result({ check: "scope-adhesion", status: "pass", score: 0.9 })];
    expect(verdict(results, T)).toBe("pass");
  });

  // --- skipped is excluded entirely ---------------------------------------
  it("skipped results never influence the verdict", () => {
    const results = [
      result({ check: "scope-adhesion", status: "pass", score: 0.95 }),
      result({
        check: "required-checks",
        status: "skipped",
        reason: "no trajectory",
        findings: [],
      }),
      result({ check: "loop-detection", status: "skipped", reason: "no trajectory", findings: [] }),
    ];
    expect(verdict(results, T)).toBe("pass");
  });

  it("an all-skipped run → pass (nothing ran, nothing failed)", () => {
    const results = [
      result({ check: "denied-files", status: "skipped", reason: "no diff", findings: [] }),
      result({ check: "churn", status: "skipped", reason: "no repo size", findings: [] }),
    ];
    expect(verdict(results, T)).toBe("pass");
  });

  // --- threshold overrides ------------------------------------------------
  it("respects overridden warn thresholds from the contract", () => {
    // Lower the scopeAdherence warn threshold to 0.5: 0.7 now passes.
    const results = [result({ check: "scope-adhesion", status: "pass", score: 0.7 })];
    expect(verdict(results, { ...T, scopeAdherence: 0.5 })).toBe("pass");
  });

  it("gate checks carry no score id and are never floor/threshold tested", () => {
    expect(scoreIdFor("denied-files")).toBeUndefined();
    expect(scoreIdFor("required-checks")).toBeUndefined();
    expect(scoreIdFor("scope-adhesion")).toBe("scopeAdherence");
  });
});

describe("verdict constants", () => {
  it("DEFAULT_HARD_FLOORS only defines the two floored scores", () => {
    expect(DEFAULT_HARD_FLOORS).toEqual({ scopeAdherence: 0.5, toolEfficiency: 0.3 });
    expect(DEFAULT_HARD_FLOORS.churnDiscipline).toBeUndefined();
    expect(DEFAULT_HARD_FLOORS.progress).toBeUndefined();
  });

  it("CHECK_ID_TO_SCORE_ID maps every scoring check and excludes gates", () => {
    expect(CHECK_ID_TO_SCORE_ID).toEqual({
      "scope-adhesion": "scopeAdherence",
      "extraneous-tool-calls": "toolEfficiency",
      churn: "churnDiscipline",
      "loop-detection": "progress",
    });
  });
});
