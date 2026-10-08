import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt } from "./primitives";
import { getVisualTemplate } from "../templates";

export const visualCueRangeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("scene") }),
  z.strictObject({
    kind: z.literal("lines"),
    startLineId: idSchema,
    endLineId: idSchema,
  }),
  z.strictObject({
    kind: z.literal("offset"),
    startMs: nonNegativeInt,
    endMs: nonNegativeInt,
  }),
]);

export const templateRefSchema = z.strictObject({
  id: idSchema,
  version: positiveInt,
});

export const visualCueSchema = z
  .strictObject({
    id: idSchema,
    template: templateRefSchema,
    range: visualCueRangeSchema,
    input: z.unknown(),
  })
  .superRefine((cue, ctx) => {
    const definition = getVisualTemplate(cue.template.id, cue.template.version);
    if (!definition) {
      ctx.addIssue({
        code: "custom",
        message: `未対応のVisualTemplateです: ${cue.template.id}@${cue.template.version}`,
        path: ["template"],
      });
      return;
    }
    const result = definition.inputSchema.safeParse(cue.input);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: ["input", ...issue.path],
        });
      }
    }
  });

export type VisualCue = z.infer<typeof visualCueSchema>;
