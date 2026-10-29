import { z } from "zod";
import { idSchema } from "../content/primitives";
import {
  updateYouTubeVideoSettingsRequestSchema,
  youtubeChaptersResultSchema,
  youtubeVideoSettingsViewSchema,
} from "../youtube/settings";

export const agentYoutubeSettingsGetInputSchema = z.strictObject({
  languageEditionId: idSchema,
});
export const agentYoutubeSettingsGetOutputSchema = youtubeVideoSettingsViewSchema;

export const agentYoutubeSettingsUpdateInputSchema = z.strictObject({
  languageEditionId: idSchema,
  settings: updateYouTubeVideoSettingsRequestSchema,
});
export const agentYoutubeSettingsUpdateOutputSchema = youtubeVideoSettingsViewSchema;

export const agentScriptYoutubeChaptersInputSchema = z.strictObject({
  scriptVersionId: idSchema,
});
export const agentScriptYoutubeChaptersOutputSchema = youtubeChaptersResultSchema;
