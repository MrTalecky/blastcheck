import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTrajectoryEvent } from "../schema.js";
import { adaptCodexPostToolUse } from "./codex-lifecycle.js";

const HOOK_FIXTURES = join(process.cwd(), "tests/fixtures/hooks");

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(HOOK_FIXTURES, name), "utf8"));
}

describe("codex lifecycle adapter", () => {
  beforeEach(() => {
    // Skip-diagnostics go to stderr — silence them here.
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes a real shell PostToolUse fixture: exec → canonical cmd + SHELL_TOOL (AC2, FR31)", async () => {
    const events = adaptCodexPostToolUse(await fixture("codex-post-tool-use.sample.json"));
    expect(events).toEqual([
      {
        tool: "shell",
        args: { cmd: "npm test" }, // ["bash","-lc","npm test"] unwrapped to the script
        step: 1,
        exit_code: 0,
        stdout_tail: "All tests passed",
        stderr_tail: "", // empty stderr passes through as "" (same as the Claude adapter)
      },
    ]);
  });

  it("normalizes a real apply_patch PostToolUse fixture: patch body → canonical path (AC2, FR31)", async () => {
    const events = adaptCodexPostToolUse(
      await fixture("codex-post-tool-use-apply-patch.sample.json"),
    );
    expect(events).toEqual([
      {
        tool: "apply_patch",
        args: { path: "src/app.ts" }, // pulled from the *** Update File: header
        step: 1,
        stdout_tail: "Success. Updated the following files:\nM src/app.ts",
      },
    ]);
  });

  it("emits one canonical path event per file in a multi-file apply_patch envelope", () => {
    const events = adaptCodexPostToolUse({
      tool_name: "apply_patch",
      tool_input: {
        input:
          "*** Begin Patch\n" +
          "*** Update File: src/app.ts\n@@\n-const x = 0;\n+const x = 1;\n" +
          "*** Add File: src/new.ts\n+export const y = 2;\n" +
          "*** Delete File: src/old.ts\n" +
          "*** End Patch\n",
      },
    });
    expect(events.map((event) => event.args.path)).toEqual([
      "src/app.ts",
      "src/new.ts",
      "src/old.ts",
    ]);
    for (const event of events) {
      expect(event).toMatchObject({ tool: "apply_patch" });
    }
  });

  it("emits lines that round-trip through trajectoryEventSchema (loader-readable)", async () => {
    const events = [
      ...adaptCodexPostToolUse(await fixture("codex-post-tool-use.sample.json")),
      ...adaptCodexPostToolUse(await fixture("codex-post-tool-use-apply-patch.sample.json")),
    ];
    expect(events).toHaveLength(2);
    for (const event of events) {
      const { step: _step, ...line } = event; // hooks drop `step` on write
      expect(parseTrajectoryEvent(line).success).toBe(true);
    }
  });

  it("maps every Codex exec-tool alias to the shell tool with args.cmd (AC2)", () => {
    for (const tool_name of ["Bash", "shell", "exec_command", "local_shell", "container.exec"]) {
      const [event] = adaptCodexPostToolUse({
        hook_event_name: "PostToolUse",
        tool_name,
        tool_input: { command: "echo hi" },
      });
      expect(event).toMatchObject({ tool: "shell", args: { cmd: "echo hi" } });
    }
  });

  it("classifies a normalized shell command as kind:cmd so the Bash gate fires", async () => {
    const { signature } = await import("../../match/signature.js");
    const [event] = adaptCodexPostToolUse({
      tool_name: "exec_command",
      tool_input: { command: ["bash", "-lc", "rm -rf .env"] },
    });
    const parsed = parseTrajectoryEvent({ tool: event?.tool, args: event?.args });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Without exec→shell normalization this would be kind:"args" and slip the gate.
      expect(signature(parsed.data).kind).toBe("cmd");
    }
  });

  it("extracts a Read file path through the canonical args.path", () => {
    const [event] = adaptCodexPostToolUse({
      tool_name: "Read",
      tool_input: { file_path: "src/app.ts" },
    });
    expect(event).toMatchObject({ tool: "Read", args: { path: "src/app.ts" } });
  });

  it("degrades without throwing on malformed / partial / unknown payloads (FR27)", () => {
    for (const bad of [undefined, null, "not json", 42, [], {}, { tool_input: {} }]) {
      expect(() => adaptCodexPostToolUse(bad)).not.toThrow();
      expect(adaptCodexPostToolUse(bad)).toEqual([]);
    }
  });

  it("skips an apply_patch whose body carries no readable path (no fabricated signal)", () => {
    const events = adaptCodexPostToolUse({
      tool_name: "apply_patch",
      tool_input: { input: "*** Begin Patch\n(no file header)\n*** End Patch\n" },
    });
    expect(events).toEqual([]);
  });

  it("preserves an unknown tool's args as a fallback signal rather than dropping it", () => {
    const [event] = adaptCodexPostToolUse({
      tool_name: "web_search",
      tool_input: { query: "codex hooks" },
    });
    expect(event).toMatchObject({ tool: "web_search", args: { query: "codex hooks" } });
  });

  it("does NOT import the rollout adapter (codex.ts) — the two paths stay independent (AC8)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/trajectory/adapters/codex-lifecycle.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/["']\.\/codex\.js["']/);
    expect(src).not.toMatch(/adaptCodexRollout/);
  });
});
