/**
 * Render a {@link Scorecard} as the markdown body of a PR comment (Story 3.2).
 *
 * This is the markdown twin of `print.ts`: a PURE function (no I/O) that derives
 * nothing the scorecard doesn't already hold — same information, different medium
 * (GitHub-flavored markdown instead of stderr lines). The CLI writes its output
 * to a file via `--comment <path>`; the composite Action upserts that file as a
 * single PR comment, keyed by {@link PR_COMMENT_MARKER}.
 *
 * Keeping the render here (testable TS) rather than in bash means vitest covers
 * it (AR10), and the Action's composite steps stay thin glue.
 */

import type { Scorecard } from "./schema.js";

/**
 * Hidden HTML-comment marker carried as the FIRST line of every rendered comment.
 * The Action finds the existing blastcheck comment by this marker and PATCHes it
 * (upsert), so repeated runs on a PR edit one comment instead of piling up new
 * ones. It is an HTML comment, so it is invisible in the rendered markdown.
 */
export const PR_COMMENT_MARKER = "<!-- blastcheck-scorecard -->";

/** Verdict → status glyph (same set as `print.ts`). */
const VERDICT_GLYPH: Record<Scorecard["verdict"], string> = {
  pass: "✓",
  warn: "‼",
  fail: "✗",
};

/** Format a number, guarding non-finite values (mirrors `print.ts` `fmt`). */
function fmt(n: number, digits: number): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

/**
 * Escape a string for safe rendering as GitHub-flavored markdown TEXT.
 *
 * Finding messages echo PR-controlled material (e.g. changed file paths), so
 * without escaping a crafted path could inject links, images, or HTML into the
 * comment GitHub renders. Backslash-escaping the CommonMark punctuation set
 * neutralizes that — the backslash itself stays invisible in the rendered output.
 */
function mdText(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, "\\$&");
}

/**
 * Wrap a string in an inline code span that cannot be broken out of. Backticks
 * are valid in file paths, so the fence is sized one longer than the longest
 * backtick run inside, and padded with a space when the content starts/ends with
 * a backtick (per the GFM code-span rules). Nothing inside a code span is
 * interpreted as markdown/HTML, so this is injection-safe for PR-controlled paths.
 */
function mdCode(s: string): string {
  const longestRun = (s.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${s}${pad}${fence}`;
}

/**
 * Render `scorecard` as a PR-comment markdown string. The first line is always
 * {@link PR_COMMENT_MARKER}; the body is a human-readable summary (verdict,
 * range, evidence, gates, scores, findings, git stats) followed by the raw
 * `scorecard.json` collapsed inside a `<details>` block.
 */
export function renderPrComment(scorecard: Scorecard): string {
  const { verdict, baseline_sha, head_sha, evidence_level } = scorecard;
  const lines: string[] = [];

  // Marker first so the Action can upsert; blank line keeps markdown rendering clean.
  lines.push(PR_COMMENT_MARKER);
  lines.push("");
  lines.push(`## blastcheck: ${VERDICT_GLYPH[verdict]} ${verdict.toUpperCase()}`);
  lines.push("");
  lines.push(`- **range:** \`${baseline_sha}\` → \`${head_sha}\``);
  lines.push(`- **evidence:** trajectory ${evidence_level.trajectory}`);
  lines.push("");

  const gateEntries = Object.entries(scorecard.gates);
  if (gateEntries.length > 0) {
    lines.push("### Gates");
    lines.push("");
    lines.push("| Gate | Status |");
    lines.push("| --- | --- |");
    for (const [id, status] of gateEntries) {
      lines.push(`| \`${id}\` | ${status === "pass" ? "✓ pass" : "✗ fail"} |`);
    }
    lines.push("");
  }

  const scoreEntries = Object.entries(scorecard.scores);
  if (scoreEntries.length > 0) {
    lines.push("### Scores");
    lines.push("");
    lines.push("| Score | Value |");
    lines.push("| --- | --- |");
    for (const [id, value] of scoreEntries) {
      lines.push(`| \`${id}\` | ${fmt(value, 2)} |`);
    }
    lines.push("");
  }

  if (scorecard.findings.length > 0) {
    lines.push(`### Findings (${scorecard.findings.length})`);
    lines.push("");
    for (const f of scorecard.findings) {
      // `message`/`path` carry PR-controlled material — escape both (see mdText/mdCode).
      const where = f.path !== undefined ? ` (${mdCode(f.path)})` : "";
      lines.push(`- \`[${f.severity}]\` ${mdCode(f.check)}: ${mdText(f.message)}${where}`);
    }
    lines.push("");
  }

  // All three signal blocks empty: a bare verdict could read as "all clear" when
  // it may mean "nothing ran" — say so explicitly (mirrors `print.ts`).
  if (gateEntries.length === 0 && scoreEntries.length === 0 && scorecard.findings.length === 0) {
    lines.push("_checks: no gates, scores, or findings recorded_");
    lines.push("");
  }

  const { files_changed, lines_added, lines_removed, churn_pct } = scorecard.stats;
  lines.push(
    `**stats:** ${files_changed} files, +${lines_added}/-${lines_removed}, churn ${fmt(churn_pct, 1)}%`,
  );
  lines.push("");

  // Raw machine output, collapsed so the summary stays readable.
  lines.push("<details><summary>Raw scorecard.json</summary>");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(scorecard, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("</details>");

  return `${lines.join("\n")}\n`;
}
