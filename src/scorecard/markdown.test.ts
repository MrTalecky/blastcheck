import { describe, expect, it } from "vitest";
import { PR_COMMENT_MARKER, renderPrComment } from "./markdown.js";
import type { Scorecard } from "./schema.js";

/** A full scorecard with the given verdict; overrides merge on top. */
function scorecard(verdict: Scorecard["verdict"], overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    schema_version: "1",
    run_id: "2026-06-18T00:00:00.000Z",
    agent: null,
    baseline_sha: "base000",
    head_sha: "head111",
    task_goal: "do it",
    verdict,
    evidence_level: { trajectory: "absent", checks: { "denied-files": "full" } },
    gates: { "denied-files": "pass" },
    scores: { scope_adherence: 0.83, churn_discipline: 0.91 },
    findings: [
      { check: "scope-adhesion", severity: "info", message: "out of scope", path: "x.ts" },
    ],
    stats: { files_changed: 2, lines_added: 88, lines_removed: 12, churn_pct: 2.1 },
    ...overrides,
  };
}

describe("renderPrComment", () => {
  it("leads with the hidden upsert marker on the first line", () => {
    const md = renderPrComment(scorecard("pass"));
    expect(md.startsWith(PR_COMMENT_MARKER)).toBe(true);
    // The marker is an HTML comment so it stays invisible in the rendered comment.
    expect(PR_COMMENT_MARKER).toBe("<!-- blastcheck-scorecard -->");
  });

  it("renders each verdict with its glyph and an uppercase label", () => {
    expect(renderPrComment(scorecard("pass"))).toContain("✓ PASS");
    expect(renderPrComment(scorecard("warn"))).toContain("‼ WARN");
    expect(renderPrComment(scorecard("fail"))).toContain("✗ FAIL");
  });

  it("renders the baseline→head range, evidence, gates, scores, findings and stats", () => {
    const md = renderPrComment(scorecard("warn"));
    expect(md).toContain("base000");
    expect(md).toContain("head111");
    expect(md).toContain("→");
    expect(md).toContain("trajectory absent");
    expect(md).toContain("denied-files");
    expect(md).toContain("pass");
    expect(md).toContain("scope_adherence");
    expect(md).toContain("0.83");
    expect(md).toContain("scope-adhesion");
    expect(md).toContain("out of scope");
    expect(md).toContain("x.ts");
    expect(md).toContain("2 files");
    expect(md).toContain("+88");
    expect(md).toContain("-12");
    expect(md).toContain("2.1");
  });

  it("embeds the raw scorecard.json inside a collapsed <details> block", () => {
    const md = renderPrComment(scorecard("pass"));
    expect(md).toContain("<details>");
    expect(md).toContain("</details>");
    expect(md).toContain("```json");
    // The raw JSON must be the validated snake_case scorecard, verbatim.
    expect(md).toContain('"schema_version": "1"');
    expect(md).toContain('"verdict": "pass"');
  });

  it("handles a scorecard with no findings", () => {
    const md = renderPrComment(scorecard("pass", { findings: [] }));
    expect(md).toContain("✓ PASS");
    // No findings section noise, but the rest still renders.
    expect(md).toContain("base000");
    expect(md).toContain("head111");
  });

  it("states explicitly when no gates, scores, or findings were recorded", () => {
    const md = renderPrComment(scorecard("pass", { gates: {}, scores: {}, findings: [] }));
    expect(md.toLowerCase()).toContain("no gates, scores, or findings");
  });

  it("neutralizes markdown/HTML injection from PR-controlled finding message/path", () => {
    const md = renderPrComment(
      scorecard("fail", {
        findings: [
          {
            check: "denied-files",
            severity: "high",
            // A crafted file path echoed into the message: an image/link + a
            // backtick run that would otherwise break out of the inline code span.
            message: "touched ![x](http://evil/p.png) and <img src=x>",
            path: "we``ird/`name`.ts",
          },
        ],
      }),
    );
    // Only the human-readable summary needs escaping; the raw JSON lives inside a
    // fenced code block (inert), so assert against the part BEFORE <details>.
    const summary = md.slice(0, md.indexOf("<details>"));
    // The injection markup must NOT render verbatim (it is backslash-escaped).
    expect(summary).not.toContain("![x](http://evil/p.png)");
    expect(summary).not.toContain("<img src=x>");
    // The path's backtick run cannot break out: the code fence is longer than it.
    expect(summary).toContain("```we``ird/`name`.ts```");
  });

  it("does NOT route the headline through the shared verdict-text renderer (AC2 lock)", () => {
    // The CI PR comment must stay byte-stable independent of the `verdict-text`
    // rewrite (FR4). markdown.ts has its own renderer and does NOT import
    // verdict-text, so a representative fail — gate fail + sub-floor score +
    // mixed findings — renders with markdown.ts's own `## blastcheck: ✗ FAIL`
    // header and NONE of verdict-text's dense-line artifacts (the ` · ` segment
    // joiner, the `— <reason>` headline, or `below floor`). If a future
    // shared-helper refactor silently routed this through verdict-text, this fires.
    const md = renderPrComment(
      scorecard("fail", {
        gates: { "denied-files": "fail" },
        scores: { scope_adherence: 0.2 },
        findings: [
          { check: "denied-files", severity: "high", message: "touched .env", path: ".env" },
          { check: "churn", severity: "warn", message: "high churn" },
        ],
      }),
    );
    // markdown.ts's own header form — not the verdict-text dense headline.
    expect(md).toContain("## blastcheck: ✗ FAIL");
    expect(md).not.toContain("✗ FAIL —");
    expect(md).not.toContain(" · ");
    expect(md).not.toContain("below floor");
    expect(md).not.toContain("denied-files failed");
    // Two renders of the same scorecard are byte-identical (pure, deterministic).
    expect(renderPrComment(scorecard("fail"))).toBe(renderPrComment(scorecard("fail")));
  });

  it("does not leak camelCase scorecard keys into the markdown", () => {
    const md = renderPrComment(scorecard("warn"));
    for (const leak of ["schemaVersion", "baselineSha", "headSha", "taskGoal", "evidenceLevel"]) {
      expect(md).not.toContain(leak);
    }
  });
});
