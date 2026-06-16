/**
 * Logging — writes EXCLUSIVELY to stderr (NFR9, consistency rule #6).
 *
 * `stdout` is reserved for `scorecard.json`. Every diagnostic, progress and
 * error line goes to stderr so machine-readable output stays clean.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * Whether debug output is enabled. Gated by `--verbose` (wired in `cli.ts` via
 * {@link setVerbose}) or the `BLASTCHECK_DEBUG` environment variable.
 */
const envDebug = process.env.BLASTCHECK_DEBUG != null && process.env.BLASTCHECK_DEBUG !== "";
let debugEnabled = envDebug;

/**
 * Enable/disable debug-level logging (called from the CLI on `--verbose`).
 * Debug is on when `--verbose` is passed OR `BLASTCHECK_DEBUG` is set; the env
 * default is re-evaluated each call so `setVerbose(false)` is not sticky.
 */
export function setVerbose(verbose: boolean): void {
  debugEnabled = verbose || envDebug;
}

/** Write a single log line to stderr. `debug` lines are gated. */
export function log(level: LogLevel, msg: string): void {
  if (level === "debug" && !debugEnabled) return;
  process.stderr.write(`[blastcheck] ${level}: ${msg}\n`);
}
