import { describe, expect, it } from "vitest";
import { runChecks } from "../runner.js";
import type { CheckContext, Contract, DiffEntry } from "../types.js";
import { check } from "./scope-adhesion.js";

function contract(over: Partial<Contract> = {}): Contract {
  return {
    baselineSha: "base",
    goal: null,
    deny: ["**/*.lock"],
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

describe("scope-adhesion", () => {
  it("declares the git-only shape", () => {
    expect(check.id).toBe("scope-adhesion");
    expect(check.cls).toBe("git-only");
    expect(check.requires).toEqual(["diff", "contract"]);
  });

  it("scores |in_scope| / denom on a large-enough changeset (violation)", () => {
    // 3 in scope (src/**), 3 out of scope → denom 6, score 0.5.
    const ctx: CheckContext = {
      contract: contract(),
      diff: diff("src/a.ts", "src/b.ts", "src/c.ts", "docs/x.md", "docs/y.md", "scripts/z.sh"),
    };

    const result = check.run(ctx);

    expect(result.status).toBe("pass");
    expect(result.score).toBeCloseTo(0.5);
    // Every out-of-scope file is listed as an info finding.
    expect(result.findings).toHaveLength(3);
    expect(result.findings.every((f) => f.severity === "info")).toBe(true);
  });

  it("scores 0 when allow is empty and the changeset is large enough", () => {
    const ctx: CheckContext = {
      contract: contract({ allow: [] }),
      diff: diff("a.ts", "b.ts", "c.ts", "d.ts", "e.ts"),
    };

    const result = check.run(ctx);

    expect(result.score).toBe(0);
    expect(result.findings).toHaveLength(5);
  });

  it("emits score 1.0 for a fully in-scope small changeset (clean green, not silence)", () => {
    const ctx: CheckContext = {
      contract: contract(),
      diff: diff("src/a.ts", "src/b.ts"),
    };

    const result = check.run(ctx);

    expect(result.status).toBe("pass");
    expect(result.score).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it("does not score a small changeset with out-of-scope files, lists them as info (noise guard)", () => {
    const ctx: CheckContext = {
      contract: contract(),
      diff: diff("src/a.ts", "docs/x.md"),
    };

    const result = check.run(ctx);

    expect(result.status).toBe("pass");
    expect("score" in result).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.path).toBe("docs/x.md");
  });

  it("omits score (null semantics) when the changeset is entirely forbidden", () => {
    const ctx: CheckContext = {
      contract: contract({ deny: ["**/*.lock"], allow: ["src/**"] }),
      diff: diff("a.lock", "b.lock"),
    };

    const result = check.run(ctx);

    expect(result.status).toBe("pass");
    expect("score" in result).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it("is skipped by the runner when diff data is absent (no data)", () => {
    const { results } = runChecks([check], { contract: contract() });

    expect(results[0]?.status).toBe("skipped");
    expect(results[0]?.reason).toContain("diff");
  });
});
