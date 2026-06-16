#!/usr/bin/env node
/**
 * CLI entry — a thin wrapper over the public `runAudit` API (AR9).
 *
 * Responsibilities only: parse argv, configure logging, and map outcomes to
 * exit codes (`0/1/2`, NFR10). `stdout` is reserved for `scorecard.json`; the
 * only thing Commander prints there is `--help`/`--version` (allowed). Every
 * thrown exception maps to exit `2` (tool error, consistency rule #6).
 */

import { Command, CommanderError } from "commander";
import { runAudit } from "./index.js";
import { log, setVerbose } from "./log.js";
import { EXIT, type ExitCode } from "./types.js";

const VERSION = "0.1.0";

/** Build the Commander program (exported for testing). */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("blastcheck")
    .description("Audit AI coding-agent changes against a contract.")
    .version(VERSION, "-V, --version")
    .option("-v, --verbose", "verbose (debug) logging to stderr")
    .option("-c, --contract <path>", "path to the audit contract")
    .action((opts: { verbose?: boolean; contract?: string }) => {
      setVerbose(Boolean(opts.verbose));
      // Full audit orchestration lands in Story 1.2 (runner) / 1.4 (verdict).
      runAudit({ contractPath: opts.contract });
    });
  return program;
}

/** Parse argv and resolve to an exit code. Never throws. */
export async function main(argv: string[]): Promise<ExitCode> {
  const program = buildProgram();
  // Throw instead of calling process.exit so we own every exit code.
  program.exitOverride();
  try {
    await program.parseAsync(argv);
    return EXIT.OK;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help / --version write to stdout and are a successful exit.
      if (err.exitCode === 0) return EXIT.OK;
      // Usage errors (unknown option/command, missing arg): Commander already
      // wrote the message to stderr — don't duplicate it. Just map to exit 2.
      return EXIT.TOOL_ERROR;
    }
    // Any other exception (e.g. git failure, not-implemented) → tool error.
    log("error", err instanceof Error ? err.message : String(err));
    return EXIT.TOOL_ERROR;
  }
}

main(process.argv).then((code) => {
  process.exitCode = code;
});
