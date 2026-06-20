/**
 * `codex-lifecycle` adapter — the FR22 Codex *lifecycle-hook* payload adapter.
 *
 * Source: a SINGLE Codex `PostToolUse` hook payload arriving on stdin (the
 * `.codex/hooks.json` command handler Story 2.1 installed), NOT a rollout log.
 * It is normalized here, on write, into one {@link ExternalTrajectoryEvent} that
 * `loadTrajectory()`/`trajectoryEventSchema` reads with zero further adaptation —
 * exactly like `claude-code.ts` does for Claude Code's `PostToolUse`.
 *
 * Codex's `PostToolUse` fields (`tool_name`, `tool_input`, `tool_response`) are
 * field-compatible with Claude Code's, so the extraction mirrors
 * {@link adaptClaudeCodePostToolUse}. Two Codex-specific touch-ups make this a
 * *parallel* adapter (design B) rather than a pure delegate, because Codex needs
 * genuinely different extraction the Claude adapter does not do:
 *
 *  1. **Exec-tool normalization (AC2/NFR13).** Codex's shell tool is named
 *     `Bash`/`shell`/`exec_command`/`local_shell`/`container.exec`. Only `bash`
 *     and `shell` are in `signature()`'s `SHELL_TOOLS`, so the others MUST be
 *     remapped to the canonical {@link SHELL_TOOL} with `args.cmd` — otherwise
 *     `signature()` classifies them `kind:"args"` and the Bash security gate
 *     (`denied-files`) and `required-checks` never scan the command (the exact
 *     deferred-work risk the rollout adapter already learned).
 *  2. **`apply_patch` path extraction.** Codex's edit tool is `apply_patch`; the
 *     edited path is either a `path`-ish field or the `*** Update File: <path>`
 *     header of a patch body — pulled into `args.path` so denied-files /
 *     scope-adhesion fire on it.
 *
 * INDEPENDENCE (AC8): this file shares ONLY the agent-agnostic `common.ts`
 * primitives. It does NOT import the rollout adapter (`codex.ts`); the argv-unwrap
 * and `apply_patch`-header helpers are re-derived locally so the lifecycle (hook)
 * and rollout (log) paths stay fully decoupled.
 *
 * Liberal-in, honest-out: a malformed/partial/unknown payload is skipped with a
 * stderr diagnostic and never throws (the adapter half of FR27); a field the
 * payload does not carry is simply not emitted, never fabricated (NFR4).
 *
 * [Source: https://developers.openai.com/codex/hooks — lifecycle hook stdin fields]
 */

import { log } from "../../log.js";
import {
  asRecord,
  cmdArgs,
  type EventTail,
  type ExternalTrajectoryEvent,
  externalEvent,
  firstNumber,
  firstString,
  pathArgs,
  SHELL_TOOL,
  tail,
} from "./common.js";

/** Codex exec-style tool names → normalized to the canonical shell tool (AC2). */
const SHELL_NAMES = new Set(["bash", "shell", "exec_command", "local_shell", "container.exec"]);

/** Codex file-edit tool names whose `tool_input` carries an `apply_patch` body. */
const PATCH_NAMES = new Set(["apply_patch", "applypatch"]);

/**
 * Is `bin` a shell binary? Compares the basename, so an absolute path
 * (`/bin/bash`, `/usr/bin/zsh`) is recognized as well as a bare `bash`/`sh`.
 */
function isShellBinary(bin: string): boolean {
  const base = bin.slice(bin.lastIndexOf("/") + 1);
  return /^(?:ba|z|k|da|a)?sh$/.test(base) || base === "fish";
}

/**
 * Extract a shell command from the tool input. Codex stores either a plain
 * string (`{command:"git status"}`) or an argv array, commonly the wrapper
 * `["bash","-lc","<script>"]` / `["sh","-c","<script>"]` — for which the
 * meaningful command is the trailing script, so recon/denied-files detection
 * sees `rm …`, not `bash -lc rm …`.
 */
function extractCommand(args: Record<string, unknown>): string | undefined {
  const direct = firstString(args, ["command", "cmd", "script"]);
  if (direct !== undefined) return direct;

  const command = args.command;
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) {
    const parts = command as string[];
    const [shell, flag] = parts;
    if (
      parts.length >= 3 &&
      shell !== undefined &&
      flag !== undefined &&
      isShellBinary(shell) &&
      /^-[a-z]*c$/.test(flag)
    ) {
      return parts[parts.length - 1];
    }
    return parts.length > 0 ? parts.join(" ") : undefined;
  }
  return undefined;
}

