import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scorecard } from "./scorecard/schema.js";

// runAudit is mocked so the CLI's arg-parsing and exit-code mapping are tested
// in isolation — the end-to-end path against a real repo is `index.test.ts`.
const { runAuditMock } = vi.hoisted(() => ({ runAuditMock: vi.fn() }));
vi.mock("./index.js", () => ({ runAudit: runAuditMock }));

import { main } from "./cli.js";
import { EXIT } from "./types.js";

/** A full, minimal scorecard with the given verdict. */
function scorecard(verdict: Scorecard["verdict"]): Scorecard {
  return {
    schema_version: "1",
    run_id: "test-run",
    agent: null,
    baseline_sha: "base",
    head_sha: "head",
    task_goal: null,
    verdict,
    evidence_level: { trajectory: "absent", checks: {} },
    gates: {},
    scores: {},
    findings: [],
    stats: { files_changed: 0, lines_added: 0, lines_removed: 0, churn_pct: 0 },
  };
}

/** node-style argv: Commander's default `from:'node'` drops the first two. */
function argv(...args: string[]): string[] {
  return ["node", "blastcheck", ...args];
}

describe("cli main", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runAuditMock.mockReset();
    // Suppress (and capture) CLI output so the test log stays clean.
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--help exits 0 without running an audit", async () => {
    await expect(main(argv("--help"))).resolves.toBe(EXIT.OK);
    expect(runAuditMock).not.toHaveBeenCalled();
  });

  it("--version exits 0", async () => {
    await expect(main(argv("--version"))).resolves.toBe(EXIT.OK);
  });

  it("run without --baseline is a usage error → exit 2", async () => {
    await expect(main(argv("run"))).resolves.toBe(EXIT.TOOL_ERROR);
    expect(runAuditMock).not.toHaveBeenCalled();
  });

  it("a pass verdict → exit 0 and scorecard.json on stdout", async () => {
    runAuditMock.mockResolvedValue(scorecard("pass"));
    await expect(main(argv("run", "--baseline", "abc"))).resolves.toBe(EXIT.OK);
    const out = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain('"verdict": "pass"');
    expect(out).toContain('"schema_version": "1"');
  });

  it("a warn verdict → exit 0 (warn never blocks)", async () => {
    runAuditMock.mockResolvedValue(scorecard("warn"));
    await expect(main(argv("run", "--baseline", "abc"))).resolves.toBe(EXIT.OK);
  });

  it("a fail verdict → exit 1", async () => {
    runAuditMock.mockResolvedValue(scorecard("fail"));
    await expect(main(argv("run", "--baseline", "abc"))).resolves.toBe(EXIT.FAIL);
  });

  it("a thrown error from runAudit (e.g. no git) → exit 2", async () => {
    runAuditMock.mockRejectedValue(new Error("git rev-parse HEAD failed"));
    await expect(main(argv("run", "--baseline", "abc"))).resolves.toBe(EXIT.TOOL_ERROR);
  });

  it("forwards --baseline / --task / --trajectory to runAudit", async () => {
    runAuditMock.mockResolvedValue(scorecard("pass"));
    await main(argv("run", "--baseline", "sha1", "--task", "t.md", "--trajectory", "trace.jsonl"));
    expect(runAuditMock).toHaveBeenCalledWith({
      baselineSha: "sha1",
      taskPath: "t.md",
      trajectoryPath: "trace.jsonl",
    });
  });

  it("main never rejects, even on an unknown command", async () => {
    await expect(main(argv("bogus-command"))).resolves.toBe(EXIT.TOOL_ERROR);
  });

  it("--out writes scorecard.json to the given path", async () => {
    runAuditMock.mockResolvedValue(scorecard("pass"));
    const dir = await mkdtemp(join(tmpdir(), "blastcheck-cli-"));
    const outPath = join(dir, "scorecard.json");
    try {
      await expect(main(argv("run", "--baseline", "abc", "--out", outPath))).resolves.toBe(EXIT.OK);
      const written = await readFile(outPath, "utf8");
      expect(written).toContain('"verdict": "pass"');
      expect(written).toContain('"schema_version": "1"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a failed --out write does NOT mask the verdict exit code", async () => {
    runAuditMock.mockResolvedValue(scorecard("fail"));
    // Parent directory does not exist → writeFile rejects (ENOENT). The fail
    // verdict must still map to exit 1, not the tool-error exit 2.
    const bad = join(tmpdir(), "blastcheck-no-such-dir-xyz", "scorecard.json");
    await expect(main(argv("run", "--baseline", "abc", "--out", bad))).resolves.toBe(EXIT.FAIL);
  });
});
