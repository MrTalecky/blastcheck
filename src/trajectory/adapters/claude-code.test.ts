import { describe, expect, it } from "vitest";
import { adaptClaudeCodePostToolUse } from "./claude-code.js";

describe("claude-code trajectory adapter", () => {
  it("maps liberal PostToolUse shapes to external trajectory events", () => {
    const events = adaptClaudeCodePostToolUse([
      {
        tool_name: "Read",
        tool_input: { file_path: "./src/app.ts" },
        timestamp: "2026-06-17T10:00:00.000Z",
      },
      {
        name: "Bash",
        input: { command: "npm test" },
        result: { exit_code: 0, stdout: "line1\nline2", stderr: "warn" },
      },
    ]);

    expect(events).toEqual([
      {
        tool: "Read",
        args: { path: "./src/app.ts" },
        step: 1,
        ts: "2026-06-17T10:00:00.000Z",
      },
      {
        tool: "Bash",
        args: { cmd: "npm test" },
        step: 2,
        exit_code: 0,
        stdout_tail: "line1\nline2",
        stderr_tail: "warn",
      },
    ]);
  });

  it("preserves unknown args so future checks do not lose the action", () => {
    const [event] = adaptClaudeCodePostToolUse({
      tool: "CustomTool",
      args: { query: "abc" },
    });

    expect(event).toEqual({
      tool: "CustomTool",
      args: { query: "abc" },
      step: 1,
    });
  });
});
