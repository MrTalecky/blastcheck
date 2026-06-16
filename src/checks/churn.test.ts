import { describe, expect, it } from "vitest";
import { runChecks } from "../runner.js";
import type { CheckContext, Contract, DiffEntry } from "../types.js";
import { check } from "./churn.js";

function contract(maxChurnPct = 10): Contract {
  return {
    baselineSha: "base",
    goal: null,
    deny: [],
    allow: [],
    requiredChecks: [],
    budget: { maxToolCalls: 50, maxFilesChanged: 10, maxChurnPct },
    thresholds: {},
  };
}

describe("churn", () => {
  it("declares the git-only shape (requires repoSize)", () => {
    expect(check.id).toBe("churn");
    expect(check.cls).toBe("git-only");
    expect(check.requires).toEqual(["diff", "contract", "repoSize"]);
  });

  it("passes with score ~1 on a tiny changeset (clean)", () => {
    const diff: DiffEntry[] = [{ path: "src/a.ts", added: 2, removed: 1 }];
    const ctx: CheckContext = { contract: contract(), diff, repoSize: 100 };

    const result = check.run(ctx);

    // churnPct = (2+1)/100*100 = 3% ≤ 10% → pass; discipline = 1 - 3/20 = 0.85.
    expect(result.status).toBe("pass");
    expect(result.score).toBeCloseTo(0.85);
  });

  it("warns when churn exceeds the budget but not 2× (violation)", () => {
    const diff: DiffEntry[] = [{ path: "src/a.ts", added: 9, removed: 3 }];
    const ctx: CheckContext = { contract: contract(10), diff, repoSize: 100 };

    const result = check.run(ctx);

    // churnPct = 12% (>10, ≤20) → warn.
    expect(result.status).toBe("warn");
    expect(result.findings.some((f) => f.severity === "warn")).toBe(true);
    expect(result.score).toBeCloseTo(1 - 12 / 20);
  });

  it("fails when churn exceeds 2× the budget", () => {
    const diff: DiffEntry[] = [{ path: "src/a.ts", added: 20, removed: 5 }];
    const ctx: CheckContext = { contract: contract(10), diff, repoSize: 100 };

    const result = check.run(ctx);

    // churnPct = 25% (>20) → fail; discipline clamps to 0.
    expect(result.status).toBe("fail");
    expect(result.findings.some((f) => f.severity === "high")).toBe(true);
    expect(result.score).toBe(0);
  });

  it("lists files written then largely reverted as thrash info findings", () => {
    const diff: DiffEntry[] = [
      { path: "src/thrash.ts", added: 10, removed: 8 }, // ratio 0.8 ≥ 0.5
      { path: "src/clean.ts", added: 10, removed: 1 }, // ratio 0.1 < 0.5
    ];
    const ctx: CheckContext = { contract: contract(), diff, repoSize: 1000 };

    const result = check.run(ctx);

    const thrash = result.findings.filter((f) => f.message.includes("thrash"));
    expect(thrash).toHaveLength(1);
    expect(thrash[0]?.path).toBe("src/thrash.ts");
    expect(thrash[0]?.severity).toBe("info");
  });

  it("counts binary files (null lines) as 0 and never thrashes them", () => {
    const diff: DiffEntry[] = [{ path: "img.png", added: null, removed: null }];
    const ctx: CheckContext = { contract: contract(), diff, repoSize: 100 };

    const result = check.run(ctx);

    expect(result.status).toBe("pass");
    expect(result.score).toBe(1); // 0 churn → discipline 1
    expect(result.findings).toEqual([]);
  });

  it("skips with a reason when repoSize is non-positive (divide-by-zero guard)", () => {
    const diff: DiffEntry[] = [{ path: "src/a.ts", added: 5, removed: 5 }];
    const ctx: CheckContext = { contract: contract(), diff, repoSize: 0 };

    const result = check.run(ctx);

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("repo size");
    expect(result.findings).toEqual([]);
    expect("score" in result).toBe(false);
  });

  it("is skipped by the runner when repoSize is absent (no data)", () => {
    const { results } = runChecks([check], {
      contract: contract(),
      diff: [{ path: "src/a.ts", added: 1, removed: 0 }],
    });

    expect(results[0]?.status).toBe("skipped");
    expect(results[0]?.reason).toContain("repoSize");
  });

  it("never yields a NaN score on a zero budget with zero churn (max_churn_pct: 0)", () => {
    const diff: DiffEntry[] = [{ path: "img.png", added: null, removed: null }];
    const ctx: CheckContext = { contract: contract(0), diff, repoSize: 100 };

    const result = check.run(ctx);

    expect(result.status).toBe("pass");
    expect(result.score).toBe(1); // zero churn → perfect discipline, not NaN
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it("fails with score 0 on a zero budget when there is any churn", () => {
    const diff: DiffEntry[] = [{ path: "src/a.ts", added: 1, removed: 0 }];
    const ctx: CheckContext = { contract: contract(0), diff, repoSize: 100 };

    const result = check.run(ctx);

    // budget2x = 0, churnPct = 1% > 0 → fail; discipline → 0 (not NaN/Infinity).
    expect(result.status).toBe("fail");
    expect(result.score).toBe(0);
  });

  it("skips on a non-finite repoSize (NaN/Infinity guard)", () => {
    const diff: DiffEntry[] = [{ path: "src/a.ts", added: 5, removed: 5 }];

    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = check.run({ contract: contract(), diff, repoSize: bad });
      expect(result.status).toBe("skipped");
      expect("score" in result).toBe(false);
    }
  });
});
