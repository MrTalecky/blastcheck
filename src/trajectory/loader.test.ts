import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTrajectory } from "./loader.js";

const FIXTURES = join(process.cwd(), "tests/fixtures/trajectories");

describe("loadTrajectory", () => {
  it("loads valid events in step order and reports coverage", async () => {
    const result = await loadTrajectory(join(FIXTURES, "claude-code-valid.trajectory.jsonl"));

    expect(result.events.map((event) => event.step)).toEqual([1, 2]);
    expect(result.events.map((event) => event.tool)).toEqual(["Read", "Bash"]);
    expect(result.coverage).toEqual({
      totalLines: 2,
      acceptedLines: 2,
      rejectedLines: 0,
      hasStep: true,
      hasExitCode: true,
      hasTimestamps: true,
      hasStdoutTail: true,
      missingFields: [],
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("degrades bad lines into diagnostics without throwing", async () => {
    const result = await loadTrajectory(join(FIXTURES, "invalid-lines.trajectory.jsonl"));

    expect(result.events).toHaveLength(1);
    expect(result.coverage.totalLines).toBe(5);
    expect(result.coverage.acceptedLines).toBe(1);
    expect(result.coverage.rejectedLines).toBe(4);
    expect(result.diagnostics.map((diag) => diag.line)).toEqual([1, 2, 3, 4]);
  });

  it("keeps partial events usable while marking absent optional fields", async () => {
    const result = await loadTrajectory(join(FIXTURES, "partial-fields.trajectory.jsonl"));

    expect(result.events).toHaveLength(2);
    expect(result.coverage.hasStep).toBe(false);
    expect(result.coverage.hasExitCode).toBe(false);
    expect(result.coverage.hasTimestamps).toBe(false);
    expect(result.coverage.hasStdoutTail).toBe(false);
    expect(result.coverage.missingFields).toEqual(["step", "exit_code", "ts", "stdout_tail"]);
  });

  it("returns no usable events for a fully rejected file", async () => {
    const result = await loadTrajectory(join(FIXTURES, "no-usable.trajectory.jsonl"));

    expect(result.events).toEqual([]);
    expect(result.coverage.acceptedLines).toBe(0);
    expect(result.coverage.rejectedLines).toBe(3);
  });
});
