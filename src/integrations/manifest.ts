import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { STATE_DIR } from "../hooks/state.js";
import { log } from "../log.js";
import type { AgentId, InstallManifest, InstallManifestEntry } from "./types.js";

const SCHEMA_VERSION = "1";
const AGENT_IDS = [
  "claude-code",
  "codex",
  "opencode",
  "github",
] as const satisfies readonly AgentId[];

const manifestEntrySchema = z
  .object({
    agent: z.enum(AGENT_IDS),
    display_name: z.string().optional(),
    config_files: z.array(z.string()).default([]),
    evidence_paths: z.record(z.string(), z.string()).default({}),
    trust: z.enum(["trusted", "needs-review"]).optional(),
    updated_at: z.string(),
  })
  .transform(
    (entry): InstallManifestEntry => ({
      agent: entry.agent,
      displayName: entry.display_name,
      configFiles: entry.config_files,
      evidencePaths: entry.evidence_paths,
      trust: entry.trust,
      updatedAt: entry.updated_at,
    }),
  );

const manifestSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    integrations: z.partialRecord(z.enum(AGENT_IDS), manifestEntrySchema).default({}),
  })
  .superRefine((manifest, ctx) => {
    for (const [agent, entry] of Object.entries(manifest.integrations)) {
      if (entry !== undefined && entry.agent !== agent) {
        ctx.addIssue({
          code: "custom",
          message: `integration key "${agent}" does not match entry agent "${entry.agent}"`,
          path: ["integrations", agent, "agent"],
        });
      }
    }
  })
  .transform(
    (manifest): InstallManifest => ({
      schemaVersion: manifest.schema_version,
      integrations: manifest.integrations,
    }),
  );

export function manifestPath(cwd: string): string {
  return join(cwd, STATE_DIR, "install.json");
}

export async function readInstallManifest(cwd: string): Promise<InstallManifest> {
  let text: string;
  try {
    text = await readFile(manifestPath(cwd), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      throw err;
    }
    return emptyManifest();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    log("warn", "install manifest: invalid .blastcheck/install.json — starting fresh");
    return emptyManifest();
  }
  return manifestSchema.parse(parsed);
}

export async function upsertInstallManifest(
  cwd: string,
  entry: InstallManifestEntry,
): Promise<InstallManifest> {
  const manifest = await readInstallManifest(cwd);
  const next: InstallManifest = {
    schemaVersion: SCHEMA_VERSION,
    integrations: {
      ...manifest.integrations,
      [entry.agent]: entry,
    },
  };
  await mkdir(dirname(manifestPath(cwd)), { recursive: true });
  await writeFile(
    manifestPath(cwd),
    `${JSON.stringify(toExternalManifest(next), null, 2)}\n`,
    "utf8",
  );
  return next;
}

function emptyManifest(): InstallManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    integrations: {},
  };
}

function toExternalManifest(manifest: InstallManifest): unknown {
  const integrations: Record<string, unknown> = {};
  for (const agent of AGENT_IDS) {
    const entry = manifest.integrations[agent];
    if (entry === undefined) continue;
    integrations[agent] = toExternalEntry(entry);
  }
  return {
    schema_version: manifest.schemaVersion,
    integrations,
  };
}

function toExternalEntry(entry: InstallManifestEntry): unknown {
  return {
    agent: entry.agent,
    ...(entry.displayName === undefined ? {} : { display_name: entry.displayName }),
    config_files: entry.configFiles,
    evidence_paths: sortedRecord(entry.evidencePaths),
    ...(entry.trust === undefined ? {} : { trust: entry.trust }),
    updated_at: entry.updatedAt,
  };
}

function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
