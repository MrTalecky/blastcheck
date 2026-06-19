import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runInitMock } = vi.hoisted(() => ({
  runInitMock: vi.fn(),
}));

vi.mock("../hooks/init.js", () => ({ runInit: runInitMock }));

import { claudeCodeIntegration } from "./claude-code.js";
import { manifestPath, readInstallManifest } from "./manifest.js";

describe("claude-code integration", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "blastcheck-claude-code-"));
    runInitMock.mockReset();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("delegates installation to the existing Claude Code hook installer", async () => {
    runInitMock.mockResolvedValue({ added: 3, settingsPath: ".claude/settings.json" });

    await expect(claudeCodeIntegration.install({ cwd: dir })).resolves.toMatchObject({
      agent: "claude-code",
    });

    expect(runInitMock).toHaveBeenCalledWith({ cwd: dir });
  });

  it("writes a Claude Code manifest entry after a successful install", async () => {
    runInitMock.mockResolvedValue({
      added: 3,
      settingsPath: join(dir, ".claude", "settings.json"),
    });

    const result = await claudeCodeIntegration.install({ cwd: dir });
    const manifest = await readInstallManifest(dir);

    expect(result).toMatchObject({
      agent: "claude-code",
      configFiles: [".claude/settings.json", ".gitignore"],
      evidencePaths: {
        trajectory: ".blastcheck/trajectory.jsonl",
        baseline: ".blastcheck/baseline",
        scorecard: ".blastcheck/scorecard.json",
      },
      trust: "trusted",
    });
    expect(manifest.integrations["claude-code"]).toMatchObject({
      agent: "claude-code",
      configFiles: [".claude/settings.json", ".gitignore"],
      evidencePaths: {
        trajectory: ".blastcheck/trajectory.jsonl",
        baseline: ".blastcheck/baseline",
        scorecard: ".blastcheck/scorecard.json",
      },
      trust: "trusted",
    });
    expect(manifest.integrations["claude-code"]?.updatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(Object.keys(manifest.integrations)).toEqual(["claude-code"]);
  });

  it("upserts one Claude Code manifest entry on repeated installs", async () => {
    runInitMock.mockResolvedValue({
      added: 0,
      settingsPath: join(dir, ".claude", "settings.json"),
    });

    await claudeCodeIntegration.install({ cwd: dir });
    await claudeCodeIntegration.install({ cwd: dir });

    const manifest = await readInstallManifest(dir);
    expect(Object.keys(manifest.integrations)).toEqual(["claude-code"]);
    expect(manifest.integrations["claude-code"]?.agent).toBe("claude-code");
    expect(runInitMock).toHaveBeenCalledTimes(2);
  });

  it("does not let callers mutate canonical manifest metadata", async () => {
    runInitMock.mockResolvedValue({
      added: 0,
      settingsPath: join(dir, ".claude", "settings.json"),
    });

    const result = await claudeCodeIntegration.install({ cwd: dir });
    result.configFiles?.push("mutated.json");
    if (result.evidencePaths !== undefined) {
      result.evidencePaths.trajectory = "mutated.jsonl";
    }

    await claudeCodeIntegration.install({ cwd: dir });

    const manifest = await readInstallManifest(dir);
    expect(manifest.integrations["claude-code"]).toMatchObject({
      configFiles: [".claude/settings.json", ".gitignore"],
      evidencePaths: {
        trajectory: ".blastcheck/trajectory.jsonl",
        baseline: ".blastcheck/baseline",
        scorecard: ".blastcheck/scorecard.json",
      },
    });
  });

  it("does not create or mutate the manifest when installation fails", async () => {
    runInitMock.mockRejectedValue(new Error("install failed"));

    await expect(claudeCodeIntegration.install({ cwd: dir })).rejects.toThrow("install failed");

    await expect(readFile(manifestPath(dir), "utf8")).rejects.toThrow();
  });
});
