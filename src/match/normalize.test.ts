import { describe, expect, it } from "vitest";
import { normalize } from "./normalize.js";

describe("normalize", () => {
  const cases: Array<[input: string, expected: string]> = [
    // leading ./ and /
    ["./src", "src"],
    ["/src", "src"],
    [".//src", "src"],
    // backslashes → slashes (the AC's `src\x`)
    ["src\\x", "src/x"],
    ["a\\b\\c", "a/b/c"],
    // dot / dotdot resolution (the AC's `a/b/../c`)
    ["a/b/../c", "a/c"],
    ["a/./b", "a/b"],
    ["a/b/c/../../d", "a/d"],
    // leading .. cannot escape root → dropped
    ["../x", "x"],
    ["../../a/b", "a/b"],
    // trailing slash removed
    ["src/", "src"],
    ["src/lib/", "src/lib"],
    // idempotent on already-normal paths
    ["src/lib/foo.ts", "src/lib/foo.ts"],
    // empty-ish inputs
    ["", ""],
    [".", ""],
    ["/", ""],
    ["./", ""],
    // gitignore glob tokens are preserved (normalize runs on patterns too)
    ["**/foo", "**/foo"],
    ["*.md", "*.md"],
    ["/src/**", "src/**"],
  ];

  it.each(cases)("normalize(%j) === %j", (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  it("produces a POSIX path with no backslashes, leading ./ or /", () => {
    const result = normalize("\\a\\./b/../c\\");
    expect(result).not.toContain("\\");
    expect(result.startsWith("/")).toBe(false);
    expect(result.startsWith("./")).toBe(false);
    expect(result).toBe("a/c");
  });
});
