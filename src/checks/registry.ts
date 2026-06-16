/**
 * Check registry — the single source of truth for check identity (AR7,
 * consistency rule #3). The `CheckId` union here drives code, config
 * (`required_checks`, `thresholds`) and the keys of `scorecard.json`.
 *
 * IDs are stable kebab-case strings. Numeric prefixes (`check-01`) are
 * forbidden (rule #3). In this story the registry is a SCAFFOLD only — the
 * checks themselves arrive in Story 1.3 (git-only) and 2.2 (trajectory).
 */

import { log } from "../log.js";
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

/**
 * Register a check implementation under its stable id. Hardened against the two
 * ways this module-global singleton can be corrupted (Story 1.1 deferred debt):
 *  - a `check.id` that is not a known {@link CheckId} (runtime guard, not just
 *    the TS type) is rejected with a log and ignored;
 *  - a duplicate registration with a DIFFERENT implementation is logged (the
 *    later one wins, but it should never happen silently). Re-registering the
 *    exact SAME object reference is idempotent and quiet.
 *
 * Dedup is by reference identity, so it cannot distinguish a genuine collision
 * (two different checks claiming one id) from a module reload that re-evaluates
 * the same source into a fresh object — the latter would log a benign warn. In
 * practice the barrel (`./index.ts`) registers each check once per process, so
 * neither case arises in normal runs.
 */
export function registerCheck(check: Check): void {
  if (!isCheckId(check.id)) {
    log("error", `registerCheck: unknown check id ${JSON.stringify(check.id)} — ignored`);
    return;
  }
  const existing = registry[check.id];
  if (existing && existing !== check) {
    log("warn", `registerCheck: ${check.id} re-registered with a different implementation`);
  }
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
