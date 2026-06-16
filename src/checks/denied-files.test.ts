import { describe, expect, it } from "vitest";
import { runChecks } from "../runner.js";
import type { CheckContext, Contract, DiffEntry } from "../types.js";
import { check } from "./denied-files.js";

function contract(over: Partial<Contract> = {}): Contract {
  return {
    baselineSha: "base",
    goal: null,
    deny: ["**/*.lock", ".github/**"],
    allow: ["src/**"],
    requiredChecks: [],
    budget: { maxToolCalls: 50, maxFilesChanged: 10, maxChurnPct: 10 },
    thresholds: {},
    ...over,
  };
}

function diff(...paths: string[]): DiffEntry[] {
  return paths.map((path) => ({ path, added: 1, removed: 0 }));
}

describe("denied-files", () => {
  it("declares the git-only gate shape", () => {
    expect(check.id).toBe("denied-files");
    expect(check.cls).toBe("git-only");
    expect(check.requires).toEqual(["diff", "contract"]);
  });

  it("fails with a high finding per forbidden file (violation)", () => {
    const ctx: CheckContext = {
      contract: contract(),
      diff: diff("yarn.lock", "src/app.ts", ".github/workflows/ci.yml"),
    };

    const result = check.run(ctx);

    expect(result.status).toBe("fail");
    expect(result.findings).toHaveLength(2);
    expect(result.findings.every((f) => f.severity === "high")).toBe(true);
    expect(result.findings.map((f) => f.path)).toEqual(["yarn.lock", ".github/workflows/ci.yml"]);
    // A gate never carries a score (rule #2).
    expect("score" in result).toBe(false);
  });

  it("passes with no findings and no score when nothing is denied (clean)", () => {
    const ctx: CheckContext = { contract: contract(), diff: diff("src/app.ts", "README.md") };

    const result = check.run(ctx);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect("score" in result).toBe(false);
  });

  it("treats a file in allow ∩ deny as forbidden (deny wins)", () => {
    // src/secrets.json is in allow (src/**) AND deny (**/secrets*).
    const ctx: CheckContext = {
      contract: contract({ deny: ["**/secrets*"], allow: ["src/**"] }),
      diff: diff("src/secrets.json"),
    };

    const result = check.run(ctx);

    expect(result.status).toBe("fail");
    expect(result.findings[0]?.path).toBe("src/secrets.json");
  });

  it("is skipped by the runner when diff data is absent (no data)", () => {
    const { results, evidenceLevel } = runChecks([check], { contract: contract() });

    expect(results[0]?.status).toBe("skipped");
    expect(results[0]?.reason).toContain("diff");
    expect(evidenceLevel.checks["denied-files"]).toBe("skipped");
  });
});
