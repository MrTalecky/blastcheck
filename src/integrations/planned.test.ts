import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexIntegration } from "./codex.js";
import { githubIntegration } from "./github.js";
import { manifestPath } from "./manifest.js";
import { opencodeIntegration } from "./opencode.js";

describe("planned integrations", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "blastcheck-planned-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fails codex installs explicitly until implemented", async () => {
    await expect(codexIntegration.install({ cwd: "/repo" })).rejects.toThrow(
      "codex installer is not implemented yet; planned in Story 2.1",
    );
  });

  it("fails opencode installs explicitly until implemented", async () => {
    await expect(opencodeIntegration.install({ cwd: "/repo" })).rejects.toThrow(
      "opencode installer is not implemented yet; planned in Story 3.1",
    );
  });

  it("fails github installs explicitly until implemented", async () => {
    await expect(githubIntegration.install({ cwd: "/repo" })).rejects.toThrow(
      "github installer is not implemented yet; planned after this milestone",
    );
  });

  it("does not create an install manifest for planned integrations", async () => {
    await expect(codexIntegration.install({ cwd: dir })).rejects.toThrow();
    await expect(opencodeIntegration.install({ cwd: dir })).rejects.toThrow();
    await expect(githubIntegration.install({ cwd: dir })).rejects.toThrow();

    await expect(readFile(manifestPath(dir), "utf8")).rejects.toThrow();
  });
});
