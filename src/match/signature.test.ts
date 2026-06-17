import { describe, expect, it } from "vitest";
import type { TrajectoryEvent } from "../types.js";
import { canonicalJson, signature } from "./signature.js";

function event(args: TrajectoryEvent["args"], tool = "Tool"): TrajectoryEvent {
  return { tool, args, step: 1 };
}

describe("trajectory signature", () => {
  it("uses tool and normalized path for file actions", () => {
    expect(signature(event({ path: "src/app.ts" }, "Read"))).toEqual({
      kind: "path",
      tool: "Read",
      key: "src/app.ts",
    });
  });

  it("normalizes shell command whitespace without dropping flags", () => {
    expect(signature(event({ cmd: " npm   test -- --runInBand " }, "Bash"))).toEqual({
      kind: "cmd",
      tool: "bash",
      key: "npm test -- --runInBand",
    });
  });

  it("marks recon commands separately from action commands", () => {
    expect(signature(event({ cmd: " Git   status " }, "Bash"))).toEqual({
      kind: "recon",
      tool: "bash",
      key: "Git status",
    });
  });

  it("does not mark write-capable cat commands as recon", () => {
    expect(signature(event({ cmd: "cat > generated.txt" }, "Bash"))).toEqual({
      kind: "cmd",
      tool: "bash",
      key: "cat > generated.txt",
    });
  });

  it("uses recursive canonical json for non-path non-command args", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 }, arr: [{ z: 1, y: 2 }] })).toBe(
      '{"a":{"c":3,"d":4},"arr":[{"y":2,"z":1}],"b":2}',
    );
    expect(signature(event({ b: 2, a: 1 }))).toEqual({
      kind: "args",
      tool: "Tool",
      key: '{"a":1,"b":2}',
    });
  });
});
