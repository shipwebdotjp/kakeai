import { z } from "zod";
import { idSchema, nonNegativeInt, timestampSchema } from "../content/primitives";

export const runLogEventTypeSchema = z.enum([
  "phase_changed",
  "pin_added",
  "pin_removed",
  "comment_selected",
  "cue_generated",
  "cue_edited",
  "cue_deleted",
  "cue_skipped",
  "stopped",
  "resumed",
  "safe_mode",
  "error",
]);
export type RunLogEventType = z.infer<typeof runLogEventTypeSchema>;

const runLogDataKeySchema = z
  .string()
  .refine((key) => !["__proto__", "constructor", "prototype"].includes(key));

type RunLogValue =
  | string
  | number
  | boolean
  | null
  | RunLogValue[]
  | { [key: string]: RunLogValue };

const runLogValueSchema: z.ZodType<RunLogValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(runLogValueSchema),
    z.record(runLogDataKeySchema, runLogValueSchema),
  ]),
);

export const runLogEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: idSchema,
  sequence: nonNegativeInt,
  at: timestampSchema,
  type: runLogEventTypeSchema,
  cueId: idSchema.nullable().optional(),
  commentId: idSchema.nullable().optional(),
  data: z.record(runLogDataKeySchema, runLogValueSchema).default({}),
});
export type RunLogEvent = z.infer<typeof runLogEventSchema>;
