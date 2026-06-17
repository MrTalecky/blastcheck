import { describe, expect, it } from "vitest";
import { parseTrajectoryEvent } from "./schema.js";

describe("trajectory schema", () => {
  it("transforms external snake_case fields to the internal camelCase event", () => {
    const result = parseTrajectoryEvent({
      tool: "Edit",
      args: { path: "./src/../src/app.ts", extra_value: 1 },
      step: 2,
      ts: "2026-06-17T10:00:00.000Z",
      exit_code: 0,
      stdout_tail: "ok",
      stderr_tail: "",
      session_id: "s1",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      tool: "Edit",
      args: { path: "src/app.ts", extra_value: 1 },
      step: 2,
      ts: "2026-06-17T10:00:00.000Z",
      exitCode: 0,
      stdoutTail: "ok",
      stderrTail: "",
      raw: expect.objectContaining({ session_id: "s1" }),
    });
  });

  it("requires tool and either an action signal or fallback args", () => {
    expect(parseTrajectoryEvent({ args: { path: "src/app.ts" } }).success).toBe(false);
    expect(parseTrajectoryEvent({ tool: "Read", args: {} }).success).toBe(false);
    expect(parseTrajectoryEvent({ tool: "Bash", args: { cmd: "npm test" } }).success).toBe(true);
    expect(parseTrajectoryEvent({ tool: "CustomTool", args: { query: "abc" } }).success).toBe(true);
  });

  it("rejects blank path and command signals", () => {
    expect(parseTrajectoryEvent({ tool: "Read", args: { path: "" } }).success).toBe(false);
    expect(parseTrajectoryEvent({ tool: "Read", args: { path: "   " } }).success).toBe(false);
    expect(parseTrajectoryEvent({ tool: "Bash", args: { cmd: "\t  " } }).success).toBe(false);
  });

  it("rejects fields with the wrong type instead of coercing them", () => {
    expect(parseTrajectoryEvent({ tool: "Read", args: { path: 123 } }).success).toBe(false);
    expect(
      parseTrajectoryEvent({ tool: "Bash", args: { cmd: "pwd" }, exit_code: "0" }).success,
    ).toBe(false);
  });
});
