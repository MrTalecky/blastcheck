/**
 * Pattern matching via the `ignore` library — gitignore spec only (NFR6).
 *
 * No hand-rolled regex matcher: the gitignore dialect of `**`/`*` comes
 * straight from `ignore`. A separate matcher instance is built per pattern set
 * (`deny`, `allow`). Both paths AND patterns go through `normalize()` first.
 */

import ignore, { type Ignore } from "ignore";
import { normalize, normalizePattern } from "./normalize.js";

/** Classification bucket for a single file (one bucket only). */
export type Bucket = "deny" | "allow" | "neither";

/** A compiled matcher for one pattern set. */
export interface Matcher {
  matches(path: string): boolean;
}

/**
 * Build a matcher from a pattern set. Patterns go through `normalizePattern`
 * (preserves gitignore `!` negation and `/` root-anchor); queried paths go
 * through `normalize` (root-relative). Both share the POSIX/`.`/`..` invariant.
 */
export function createMatcher(patterns: string[]): Matcher {
  const ig: Ignore = ignore();
  for (const pattern of patterns) {
    const normalized = normalizePattern(pattern);
    if (normalized !== "") ig.add(normalized);
  }
  return {
    matches(path: string): boolean {
      const normalized = normalize(path);
      if (normalized === "") return false;
      return ig.ignores(normalized);
    },
  };
}

/**
 * Classify a file into exactly ONE bucket by priority `deny > allow > neither`
 * (deny wins on a `deny ∩ allow` intersection). Direct contract for the
 * `denied-files` and `scope-adhesion` checks (Story 1.3).
 */
export function classify(path: string, deny: Matcher, allow: Matcher): Bucket {
  if (deny.matches(path)) return "deny";
  if (allow.matches(path)) return "allow";
  return "neither";
}
