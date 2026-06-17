import { z } from "zod";
import { normalize } from "../match/normalize.js";
import type { TrajectoryEvent } from "../types.js";

const actionString = z
  .string()
  .refine((value) => value.trim().length > 0, "action signal must not be empty")
  .optional();

const argsSchema = z
  .object({
    path: actionString,
    cmd: actionString,
  })
  .catchall(z.unknown())
  .superRefine((args, ctx) => {
    const hasKnownSignal = args.path !== undefined || args.cmd !== undefined;
    const hasFallbackArgs = Object.entries(args).some(
      ([key, value]) => key !== "path" && key !== "cmd" && value !== undefined,
    );
    if (!hasKnownSignal && !hasFallbackArgs) {
      ctx.addIssue({
        code: "custom",
        message: "args must include path, cmd, or fallback fields",
      });
    }
  })
  .transform((args) => ({
    ...args,
    ...(args.path !== undefined ? { path: normalize(args.path) } : {}),
  }));

export const trajectoryEventSchema = z
  .object({
    tool: z.string().min(1),
    args: argsSchema,
    step: z.number().int().nonnegative().optional(),
    ts: z.string().optional(),
    exit_code: z.number().int().optional(),
    stdout_tail: z.string().optional(),
    stderr_tail: z.string().optional(),
  })
  .catchall(z.unknown())
  .transform(
    (value): TrajectoryEvent => ({
      tool: value.tool,
      args: value.args,
      step: value.step ?? 0,
      ...(value.ts !== undefined ? { ts: value.ts } : {}),
      ...(value.exit_code !== undefined ? { exitCode: value.exit_code } : {}),
      ...(value.stdout_tail !== undefined ? { stdoutTail: value.stdout_tail } : {}),
      ...(value.stderr_tail !== undefined ? { stderrTail: value.stderr_tail } : {}),
      raw: value,
    }),
  );

type ParseTrajectoryEventResult =
  | { success: true; data: TrajectoryEvent }
  | { success: false; error: z.ZodError };

export function parseTrajectoryEvent(value: unknown): ParseTrajectoryEventResult {
  return trajectoryEventSchema.safeParse(value);
}
