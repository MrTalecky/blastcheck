/**
 * Check registry — the single source of truth for check identity (AR7,
 * consistency rule #3). The `CheckId` union here drives code, config
 * (`required_checks`, `thresholds`) and the keys of `scorecard.json`.
 *
 * IDs are stable kebab-case strings. Numeric prefixes (`check-01`) are
 * forbidden (rule #3). In this story the registry is a SCAFFOLD only — the
 * checks themselves arrive in Story 1.3 (git-only) and 2.2 (trajectory).
 */

import type { Check } from "../types.js";

/** The six stable check ids. */
export type CheckId =
  | "denied-files" // git-only (gate)
  | "scope-adhesion" // git-only
  | "extraneous-tool-calls" // trajectory
  | "churn" // git-only
  | "required-checks" // trajectory
  | "loop-detection"; // trajectory

/** Canonical ordered list of every known check id. */
export const CHECK_IDS = [
  "denied-files",
  "scope-adhesion",
  "extraneous-tool-calls",
  "churn",
  "required-checks",
  "loop-detection",
] as const satisfies readonly CheckId[];

/**
 * Typed registry of check implementations, keyed by `CheckId`. Partial while
 * checks are unimplemented; becomes total as Story 1.3/2.2 register checks via
 * {@link registerCheck}. Lookups go through {@link getCheck}/{@link allChecks}.
 */
const registry: Partial<Record<CheckId, Check>> = {};

/** Register a check implementation under its stable id. */
export function registerCheck(check: Check): void {
  registry[check.id] = check;
}

/** Look up a registered check, or `undefined` if not yet implemented. */
export function getCheck(id: CheckId): Check | undefined {
  return registry[id];
}

/** All currently registered checks, in `CHECK_IDS` order. */
export function allChecks(): Check[] {
  const checks: Check[] = [];
  for (const id of CHECK_IDS) {
    const check = registry[id];
    if (check) checks.push(check);
  }
  return checks;
}

/** Type guard: is `value` one of the known check ids? */
export function isCheckId(value: string): value is CheckId {
  return (CHECK_IDS as readonly string[]).includes(value);
}
