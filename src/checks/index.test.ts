import { describe, expect, it } from "vitest";
import { allChecks } from "./registry.js";
// Importing the barrel registers the built-in checks as a side effect.
import "./index.js";

describe("built-in check registration", () => {
  it("registers the three git-only checks in CHECK_IDS order", () => {
    const ids = allChecks().map((c) => c.id);
    expect(ids).toEqual(["denied-files", "scope-adhesion", "churn"]);
  });

  it("registers them all as git-only with valid requires", () => {
    for (const c of allChecks()) {
      expect(c.cls).toBe("git-only");
      expect(c.requires).toContain("diff");
      expect(typeof c.run).toBe("function");
    }
  });
});
