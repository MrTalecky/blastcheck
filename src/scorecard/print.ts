/**
 * Human-readable scorecard summary → stderr ONLY (NFR9, consistency rule #6).
 *
 * `stdout` is reserved for `scorecard.json` (the machine contract); this module
 * writes NOTHING there. Every line goes to `process.stderr` so a CI step can
 * pipe `stdout` to a file while a human still sees a readable summary. The
 * verdict itself is carried by the exit code, not by stdout.
 */

import type { Scorecard } from "./schema.js";

/** Verdict → a short status glyph for the summary header. */
const VERDICT_GLYPH: Record<Scorecard["verdict"], string> = {
  pass: "✓",
  warn: "‼",
  fail: "✗",
};

/** Write one line to stderr (never stdout). */
function line(text = ""): void {
  process.stderr.write(`${text}\n`);
}

/**
 * Format a number for the summary, guarding non-finite values. The live path
 * never emits a non-finite score (`serialize` drops them, `z.number()` rejects
 * `NaN`), but `printScorecard` is a public export callable on any scorecard, so
 * `NaN.toFixed()` (literal `"NaN"`) is replaced with a readable placeholder.
 */
function fmt(n: number, digits: number): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

/**
 * Print a readable summary of `scorecard` to stderr: verdict header, the
 * baseline→head range, evidence level, gates, scores, findings and git stats.
 * Pure I/O — it derives nothing the scorecard doesn't already hold.
 */
export function printScorecard(scorecard: Scorecard): void {
  const { verdict, baseline_sha, head_sha, evidence_level } = scorecard;

  line(`blastcheck: ${VERDICT_GLYPH[verdict]} ${verdict.toUpperCase()}`);
  line(`  range: ${baseline_sha} → ${head_sha}`);
  line(`  evidence: trajectory ${evidence_level.trajectory}`);

  const gateEntries = Object.entries(scorecard.gates);
  if (gateEntries.length > 0) {
    line("  gates:");
    for (const [id, status] of gateEntries) {
      line(`    ${status === "pass" ? "✓" : "✗"} ${id}: ${status}`);
    }
  }

  const scoreEntries = Object.entries(scorecard.scores);
  if (scoreEntries.length > 0) {
    line("  scores:");
    for (const [id, value] of scoreEntries) {
      line(`    ${id}: ${fmt(value, 2)}`);
    }
  }

  if (scorecard.findings.length > 0) {
    line(`  findings (${scorecard.findings.length}):`);
    for (const f of scorecard.findings) {
      const where = f.path !== undefined ? ` (${f.path})` : "";
      line(`    [${f.severity}] ${f.check}: ${f.message}${where}`);
    }
  }

  // All three signal blocks empty: a bare verdict could read as "all clear" when
  // it may mean "nothing ran". Say so explicitly so a human isn't misled.
  if (gateEntries.length === 0 && scoreEntries.length === 0 && scorecard.findings.length === 0) {
    line("  checks: no gates, scores, or findings recorded");
  }

  const { files_changed, lines_added, lines_removed, churn_pct } = scorecard.stats;
  line(
    `  stats: ${files_changed} files, +${lines_added}/-${lines_removed}, churn ${fmt(churn_pct, 1)}%`,
  );
}
