import { runInit } from "../hooks/init.js";
import { STATE_DIR } from "../hooks/state.js";
import { upsertInstallManifest } from "./manifest.js";
import type { AgentIntegration } from "./types.js";

const CLAUDE_CODE_CONFIG_FILES = [".claude/settings.json", ".gitignore"] as const;
const CLAUDE_CODE_EVIDENCE_PATHS = {
  trajectory: `${STATE_DIR}/trajectory.jsonl`,
  baseline: `${STATE_DIR}/baseline`,
  scorecard: `${STATE_DIR}/scorecard.json`,
} as const;

export const claudeCodeIntegration: AgentIntegration = {
  id: "claude-code",
  displayName: "Claude Code",
  async install(options) {
    await runInit({ cwd: options.cwd });
    const entry = {
      agent: "claude-code" as const,
      displayName: "Claude Code",
      configFiles: [...CLAUDE_CODE_CONFIG_FILES],
      evidencePaths: { ...CLAUDE_CODE_EVIDENCE_PATHS },
      trust: "trusted" as const,
      updatedAt: new Date().toISOString(),
    };
    await upsertInstallManifest(options.cwd, entry);
    return {
      agent: entry.agent,
      configFiles: [...entry.configFiles],
      evidencePaths: { ...entry.evidencePaths },
      trust: entry.trust,
    };
  },
};
