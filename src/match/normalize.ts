/**
 * Path normalization (FR12).
 *
 * Single invariant applied BEFORE any matching — to both git diff paths and
 * contract patterns (consistency: one codepath, no duplication):
 *   - POSIX separators (backslash → slash),
 *   - relative to repo root (strip leading `./` and `/`),
 *   - `.` and `..` segments resolved,
 *   - no trailing slash.
 *
 * Paths are root-relative and cannot escape the root, so a leading `..` with
 * nothing to pop is dropped.
 */
export function normalize(p: string): string {
  // backslash → slash
  const slashed = p.replace(/\\/g, "/");

  const out: string[] = [];
  for (const segment of slashed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // Resolve against the accumulated path; never escape the root.
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      continue;
    }
    out.push(segment);
  }

  return out.join("/");
}

/**
 * Normalize a CONTRACT PATTERN (not a path). Same POSIX/`.`/`..`/backslash
 * invariants as {@link normalize}, but the gitignore semantics of two prefixes
 * are PRESERVED rather than stripped:
 *   - a leading `!` (re-include / negation) is kept,
 *   - a leading `/` (root anchor) is kept — `/build` matches `build` only at the
 *     repo root, NOT at any depth. Stripping it (as `normalize()` does for paths)
 *     would silently widen a single-segment deny/allow pattern.
 *
 * Patterns whose body normalizes to empty (`/`, `.`, `!`) yield `""` and are
 * dropped by the matcher.
 */
export function normalizePattern(pattern: string): string {
  let rest = pattern;
  const negated = rest.startsWith("!");
  if (negated) rest = rest.slice(1);
  const anchored = rest.startsWith("/");
  const body = normalize(rest);
  if (body === "") return "";
  return `${negated ? "!" : ""}${anchored ? "/" : ""}${body}`;
}
