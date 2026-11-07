import { z } from "zod";

/** The two visible sides of the live stage. */
export const liveSideSchema = z.enum(["left", "right"]);
export type LiveSide = z.infer<typeof liveSideSchema>;

/** A speaker can be on a side, or absent from the stage. */
export const liveSpeakerSideSchema = z.enum([...liveSideSchema.options, "none"]);
export type LiveSpeakerSide = z.infer<typeof liveSpeakerSideSchema>;

export const liveCueStatusSchema = z.enum([
  "draft",
  "preparing",
  "ready",
  "playing",
  "done",
  "skipped",
  "failed",
]);
export type LiveCueStatus = z.infer<typeof liveCueStatusSchema>;

export const liveCueSourceSchema = z.enum([
  "prepared",
  "generated",
  "manual",
  "fallback",
]);
export type LiveCueSource = z.infer<typeof liveCueSourceSchema>;

export const liveCueOriginSchema = z.enum(["script", "live"]);
export type LiveCueOrigin = z.infer<typeof liveCueOriginSchema>;
