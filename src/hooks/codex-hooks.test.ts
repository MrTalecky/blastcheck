/**
 * Codex hook-layer tests (Story 2.2): the Codex `post-tool-use` capture path and
 * the `session-start` source semantics, including Codex-specific `compact` (AC7).
 * The audit core is not mocked; these exercise the real handlers against a temp
 * repo. The full session E2E lives in `codex-integration.test.ts`.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRepo, commit, makeTempRepo } from "../../tests/fixtures/repos/make-repo.js";
import { loadTrajectory } from "../trajectory/loader.js";
import { runCodexPostToolUse } from "./post-tool-use.js";
import { runSessionStart } from "./session-start.js";
import { baselinePath, readStateFile, trajectoryPath, writeStateFile } from "./state.js";

const HOOK_FIXTURES = join(process.cwd(), "tests/fixtures/hooks");

async function fixture(name: string, cwd: string): Promise<Record<string, unknown>> {
  const payload = JSON.parse(await readFile(join(HOOK_FIXTURES, name), "utf8"));
  return { ...payload, cwd }; // retarget the fixture's cwd at the temp repo
}

describe("codex post-tool-use hook", () => {
  let repo: string;

  beforeEach(() => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (repo) await cleanupRepo(repo);
  });

  it("appends a loader-readable canonical line from a real Codex shell payload (AC2)", async () => {
    repo = await makeTempRepo();
    await commit(repo, { "task.md": "# goal\n" }, "init");

    await runCodexPostToolUse(await fixture("codex-post-tool-use.sample.json", repo), repo);

    const result = await loadTrajectory(trajectoryPath(repo));
    expect(result.diagnostics).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.tool).toBe("shell");
    expect(result.events[0]?.args.cmd).toBe("npm test");
  });

  it("captures an apply_patch edit as a canonical path line", async () => {
    repo = await makeTempRepo();
    await commit(repo, { "task.md": "# goal\n" }, "init");

    await runCodexPostToolUse(
      await fixture("codex-post-tool-use-apply-patch.sample.json", repo),
      repo,
    );

    const result = await loadTrajectory(trajectoryPath(repo));
    expect(result.diagnostics).toEqual([]);
    expect(result.events[0]?.args.path).toBe("src/app.ts");
  });

  it("does not write `step` into the trajectory line (loader derives order)", async () => {
    repo = await makeTempRepo();
    await commit(repo, { "task.md": "# goal\n" }, "init");

    await runCodexPostToolUse(await fixture("codex-post-tool-use.sample.json", repo), repo);

    const raw = (await readStateFile(trajectoryPath(repo))) ?? "";
    for (const line of raw.split("\n").filter(Boolean)) {
      expect(JSON.parse(line)).not.toHaveProperty("step");
    }
  });

  it("never throws on a malformed payload and writes no line (FR27)", async () => {
    repo = await makeTempRepo();
    await commit(repo, { "task.md": "# goal\n" }, "init");

    await expect(runCodexPostToolUse({ nonsense: true, cwd: repo }, repo)).resolves.toBeUndefined();
    expect(await readStateFile(trajectoryPath(repo))).toBeUndefined();
  });
});

describe("codex session-start source semantics (AC7)", () => {
  let repo: string;

  beforeEach(() => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (repo) await cleanupRepo(repo);
  });

  async function seedState(): Promise<void> {
    await writeStateFile(trajectoryPath(repo), '{"tool":"Read","args":{"path":"kept.ts"}}\n');
    await writeStateFile(baselinePath(repo), "cafebabe");
  }

  it.each([
    "resume",
    "compact",
  ])("treats source=%s as a continuation: trajectory + baseline preserved", async (source) => {
    repo = await makeTempRepo();
    await commit(repo, { "task.md": "# goal\n" }, "init");
    await seedState();

    await runSessionStart({ source, cwd: repo }, repo);

    expect(await readFile(trajectoryPath(repo), "utf8")).toContain("kept.ts");
    expect(await readStateFile(baselinePath(repo))).toBe("cafebabe");
  });

  it.each([
    "startup",
    "clear",
  ])("treats source=%s as fresh: trajectory reset and stale baseline cleared", async (source) => {
    repo = await makeTempRepo();
    await commit(repo, { "task.md": "# goal\n" }, "init");
    await seedState();

    await runSessionStart({ source, cwd: repo }, repo);

    expect(await readFile(trajectoryPath(repo), "utf8")).toBe("");
    expect(await readStateFile(baselinePath(repo))).toBeUndefined();
  });
});
