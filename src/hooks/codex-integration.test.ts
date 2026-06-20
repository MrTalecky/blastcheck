/**
 * End-to-end of the Codex hook lifecycle against a real temp git repo, NO mocks
 * of the audit core (AC9, NFR19). Mirrors the Claude E2E (`integration.test.ts`)
 * but drives the Codex handlers with Codex-shaped payloads: session-start →
 * post-tool-use (record + pin, via the Codex lifecycle adapter) → a committed
 * in-scope change → stop (real runAudit). The captured trajectory must actually
 * be consumed by the audit (`evidence_level.trajectory === "present"`).
 */

import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRepo, commit, makeTempRepo } from "../../tests/fixtures/repos/make-repo.js";
import type { Scorecard } from "../scorecard/schema.js";
import { EXIT } from "../types.js";
import { runCodexPostToolUse } from "./post-tool-use.js";
import { runSessionStart } from "./session-start.js";
import { scorecardPath } from "./state.js";
import { runStop } from "./stop.js";

describe("codex hook lifecycle — end to end", () => {
  let repo: string;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (repo) await cleanupRepo(repo);
  });

  it("captures a Codex trajectory, pins the baseline, and audits on Stop", async () => {
    repo = await makeTempRepo();
    await commit(repo, { "README.md": "# repo\n" }, "init");

    // 1) Codex SessionStart (field-compatible payload) → pre-commitment reference.
    await runSessionStart({ source: "startup", cwd: repo }, repo);

    // 2) Agent declares its scope and commits it → this becomes the baseline.
    await commit(repo, { "task.md": "---\nallow:\n  - src/**\n---\n# add feature\n" }, "pin scope");

    // 3) Codex PostToolUse events: a Read and a shell command (argv-wrapped).
    await runCodexPostToolUse(
      {
        hook_event_name: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: "src/app.ts" },
        cwd: repo,
      },
      repo,
    );
    await runCodexPostToolUse(
      {
        hook_event_name: "PostToolUse",
        tool_name: "shell",
        tool_input: { command: ["bash", "-lc", "npm test"] },
        tool_response: { stdout: "ok", exit_code: 0 },
        cwd: repo,
      },
      repo,
    );

    // 4) Agent makes its in-scope change.
    await commit(repo, { "src/app.ts": "export const x = 1;\n" }, "implement");

    // 5) Codex Stop → run the audit through the SAME runStop/runAudit path.
    const code = await runStop({ stop_hook_active: false, cwd: repo }, repo);

    expect(code).not.toBe(EXIT.TOOL_ERROR);

    const written = stdout.mock.calls.map((c) => c[0]).join("");
    const scorecard = JSON.parse(written) as Scorecard;
    expect(scorecard.schema_version).toBeDefined();
    expect(["pass", "warn", "fail"]).toContain(scorecard.verdict);
    // The Codex trajectory we captured was actually consumed by the audit.
    expect(scorecard.evidence_level.trajectory).toBe("present");

    // And the scorecard is mirrored to disk.
    const mirror = JSON.parse(await readFile(scorecardPath(repo), "utf8")) as Scorecard;
    expect(mirror.verdict).toBe(scorecard.verdict);
  });
});
