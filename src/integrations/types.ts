export type AgentId = "claude-code" | "codex" | "opencode" | "github";

export interface InstallOptions {
  cwd: string;
}

export interface InstallResult {
  agent: AgentId;
  configFiles?: string[];
  evidencePaths?: Record<string, string>;
  trust?: InstallTrustState;
}

export type InstallTrustState = "trusted" | "needs-review";

export interface InstallManifestEntry {
  agent: AgentId;
  displayName?: string;
  configFiles: string[];
  evidencePaths: Record<string, string>;
  trust?: InstallTrustState;
  updatedAt: string;
}

export interface InstallManifest {
  schemaVersion: "1";
  integrations: Partial<Record<AgentId, InstallManifestEntry>>;
}

export interface AgentIntegration {
  id: AgentId;
  displayName: string;
  install(options: InstallOptions): Promise<InstallResult>;
}
