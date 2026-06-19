import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { manifestPath, readInstallManifest, upsertInstallManifest } from "./manifest.js";
import type { InstallManifestEntry } from "./types.js";

describe("install manifest", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "blastcheck-manifest-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("treats an absent manifest as empty", async () => {
    await expect(readInstallManifest(dir)).resolves.toEqual({
      schemaVersion: "1",
      integrations: {},
    });
  });

  it("degrades malformed JSON to empty and warns to stderr", async () => {
    await mkdir(join(dir, ".blastcheck"), { recursive: true });
    await writeFile(manifestPath(dir), "{ nope", "utf8");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(readInstallManifest(dir)).resolves.toEqual({
      schemaVersion: "1",
      integrations: {},
    });

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("install manifest"));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("starting fresh"));
  });

  it("does not treat non-missing read failures as an absent manifest", async () => {
    await writeFile(join(dir, ".blastcheck"), "not a directory", "utf8");

    await expect(readInstallManifest(dir)).rejects.toThrow();
    await expect(upsertInstallManifest(dir, claudeEntry())).rejects.toThrow();
  });

  it("rejects manifest entries whose key does not match the entry agent", async () => {
    await mkdir(join(dir, ".blastcheck"), { recursive: true });
    await writeFile(
      manifestPath(dir),
      `${JSON.stringify({
        schema_version: "1",
        integrations: {
          codex: {
            agent: "claude-code",
            config_files: [],
            evidence_paths: {},
            updated_at: "2026-06-19T00:00:00.000Z",
          },
        },
      })}\n`,
      "utf8",
    );
    await expect(readInstallManifest(dir)).rejects.toThrow();
    await expect(upsertInstallManifest(dir, claudeEntry())).rejects.toThrow();
  });

  it("writes stable pretty JSON with a trailing newline", async () => {
    await upsertInstallManifest(dir, claudeEntry({ updatedAt: "2026-06-19T00:00:00.000Z" }));

    await expect(readFile(manifestPath(dir), "utf8")).resolves.toBe(
      `${JSON.stringify(
        {
          schema_version: "1",
          integrations: {
            "claude-code": {
              agent: "claude-code",
              config_files: [".claude/settings.json", ".gitignore"],
              evidence_paths: {
                baseline: ".blastcheck/baseline",
                scorecard: ".blastcheck/scorecard.json",
                trajectory: ".blastcheck/trajectory.jsonl",
              },
              trust: "trusted",
              updated_at: "2026-06-19T00:00:00.000Z",
            },
          },
        },
        null,
        2,
      )}\n`,
    );
  });

  it("preserves unrelated integration entries", async () => {
    await upsertInstallManifest(dir, {
      agent: "codex",
      configFiles: [".codex/config.toml"],
      evidencePaths: {},
      trust: "needs-review",
      updatedAt: "2026-06-18T00:00:00.000Z",
    });

    await upsertInstallManifest(dir, claudeEntry({ updatedAt: "2026-06-19T00:00:00.000Z" }));

    await expect(readInstallManifest(dir)).resolves.toMatchObject({
      integrations: {
        codex: { agent: "codex", configFiles: [".codex/config.toml"] },
        "claude-code": {
          agent: "claude-code",
          configFiles: [".claude/settings.json", ".gitignore"],
        },
      },
    });
  });

  it("upserts the same agent idempotently without duplicate entries", async () => {
    await upsertInstallManifest(dir, claudeEntry({ updatedAt: "2026-06-19T00:00:00.000Z" }));
    await upsertInstallManifest(
      dir,
      claudeEntry({
        configFiles: [".claude/settings.json"],
        updatedAt: "2026-06-19T01:00:00.000Z",
      }),
    );

    const manifest = await readInstallManifest(dir);

    expect(Object.keys(manifest.integrations)).toEqual(["claude-code"]);
    expect(manifest.integrations["claude-code"]).toMatchObject({
      configFiles: [".claude/settings.json"],
      updatedAt: "2026-06-19T01:00:00.000Z",
    });
  });
});

function claudeEntry(overrides: Partial<InstallManifestEntry> = {}): InstallManifestEntry {
  return {
    agent: "claude-code",
    configFiles: [".claude/settings.json", ".gitignore"],
    evidencePaths: {
      trajectory: ".blastcheck/trajectory.jsonl",
      baseline: ".blastcheck/baseline",
      scorecard: ".blastcheck/scorecard.json",
    },
    trust: "trusted",
    updatedAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}
