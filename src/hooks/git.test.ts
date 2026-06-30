import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupRepo,
  commit,
  makeNonRepoDir,
  makeTempRepo,
} from "../../tests/fixtures/repos/make-repo.js";
import { currentHead, trajectorySignature, worktreeSignature } from "./git.js";
import { trajectoryPath } from "./state.js";

describe("hook git", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeTempRepo();
  });

  afterEach(async () => {
    await cleanupRepo(repo);
  });

  describe("currentHead", () => {
    it("returns the HEAD sha in a repo", async () => {
      const sha = await commit(repo, { "a.txt": "x\n" }, "baseline");
      expect(await currentHead(repo)).toBe(sha);
    });

    it("returns undefined (no throw) when git is unavailable", async () => {
      const nonRepo = await makeNonRepoDir();
      try {
        expect(await currentHead(nonRepo)).toBeUndefined();
      } finally {
        await cleanupRepo(nonRepo);
      }
    });
  });

  describe("worktreeSignature", () => {
    it("is stable when the surface is unchanged", async () => {
      const baseline = await commit(repo, { "a.txt": "one\n" }, "baseline");
      await commit(repo, { "a.txt": "one\ntwo\n" }, "edit");

      const first = await worktreeSignature(repo, baseline);
      const second = await worktreeSignature(repo, baseline);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(second).toBe(first);
    });

    it("changes when the surface changes", async () => {
      const baseline = await commit(repo, { "a.txt": "one\n" }, "baseline");
      const before = await worktreeSignature(repo, baseline);
      await commit(repo, { "a.txt": "one\ntwo\n" }, "edit");
      const after = await worktreeSignature(repo, baseline);
      expect(after).not.toBe(before);
    });

    it("changes on an uncommitted edit while HEAD stays the same", async () => {
      // The core reason the signature hashes baseline→worktree, not HEAD: two
      // distinct uncommitted edits share a HEAD, so a HEAD-only marker would
      // falsely silence a real change.
      const baseline = await commit(repo, { "a.txt": "one\n" }, "baseline");
      const head = await currentHead(repo);
      const before = await worktreeSignature(repo, baseline);

      await writeFile(join(repo, "a.txt"), "one\ntwo\n"); // uncommitted

      expect(await currentHead(repo)).toBe(head); // HEAD did not move
      expect(await worktreeSignature(repo, baseline)).not.toBe(before);
    });

    it("returns undefined (no throw) when git is unavailable", async () => {
      const nonRepo = await makeNonRepoDir();
      try {
        expect(await worktreeSignature(nonRepo, "HEAD")).toBeUndefined();
      } finally {
        await cleanupRepo(nonRepo);
      }
    });
  });

  describe("trajectorySignature", () => {
    // Computed, not a magic literal — the "no tool-calls" snapshot component.
    const emptyHash = createHash("sha256").update("").digest("hex");

    it('maps an ABSENT trajectory to the stable hash of "" (defined, not undefined)', async () => {
      // A fresh repo has no .blastcheck/trajectory.jsonl: zero tool-calls is a
      // valid snapshot component, not a "cannot tell".
      expect(await trajectorySignature(repo)).toBe(emptyHash);
    });

    it("treats an EMPTY trajectory identically to an absent one", async () => {
      const p = trajectoryPath(repo);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, "");
      expect(await trajectorySignature(repo)).toBe(emptyHash);
    });

    it("is a stable, distinct hash when the trajectory has content", async () => {
      const p = trajectoryPath(repo);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, '{"tool":"Read"}\n');

      const first = await trajectorySignature(repo);
      const second = await trajectorySignature(repo);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(first).not.toBe(emptyHash);
      expect(second).toBe(first); // deterministic across reads
    });

    it("returns undefined (cannot tell → surface) on a non-ENOENT read failure, never throws", async () => {
      // Make the trajectory PATH a directory so readFile fails with EISDIR. An
      // unreadable (not merely absent) trajectory must NOT collapse to the empty
      // hash — that could falsely silence a real change (code review 2026-06-30).
      const p = trajectoryPath(repo);
      await mkdir(p, { recursive: true });
      expect(await trajectorySignature(repo)).toBeUndefined();
    });
  });
});
