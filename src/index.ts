/**
 * Public API surface (AR9).
 *
 * `runAudit(input) → Scorecard` is the SINGLE public entry point. Both the CLI
 * (`cli.ts`) and the future GitHub Action consume THIS module — `cli.ts` is a
 * thin wrapper (arg parsing, exit code, stdout). Story 1.4 lands the full
 * orchestration: contract resolve → git adapter → checks → verdict → serialize.
 *
 * In v1 this is git-only: no trajectory is loaded, so the trajectory checks are
 * `skipped` by the runner's requires-gating (NFR2) and `evidence_level.trajectory`
 * is `'absent'`. The trajectory path lands in Epic 2.
 */

// Side-effect import: registers the three git-only checks into the registry
// (the barrel is the one place that lists what ships in v1). `allChecks()` is
// empty without it.
import "./checks/index.js";

import { allChecks } from "./checks/registry.js";
import { resolveContract } from "./contract/resolve.js";
import { diffNumstat, headSha, lsFiles } from "./git/adapter.js";
import { runChecks } from "./runner.js";
import { serialize } from "./scorecard/serialize.js";
import { verdict } from "./scorecard/verdict.js";
import type { CheckContext } from "./types.js";

export { CHECK_IDS, isCheckId } from "./checks/registry.js";
// The canonical machine-readable output type lives at the JSON boundary.
export type { Scorecard } from "./scorecard/schema.js";
// Re-export the foundation type surface for API consumers.
export type {
  Budget,
  Check,
  CheckClass,
  CheckContext,
  CheckCoverage,
  CheckId,
  CheckResult,
  CheckStatus,
  Contract,
  DiffEntry,
  EvidenceLevel,
  ExitCode,
  Field,
  Finding,
  RequiredCheck,
} from "./types.js";
export { EXIT } from "./types.js";

import type { Scorecard } from "./scorecard/schema.js";

/**
 * Input to {@link runAudit}.
 *
 * `baselineSha` is REQUIRED — it pins the pre-run commit that `allow`/`goal` are
 * read from (FR3) and the far baseline of the diff. The path-ish fields are
 * accepted for forward-compatibility but only partly wired in v1:
 *  - `contractPath`/`taskPath`: the contract resolver reads `.blastcheck.yml`
 *    from `cwd` and `task.md` STRICTLY from `git show <baselineSha>:task.md`, so
 *    these are not consumed yet (changing the resolver is out of scope).
 *  - `trajectoryPath`: accepted but NOT parsed in v1 — trajectory support is
 *    Epic 2. A git-only run never loads it.
 */
export interface AuditInput {
  /** Repo working directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Pre-run commit; `allow`/`goal` are pinned to it and it is the diff baseline (FR3). */
  baselineSha: string;
  /** Reserved (Epic 2): explicit task file path. v1 reads `baseline:task.md`. */
  taskPath?: string;
  /** Reserved: explicit contract path. v1 reads `.blastcheck.yml` from `cwd`. */
  contractPath?: string;
  /** Reserved (Epic 2): trajectory file. Accepted but not parsed in v1. */
  trajectoryPath?: string;
}

/**
 * Run a full git-only audit and produce a {@link Scorecard}.
 *
 * Single pass (AR9): resolve the three-source contract, collect the git diff /
 * repo size / HEAD, run every registered check (trajectory checks `skip` via
 * requires-gating), compute the verdict, and serialize. THROWS only on an
 * unrecoverable git failure (no repo / unreadable `baselineSha` → `GitError`,
 * which `cli.ts` maps to exit `2`); missing data degrades to `skipped`, not a
 * throw.
 */
export async function runAudit(input: AuditInput): Promise<Scorecard> {
  const cwd = input.cwd ?? process.cwd();
  const { baselineSha } = input;

  // Contract first: it reads `task.md@baseline` + `.blastcheck.yml`. The three
  // git facts are independent of it, so collect them concurrently.
  const contract = await resolveContract({ baselineSha, cwd });
  const [diff, repoSize, head] = await Promise.all([
    diffNumstat(baselineSha, { cwd }),
    lsFiles({ cwd }),
    headSha({ cwd }),
  ]);

  // Git-only context: NO trajectory → trajectory checks skip (NFR2), and
  // `evidence_level.trajectory` resolves to `'absent'` in the runner.
  const ctx: CheckContext = { contract, diff, repoSize };
  const { results, evidenceLevel } = runChecks(allChecks(), ctx);

  const auditVerdict = verdict(results, contract.thresholds);

  return serialize({
    results,
    evidenceLevel,
    contract,
    baselineSha,
    headSha: head,
    verdict: auditVerdict,
    // Non-deterministic; printed but never asserted in tests.
    runId: new Date().toISOString(),
    diff,
    repoSize,
    // git-only: no trajectory, so the agent identity is unknown (Epic 2/3 fill it).
    agent: null,
  });
}
