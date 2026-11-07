import { z } from "zod";
import { idSchema } from "../content/primitives";
import { liveSpeakerSideSchema } from "./common";

export const directorCueSchema = z.strictObject({
  speaker: liveSpeakerSideSchema,
  caption: z.string().trim().min(1),
  speech: z.string().trim().min(1),
  expression: idSchema,
});
export type DirectorCue = z.infer<typeof directorCueSchema>;

export const directorOutputSchema = z
  .strictObject({
    cues: z.array(directorCueSchema).max(10),
    skip: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (!value.skip && value.cues.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["cues"],
        message: "skip が false のとき cues を 1 件以上指定してください。",
      });
    }
  });
export type DirectorOutput = z.infer<typeof directorOutputSchema>;
