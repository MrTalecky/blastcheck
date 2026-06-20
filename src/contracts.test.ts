/**
 * Audit-core contract-preservation guards (Story 1.5).
 *
 * This suite is a regression FIREWALL, not a feature test. It pins the five
 * Epic-1 audit-core contracts so the Epic 2 (Codex), Epic 3 (OpenCode), and
 * Epic 4 (docs/migration) integration work cannot silently erode them:
 *
 *   AC1 — agent-agnostic `runAudit()` core; agent code ends at native→canonical
 *         (FR51): the core MUST NOT import `src/integrations/**` or `src/hooks/**`.
 *   AC2 — stateless CLI audit (NFR3): task+trajectory+baseline in, Scorecard out,
 *         no daemon / service / database / history store (NFR10/NFR11); runtime
 *         deps stay exactly {commander, ignore, yaml, zod} (NFR1/NFR24).
 *   AC3 — scorecard JSON is the primary machine output (NFR5): stdout = scorecard
 *         only; the human summary never reaches stdout.
 *   AC4 — exit-code triple 0/1/2 (NFR10) and the GitHub Action still gates on the
 *         shared core (FR48).
 *
 * Implemented with Node built-ins + the existing `yaml`/`zod`/`vitest` only — no
 * parser/glob/AST dependency (adding one would, correctly, trip the
 * dependency-posture guard below).
 *
 * The one genuinely new guard is AC1's architectural import boundary: no test
 * enforced FR51 before this story. The rest consolidate/lock contracts that were
 * only covered incidentally, so the intent is explicit and FR-cited.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import {
  cleanupRepo,
  commit,
  type FileSpec,
  makeTempRepo,
} from "../tests/fixtures/repos/make-repo.js";
import { main } from "./cli.js";
import { baselinePath, writeStateFile } from "./hooks/state.js";
import { runStop } from "./hooks/stop.js";
import { runAudit } from "./index.js";
import { scorecardSchema } from "./scorecard/schema.js";
import { verdict } from "./scorecard/verdict.js";
import { type CheckResult, EXIT, type ExitCode } from "./types.js";

/**
 * Repo root captured at module load — BEFORE any test `chdir`s into a temp repo.
 * Vitest runs with cwd = repo root, so `action.yml`, `package.json`, and the
 * `src/**` core files all resolve from here regardless of a test's transient cwd.
 */
const REPO_ROOT = process.cwd();
const TRAJECTORY_FIXTURES = join(REPO_ROOT, "tests/fixtures/trajectories");

/** Baseline `task.md` declaring `src/**` in scope (mirrors `src/index.test.ts`). */
const TASK_MD = '---\ngoal: implement the feature\nallow:\n  - "src/**"\n---\n# task\nbody\n';

/**
 * A baseline with enough tracked files that a one-line edit stays under the churn
 * budget (the files-proxy denominator would otherwise trip churn on a tiny repo).
 */
function baselineFiles(): FileSpec {
  const files: FileSpec = { "task.md": TASK_MD };
  for (let i = 0; i < 60; i++) files[`src/f${i}.ts`] = `export const f${i} = ${i};\n`;
  return files;
}

// ---------------------------------------------------------------------------
// Static core-source scanning helpers (Tasks 1 & 2 — text check, no AST/parser).
// ---------------------------------------------------------------------------

