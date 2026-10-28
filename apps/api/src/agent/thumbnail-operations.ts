import {
  agentThumbnailAppearanceInputSchema,
  agentThumbnailAppearanceOutputSchema,
  agentThumbnailCreateInputSchema,
  agentThumbnailCreateOutputSchema,
  agentThumbnailGetInputSchema,
  agentThumbnailGetOutputSchema,
  agentThumbnailListInputSchema,
  agentThumbnailListOutputSchema,
  agentThumbnailListTemplatesInputSchema,
  agentThumbnailListTemplatesOutputSchema,
  agentThumbnailSetPrimaryInputSchema,
  agentThumbnailSetPrimaryOutputSchema,
  agentThumbnailTemplateContracts,
  agentThumbnailUpdateInputSchema,
  agentThumbnailUpdateOutputSchema,
} from "@kakeai/contracts";
import {
  createThumbnail,
  getThumbnail,
  getThumbnailAppearanceForEdition,
  listThumbnails,
  saveThumbnail,
  setPrimaryThumbnail,
  updateThumbnailPartial,
} from "../services/thumbnails.ts";
import { asWorkResource } from "./errors.ts";
import type { AgentOperationFragment } from "./operations.ts";

/**
 * Thumbnail candidates are a mutable, unversioned document, so these
 * operations have no `requestId` and no ledger. A timeout is recovered by
 * reading `thumbnail.list` and comparing `label` / timestamps before retrying.
 *
 * Deletion, the Work common Appearance write and appearance presets stay
 * human-only: deletion has no undo, and the appearance patch is edited in the
 * app UI. `appearanceOverride` on a candidate is part of create/update.
 */
export const thumbnailOperationDefinitions = {
  "thumbnail.listTemplates": {
    input: agentThumbnailListTemplatesInputSchema,
    output: agentThumbnailListTemplatesOutputSchema,
    // The thumbnail template registry is immutable, so this is a pure lookup.
    run: async () => ({ templates: [...agentThumbnailTemplateContracts()] }),
  },
  "thumbnail.list": {
    input: agentThumbnailListInputSchema,
    output: agentThumbnailListOutputSchema,
    run: async (input, context) => ({
      thumbnails: await asWorkResource(
        listThumbnails(context.prisma, input.languageEditionId),
      ),
    }),
  },
  "thumbnail.get": {
    input: agentThumbnailGetInputSchema,
    output: agentThumbnailGetOutputSchema,
    run: async (input, context) => ({
      thumbnail: await getThumbnail(context.prisma, input.thumbnailId),
    }),
  },
  "thumbnail.appearance": {
    input: agentThumbnailAppearanceInputSchema,
    output: agentThumbnailAppearanceOutputSchema,
    // Reads the Work-scoped appearance through the Edition context (Theme and
    // locale), so the agent contract keeps a single Edition id.
    run: async (input, context) =>
      asWorkResource(
        getThumbnailAppearanceForEdition(context.prisma, input.languageEditionId),
      ),
  },
  "thumbnail.create": {
    input: agentThumbnailCreateInputSchema,
    output: agentThumbnailCreateOutputSchema,
    run: async (input, context) => {
      const { languageEditionId, ...request } = input;
      return {
        thumbnail: await asWorkResource(
          createThumbnail(context.prisma, languageEditionId, request),
        ),
      };
    },
  },
  "thumbnail.update": {
    input: agentThumbnailUpdateInputSchema,
    output: agentThumbnailUpdateOutputSchema,
    run: async (input, context) => {
      const { thumbnailId, ...request } = input;
      return {
        thumbnail: await updateThumbnailPartial(context.prisma, thumbnailId, request),
      };
    },
  },
  "thumbnail.setPrimary": {
    input: agentThumbnailSetPrimaryInputSchema,
    output: agentThumbnailSetPrimaryOutputSchema,
    // The target candidate and the Edition are both checked here; a missing
    // reference is RESOURCE_NOT_FOUND rather than WORK_NOT_FOUND so a candidate
    // of another Edition is reported with the same code as a missing one.
    run: async (input, context) => ({
      thumbnail: await setPrimaryThumbnail(
        context.prisma,
        input.languageEditionId,
        input.thumbnailId,
      ),
    }),
  },
} satisfies AgentOperationFragment;
