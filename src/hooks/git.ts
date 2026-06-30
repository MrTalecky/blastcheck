/**
 * Git access for the hook layer — a non-throwing wrapper over the git adapter.
 *
 * The audit path treats an unreadable HEAD as a tool error (exit 2), but a hook
 * must NEVER crash a Claude Code session. So `currentHead` swallows the adapter's
 * {@link GitError} and reports `undefined` instead, letting the caller degrade
 * (e.g. skip pre-commitment pinning when there is no git repo).
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { diffPatch, headSha } from "../git/adapter.js";
import { log } from "../log.js";
import { trajectoryPath } from "./state.js";

/** Current `HEAD` sha, or `undefined` when git is unavailable (no throw). */
export async function currentHead(cwd: string): Promise<string | undefined> {
  try {
    return await headSha({ cwd });
  } catch (err) {
    log("debug", `hook: git HEAD unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * A sha256 fingerprint of the audited surface (baseline → working tree), or
 * `undefined` when git is unavailable (no throw). Used to dedup no-op `hook stop`
 * turns: an unchanged signature means nothing changed since the last surfaced
 * verdict (Story 1.1). Hashed against the BASELINE, not HEAD — two distinct
 * uncommitted edits share a HEAD, so a HEAD-only marker would falsely silence a
 * real change. `undefined` means "cannot tell" → the caller must surface, never
 * dedup (degrade toward surfacing, never toward false silence).
 */
export async function worktreeSignature(
  cwd: string,
  baselineSha: string,
): Promise<string | undefined> {
  try {
    const patch = await diffPatch(baselineSha, { cwd });
    return createHash("sha256").update(patch).digest("hex");
  } catch (err) {
    log(
      "debug",
      `hook: worktree signature unavailable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/**
 * A sha256 fingerprint of the session's trajectory (the appended tool-call log),
 * used as the trajectory-position half of the snapshot signature (Story 1.2,
 * NFR-N1). Folding this into the dedup marker makes "the agent ran tool-calls but
 * changed no files" a DISTINCT snapshot from a truly idle turn, so it surfaces
 * instead of being mistaken for an idle repeat (FR-N4).
 *
 * Failure semantics mirror {@link worktreeSignature} (consistency rule #6, degrade
 * toward surfacing — NEVER toward false silence). Two distinct "no content" cases
 * are deliberately NOT conflated:
 *  - A **missing or empty** trajectory is a valid snapshot component (zero
 *    tool-calls is half of the `empty` definition) → the stable hash of `""`.
 *  - Any **other** read failure (permissions, EISDIR, transient I/O) is "cannot
 *    tell" → `undefined`, so the caller skips dedup and surfaces, exactly as a
 *    git-down worktree signature does. Collapsing these to the empty hash would
 *    let an unreadable real trajectory be mistaken for an idle `empty` and be
 *    silently deduped — the one outcome the design forbids (code review 2026-06-30).
 * Never throws.
 */
export async function trajectorySignature(cwd: string): Promise<string | undefined> {
  let content: string;
  try {
    content = await readFile(trajectoryPath(cwd), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      // Absent trajectory ≡ empty trajectory: a stable, defined snapshot component.
      content = "";
    } else {
      log(
        "debug",
        `hook: trajectory unreadable (cannot tell → surface): ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }
  return createHash("sha256").update(content).digest("hex");
}