/**
 * Extract every edited file path: a direct `path`-ish field (one path), else
 * ALL `*** Add/Update/Delete/Move/Rename File: <path>` headers of an
 * `apply_patch` body. A single `apply_patch` envelope may touch several files,
 * and denied-files/scope-adhesion must see each one — not just the first — so a
 * multi-file patch normalizes to one canonical path event per file. Move/rename
 * headers read `old -> new`; the destination is the touched path.
 */
function extractPaths(args: Record<string, unknown>): string[] {
  const direct = firstString(args, ["path", "file_path", "filePath"]);
  if (direct !== undefined) return [direct];

  const patch = firstString(args, ["input", "patch", "diff"]);
  if (patch === undefined) return [];
  const paths: string[] = [];
  for (const match of patch.matchAll(
    /\*\*\*\s+(?:Add|Update|Delete|Move|Rename)\s+File:\s+(.+)/g,
  )) {
    const captured = match[1];
    if (captured === undefined) continue;
    const header = captured.trim();
    const arrow = header.split(/\s*->\s*/);
    const path = (arrow[arrow.length - 1] ?? header).trim();
    if (path.length > 0) paths.push(path);
  }
  return paths;
}

/** Derive `exit_code`/tails from the payload + its `tool_response` (honest degradation). */
function eventTail(record: Record<string, unknown>): EventTail {
  // Codex carries the tool result under `tool_response` (field-compatible with
  // Claude Code); tolerate the older flat/`result` shapes too. A missing field
  // simply degrades — it is never fabricated (NFR4).
  const result = asRecord(record.result);
  const response = asRecord(record.tool_response);
  return {
    ts: firstString(record, ["ts", "timestamp"]),
    exitCode:
      firstNumber(record, ["exit_code", "exitCode"]) ??
      firstNumber(result, ["exit_code", "exitCode"]) ??
      firstNumber(response, ["exit_code", "exitCode"]),
    stdoutTail: tail(
      record.stdout_tail ??
        record.stdout ??
        result.stdout_tail ??
        result.stdout ??
        result.output ??
        response.stdout_tail ??
        response.stdout ??
        response.output,
    ),
    stderrTail: tail(
      record.stderr_tail ??
        record.stderr ??
        result.stderr_tail ??
        result.stderr ??
        response.stderr_tail ??
        response.stderr,
    ),
  };
}

/** Strip the raw tool-input keys re-exposed as canonical `path`/`cmd`. */
function fallbackArgs(rawArgs: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = { ...rawArgs };
  for (const key of ["path", "file_path", "filePath", "command", "cmd", "input", "patch", "diff"]) {
    delete args[key];
  }
  return args;
}

function adaptOne(input: unknown, step: number): ExternalTrajectoryEvent[] {
  const record = asRecord(input);
  const tool = firstString(record, ["tool_name", "tool", "name"]);
  if (tool === undefined) return []; // not a usable tool event — skip (FR27)

  const rawArgs = asRecord(record.tool_input ?? record.input ?? record.args);
  const optional = eventTail(record);

  // (1) Exec-style tool → canonical shell signal so the Bash gate fires.
  if (SHELL_NAMES.has(tool.toLowerCase())) {
    const cmd = extractCommand(rawArgs);
    if (cmd !== undefined) return [externalEvent(SHELL_TOOL, cmdArgs(cmd), step, optional)];
    // A shell call we cannot read a command from: fall through to generic
    // extraction rather than emit a signal-less shell event.
  }

  // (2) apply_patch (or any tool) carrying file path(s) → one canonical path
  // event per touched file (a multi-file apply_patch envelope must surface every
  // path so denied-files/scope-adhesion see each, not just the first).
  const paths = extractPaths(rawArgs);
  if (paths.length > 0) {
    return paths.map((path) => externalEvent(tool, pathArgs(path), step, optional));
  }

  // (3) Otherwise preserve the action only if it still carries some args the
  // schema accepts as a fallback signal (NFR4) — never invent path/cmd.
  if (PATCH_NAMES.has(tool.toLowerCase())) return []; // patch with no readable path → skip
  const args = fallbackArgs(rawArgs);
  return Object.keys(args).length > 0 ? [externalEvent(tool, args, step, optional)] : [];
}

/**
 * Normalize a Codex `PostToolUse` hook payload (one event, or an array) into
 * canonical {@link ExternalTrajectoryEvent}s. Unusable entries are dropped with a
 * diagnostic; the call never throws (FR27).
 */
export function adaptCodexPostToolUse(input: unknown): ExternalTrajectoryEvent[] {
  const inputs = Array.isArray(input) ? input : [input];
  return inputs.flatMap((item, index) => {
    const events = adaptOne(item, index + 1);
    if (events.length === 0) {
      log("warn", "codex-lifecycle: PostToolUse payload had no usable tool signal — skipped");
    }
    return events;
  });
}
