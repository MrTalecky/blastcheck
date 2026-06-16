import { describe, expect, it } from "vitest";
import { classify, createMatcher } from "./matcher.js";

describe("createMatcher", () => {
  it("matches gitignore `**` across directory levels", () => {
    const m = createMatcher(["**/*.env"]);
    expect(m.matches(".env")).toBe(true);
    expect(m.matches("config/.env")).toBe(true);
    expect(m.matches("a/b/secret.env")).toBe(true);
    expect(m.matches("notes.txt")).toBe(false);
  });

  it("matches gitignore single `*` within a segment", () => {
    const m = createMatcher(["src/*.ts"]);
    expect(m.matches("src/foo.ts")).toBe(true);
    expect(m.matches("src/bar/baz.ts")).toBe(false); // * does not cross `/`
  });

  it("matches a directory pattern", () => {
    const m = createMatcher(["dist/"]);
    expect(m.matches("dist/cli.js")).toBe(true);
    expect(m.matches("src/cli.js")).toBe(false);
  });

  it("an empty pattern set matches nothing", () => {
    const m = createMatcher([]);
    expect(m.matches("anything.ts")).toBe(false);
  });

  it("normalizes the queried path before matching", () => {
    const m = createMatcher(["src/secret.ts"]);
    expect(m.matches("./src/secret.ts")).toBe(true);
    expect(m.matches("/src/secret.ts")).toBe(true);
    expect(m.matches("src\\secret.ts")).toBe(true);
  });

  it("preserves gitignore root-anchoring of a leading `/` pattern", () => {
    const anchored = createMatcher(["/build"]);
    expect(anchored.matches("build")).toBe(true);
    expect(anchored.matches("src/build")).toBe(false); // anchored to repo root

    const unanchored = createMatcher(["build"]);
    expect(unanchored.matches("build")).toBe(true);
    expect(unanchored.matches("src/build")).toBe(true); // matches at any depth
  });

  it("honors a `!` negation re-include within a pattern set", () => {
    const m = createMatcher(["secrets/**", "!secrets/README.md"]);
    expect(m.matches("secrets/key.pem")).toBe(true);
    expect(m.matches("secrets/README.md")).toBe(false); // re-included by `!`
  });
});

describe("classify (deny > allow > neither)", () => {
  const deny = createMatcher(["**/*.env", "secrets/**"]);
  const allow = createMatcher(["src/**"]);

  it("returns deny when only deny matches", () => {
    expect(classify("config/.env", deny, allow)).toBe("deny");
    expect(classify("secrets/key.pem", deny, allow)).toBe("deny");
  });

  it("returns allow when only allow matches", () => {
    expect(classify("src/index.ts", deny, allow)).toBe("allow");
  });

  it("returns neither when nothing matches", () => {
    expect(classify("README.md", deny, allow)).toBe("neither");
  });

  it("deny wins on deny ∩ allow intersection", () => {
    // src/.env is in both allow (src/**) and deny (**/*.env) → deny.
    expect(classify("src/.env", deny, allow)).toBe("deny");
  });
});
