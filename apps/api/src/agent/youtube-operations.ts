import {
  agentScriptYoutubeChaptersInputSchema,
  agentScriptYoutubeChaptersOutputSchema,
  agentYoutubeSettingsGetInputSchema,
  agentYoutubeSettingsGetOutputSchema,
  agentYoutubeSettingsUpdateInputSchema,
  agentYoutubeSettingsUpdateOutputSchema,
} from "@kakeai/contracts";
import type { AgentOperationFragment } from "./operations.ts";
import * as youtubeSettingsService from "../services/youtube-settings.ts";

export const youtubeOperationDefinitions = {
  "youtubeSettings.get": {
    input: agentYoutubeSettingsGetInputSchema,
    output: agentYoutubeSettingsGetOutputSchema,
    run: async (input, context) => {
      return youtubeSettingsService.getYouTubeVideoSettings(
        context.prisma,
        input.languageEditionId,
      );
    },
  },
  "youtubeSettings.update": {
    input: agentYoutubeSettingsUpdateInputSchema,
    output: agentYoutubeSettingsUpdateOutputSchema,
    run: async (input, context) => {
      return youtubeSettingsService.updateYouTubeVideoSettings(
        context.prisma,
        input.languageEditionId,
        input.settings,
      );
    },
  },
  "script.youtubeChapters": {
    input: agentScriptYoutubeChaptersInputSchema,
    output: agentScriptYoutubeChaptersOutputSchema,
    run: async (input, context) => {
      return youtubeSettingsService.getYouTubeChaptersForScriptVersion(
        context.prisma,
        input.scriptVersionId,
      );
    },
  },
} satisfies AgentOperationFragment;
