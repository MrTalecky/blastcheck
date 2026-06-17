import { readFile } from "node:fs/promises";
import type {
  TrajectoryCoverage,
  TrajectoryDiagnostic,
  TrajectoryEvent,
  TrajectoryLoadResult,
} from "../types.js";
import { parseTrajectoryEvent } from "./schema.js";

const COVERAGE_FIELDS = ["step", "exit_code", "ts", "stdout_tail"] as const;

function reasonFromParseError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: Array<{ message: string }> }).issues;
    const first = issues?.[0];
    if (first !== undefined) return first.message;
  }
  return "invalid trajectory event";
}

function coverage(
  totalLines: number,
  events: TrajectoryEvent[],
  rejectedLines: number,
): TrajectoryCoverage {
  const hasStep = events.some((event) => hasSourceStep(event.raw));
  const hasExitCode = events.some((event) => event.exitCode !== undefined);
  const hasTimestamps = events.some((event) => event.ts !== undefined);
  const hasStdoutTail = events.some((event) => event.stdoutTail !== undefined);
  const missingFields = [
    ...(hasStep ? [] : [COVERAGE_FIELDS[0]]),
    ...(hasExitCode ? [] : [COVERAGE_FIELDS[1]]),
    ...(hasTimestamps ? [] : [COVERAGE_FIELDS[2]]),
    ...(hasStdoutTail ? [] : [COVERAGE_FIELDS[3]]),
  ];

  return {
    totalLines,
    acceptedLines: events.length,
    rejectedLines,
    hasStep,
    hasExitCode,
    hasTimestamps,
    hasStdoutTail,
    missingFields,
  };
}

function hasSourceStep(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { step?: unknown }).step === "number" &&
    Number.isInteger((value as { step: number }).step) &&
    (value as { step: number }).step > 0
  );
}

export async function loadTrajectory(path: string): Promise<TrajectoryLoadResult> {
  const text = await readFile(path, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();

  const events: TrajectoryEvent[] = [];
  const diagnostics: TrajectoryDiagnostic[] = [];

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    if (line.trim() === "") {
      diagnostics.push({ line: lineNumber, reason: "empty line" });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      diagnostics.push({ line: lineNumber, reason: "invalid JSON" });
      continue;
    }

    const result = parseTrajectoryEvent(parsed);
    if (!result.success) {
      diagnostics.push({ line: lineNumber, reason: reasonFromParseError(result.error) });
      continue;
    }

    events.push({
      ...result.data,
      step: result.data.step > 0 ? result.data.step : lineNumber,
    });
  }

  events.sort((left, right) => left.step - right.step);

  return {
    events,
    diagnostics,
    coverage: coverage(lines.length, events, diagnostics.length),
  };
}

export async function loadUsableTrajectory(
  path?: string,
): Promise<TrajectoryLoadResult | undefined> {
  if (path === undefined) return undefined;
  const result = await loadTrajectory(path);
  return result.events.length > 0 ? result : undefined;
}