/** Recursively list `.ts` files under `absDir`, excluding `*.test.ts`. */
function walkTs(absDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const full = join(absDir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * The agent-agnostic audit pipeline — the set scanned for boundary violations.
 * Explicit leaf files + glob-free directory walks so the partition is obvious:
 * the adapter layer (`src/trajectory/adapters/**`) is INSIDE the core set because
 * it emits canonical events the core consumes — it is the boundary where
 * agent-specific code STOPS, not where it lives (FR51).
 */
const CORE_FILES: string[] = [
  ...[
    "src/index.ts",
    "src/runner.ts",
    "src/types.ts",
    "src/trajectory/loader.ts",
    "src/trajectory/schema.ts",
  ].map((p) => join(REPO_ROOT, p)),
  ...[
    "src/checks",
    "src/scorecard",
    "src/match",
    "src/git",
    "src/contract",
    "src/trajectory/adapters",
  ].flatMap((d) => walkTs(join(REPO_ROOT, d))),
];

/** Extract every module specifier from `import`/`export … from`/`import()` forms. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g, // import … from "x" | export … from "x"
    /\bimport\s+["']([^"']+)["']/g, // bare side-effect import "x"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("x")
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null = re.exec(source);
    while (m !== null) {
      specs.push(m[1]);
      m = re.exec(source);
    }
  }
  return specs;
}

/** True when `spec` resolves to module `mod` exactly or a subpath of it. */
function moduleMatches(spec: string, mod: string): boolean {
  return spec === mod || spec.startsWith(`${mod}/`);
}

/**
 * True when a RELATIVE import specifier reaches the agent-specific trees
 * (`src/integrations/**` or `src/hooks/**`). Matches `integrations`/`hooks` as a
 * whole PATH SEGMENT — so a barrel import like `../hooks` (no trailing slash) is
 * still caught, while unrelated names such as `react-hooks/` or `webhooks/` are
 * not false-flagged. Only relative specifiers can reach the sibling agent trees.
 */
function importsAgentModule(spec: string): boolean {
  if (!spec.startsWith(".")) return false;
  return spec.split("/").some((seg) => seg === "integrations" || seg === "hooks");
}

describe("audit-core contract preservation (Story 1.5)", () => {
  // -------------------------------------------------------------------------
  // Task 1 — AC1: architectural import boundary (core ⊥ integrations/hooks).
  // -------------------------------------------------------------------------
  describe("import boundary: agent-agnostic core (AC1, FR51)", () => {
    it("no core file imports from integrations/** or hooks/**", () => {
      // Agent-specific code lives ONLY under src/integrations/** (installers) and
      // src/hooks/** (lifecycle handlers); the agent→core boundary is the
      // trajectory adapter layer, which emits canonical events. If a core file
      // reaches back into integrations/hooks, that partition is broken.
      const violations: string[] = [];
      for (const file of CORE_FILES) {
        const src = readFileSync(file, "utf8");
        for (const spec of importSpecifiers(src)) {
          if (importsAgentModule(spec)) {
            violations.push(`${relative(REPO_ROOT, file)} → "${spec}"`);
          }
        }
      }
      expect(
        violations,
        `agent-specific imports leaked into the audit core (FR51):\n${violations.join("\n")}`,
      ).toEqual([]);
    });

    it("public API barrel exports runAudit + Scorecard and no integration/hook symbol (AR9)", () => {
      const src = readFileSync(join(REPO_ROOT, "src/index.ts"), "utf8");
      expect(src).toMatch(/export\s+async\s+function\s+runAudit\b/);
      expect(src).toMatch(/export\s+type\s*\{[^}]*\bScorecard\b/);
      // The single public programmatic API exposes the audit core, nothing else.
      expect(src).not.toMatch(/integrations\//);
      expect(src).not.toMatch(/hooks\//);
    });
  });

  // -------------------------------------------------------------------------
  // Task 2 — AC2: stateless audit + dependency / no-service posture.
  // -------------------------------------------------------------------------
  describe("stateless audit + dependency posture (AC2)", () => {
    let repo: string;
    beforeEach(async () => {
      repo = await makeTempRepo();
    });
    afterEach(async () => {
      await cleanupRepo(repo);
    });

    it("audits from task+trajectory+baseline alone → schema-valid Scorecard, no service (NFR3)", async () => {
      const baseline = await commit(repo, baselineFiles(), "baseline");
      await commit(repo, { "src/f0.ts": "export const f0 = 999;\n" }, "in-scope edit");

      // Inputs are ONLY task (baseline:task.md) + an externally supplied trajectory
      // + the baseline sha. No daemon/db/history is started or consulted.
      const sc = await runAudit({
        cwd: repo,
        baselineSha: baseline,
        trajectoryPath: `${TRAJECTORY_FIXTURES}/claude-code-valid.trajectory.jsonl`,
      });

      expect(scorecardSchema.safeParse(sc).success).toBe(true);
      expect(sc.evidence_level.trajectory).toBe("present");
    });

    it("runtime dependencies stay exactly {commander, ignore, yaml, zod} (NFR1/NFR24)", () => {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
        dependencies: Record<string, string>;
      };
      // Compare the key SET, not versions (versions are free to bump). Epic 2/3
      // adding express/sqlite/a daemon framework would trip this.
      expect(Object.keys(pkg.dependencies).sort()).toEqual(["commander", "ignore", "yaml", "zod"]);
    });

    it("audit core opens no socket / daemon / database (NFR3/NFR10/NFR11)", () => {
      // The audit path is a single pass over git + jsonl: no sockets, no DB.
      const FORBIDDEN_SERVICE_MODULES = [
        "node:http",
        "node:https",
        "node:net",
        "node:dgram",
        "node:cluster",
        "node:worker_threads",
        "sqlite",
        "node:sqlite",
        "better-sqlite3",
        "pg",
        "mysql",
        "mysql2",
        "express",
        "fastify",
      ];
      const violations: string[] = [];
      for (const file of CORE_FILES) {
        const src = readFileSync(file, "utf8");
        for (const spec of importSpecifiers(src)) {
          if (FORBIDDEN_SERVICE_MODULES.some((m) => moduleMatches(spec, m))) {
            violations.push(`${relative(REPO_ROOT, file)} → "${spec}"`);
          }
        }
      }
      expect(
        violations,
        `audit core imported a service/db/daemon module (NFR3):\n${violations.join("\n")}`,
      ).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Task 3 — AC3: stdout = scorecard JSON only; human output → stderr.
  // -------------------------------------------------------------------------
  describe("output-channel contract: stdout = scorecard only (AC3, NFR5)", () => {
    let repo: string;
    let origCwd: string;
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      repo = await makeTempRepo();
      origCwd = process.cwd();
      stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    });
    afterEach(async () => {
      process.chdir(origCwd);
      vi.restoreAllMocks();
      await cleanupRepo(repo);
    });

    it("`run`: entire stdout is one schema-valid scorecard; the summary goes to stderr", async () => {
      const baseline = await commit(repo, baselineFiles(), "baseline");
      await commit(repo, { "src/f0.ts": "export const f0 = 999;\n" }, "in-scope edit");
      process.chdir(repo); // CLI has no --cwd; runAudit uses process.cwd().

      await main(["node", "blastcheck", "run", "--baseline", baseline]);

      const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
      const err = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      // stdout is exactly one JSON.parse-able value passing the scorecard schema.
      expect(scorecardSchema.safeParse(JSON.parse(out)).success).toBe(true);
      // The human summary token (printScorecard) is on stderr, never stdout.
      expect(err).toContain("blastcheck:");
      expect(out).not.toContain("blastcheck:");
    });

    it("`hook stop`: success path writes a schema-valid scorecard to stdout, summary to stderr", async () => {
      const baseline = await commit(repo, baselineFiles(), "baseline");
      await commit(repo, { "src/f0.ts": "export const f0 = 999;\n" }, "in-scope edit");
      // The Stop hook shares the scorecard→stdout / verdict→exit contract; drive
      // the real runStop against the temp repo with a pinned baseline state file.
      await writeStateFile(baselinePath(repo), baseline);

      const code = await runStop({ cwd: repo }, repo);

      const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
      const err = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(code).toBe(EXIT.OK);
      expect(scorecardSchema.safeParse(JSON.parse(out)).success).toBe(true);
      expect(err).toContain("blastcheck:");
      expect(out).not.toContain("blastcheck:");
    });

    it("the primary machine output is the schema-validated scorecard (serialize is terminal)", async () => {
      const baseline = await commit(repo, baselineFiles(), "baseline");
      await commit(repo, { "src/f0.ts": "export const f0 = 1;\n" }, "edit");
      // runAudit's terminal step is serialize(), which parses through
      // scorecardSchema before returning — so its result IS the validated output.
      const sc = await runAudit({ cwd: repo, baselineSha: baseline });
      expect(() => scorecardSchema.parse(sc)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Task 4 — AC4: exit-code triple + GitHub Action PR-gate.
  // -------------------------------------------------------------------------
  describe("exit-code triple + Action gate (AC4)", () => {
    /** Run `main(mkArgv(baseline))` in a fresh temp repo and return the exit code. */
    async function auditExitCode(
      setup: (repo: string) => Promise<string>,
      mkArgv: (baseline: string) => string[],
    ): Promise<ExitCode> {
      const repo = await makeTempRepo();
      const origCwd = process.cwd();
      vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        const baseline = await setup(repo);
        process.chdir(repo);
        return await main(mkArgv(baseline));
      } finally {
        process.chdir(origCwd);
        vi.restoreAllMocks();
        await cleanupRepo(repo);
      }
    }

    const run = (b: string) => ["node", "blastcheck", "run", "--baseline", b];

    it("pass verdict → EXIT.OK (0)", async () => {
      const code = await auditExitCode(async (repo) => {
        const baseline = await commit(repo, baselineFiles(), "baseline");
        await commit(repo, { "src/f0.ts": "export const f0 = 2;\n" }, "in-scope");
        return baseline;
      }, run);
      expect(code).toBe(EXIT.OK);
    });

    it("fail verdict (denied file) → EXIT.FAIL (1)", async () => {
      const code = await auditExitCode(async (repo) => {
        const baseline = await commit(repo, baselineFiles(), "baseline");
        // `.env` matches the default deny glob `**/.env*`.
        await commit(repo, { ".env": "SECRET=leaked\n" }, "leak");
        return baseline;
      }, run);
      expect(code).toBe(EXIT.FAIL);
    });

    it("tool error (unreadable baseline sha) → EXIT.TOOL_ERROR (2)", async () => {
      const code = await auditExitCode(async (repo) => {
        await commit(repo, baselineFiles(), "baseline");
        return "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
      }, run);
      expect(code).toBe(EXIT.TOOL_ERROR);
    });

    it("warn never blocks: verdict() yields 'warn' and cli.ts gates only on 'fail'", () => {
      // (1) Production proof a `warn` verdict is reachable (rule #4: a `warn`
      // status → `warn`) — deterministic, no flaky churn-repo state needed.
      const warnResult: CheckResult = { check: "scope-adhesion", status: "warn", findings: [] };
      expect(verdict([warnResult], {})).toBe("warn");
      // (2) Production proof of the exit MAPPING itself: assert cli.ts's run
      // action gates on `verdict === "fail"` ALONE (fail → FAIL, everything else
      // — warn included — → OK). Pinning the real source (not re-deriving the
      // ternary in-test) is what gives this teeth: a regression that made warn
      // block (e.g. `=== "warn" ? EXIT.FAIL`) would fail this assertion.
      const cli = readFileSync(join(REPO_ROOT, "src/cli.ts"), "utf8");
      expect(cli).toMatch(/verdict\s*===\s*"fail"\s*\?\s*EXIT\.FAIL\s*:\s*EXIT\.OK/);
    });

    it("EXIT is the frozen triple { OK:0, FAIL:1, TOOL_ERROR:2 }", () => {
      // The numeric contract the Action's gate step depends on.
      expect(EXIT).toEqual({ OK: 0, FAIL: 1, TOOL_ERROR: 2 });
    });

    it("action.yml gates on the shared core: built CLI run, captured code, fail-closed propagation (FR48)", () => {
      const doc = parse(readFileSync(join(REPO_ROOT, "action.yml"), "utf8")) as {
        runs: { steps: Array<{ name?: string; run?: string }> };
      };
      const stepByName = (name: string) => doc.runs.steps.find((s) => s.name === name);

      const audit = stepByName("Run audit");
      expect(audit, "action.yml must keep a 'Run audit' step").toBeDefined();
      const auditRun = audit?.run ?? "";
      // Routes through the shared CLI over the built core (AR9), not a forked path.
      expect(auditRun).toContain("dist/cli.js");
      expect(auditRun).toMatch(/\brun\b/);
      expect(auditRun).toContain("--baseline");
      // Captures the audit's exit code into a step output.
      expect(auditRun).toContain("code=$?");
      expect(auditRun).toContain('>> "$GITHUB_OUTPUT"');

      const gate = stepByName("Gate on verdict");
      expect(gate, "action.yml must keep a 'Gate on verdict' step").toBeDefined();
      const gateRun = gate?.run ?? "";
      // Propagates the captured code — the gate IS the shared-core exit code.
      // (Asserted as two placeholder-free substrings: the GitHub `${{ … }}`
      // expression is an intentional literal, not a JS template string.)
      expect(gateRun).toMatch(/\bexit\b/);
      expect(gateRun).toContain("steps.audit.outputs.code");
      // Fail-closed: only the literal "false" opts out of gating.
      expect(gateRun).toContain("inputs.fail-on-verdict");
      expect(gateRun).toContain('"false"');
    });
  });
});
