import {
  type AgentCharacterAppearanceInput,
  type AgentCharacterCreateInput,
  type AgentCharacterUpdateInput,
  type CharacterLibraryEntry,
  type CreateCharacterRequest,
  agentCharacterAddAppearanceInputSchema,
  agentCharacterAddAppearanceOutputSchema,
  agentCharacterCreateInputSchema,
  agentCharacterCreateOutputSchema,
  agentCharacterGetInputSchema,
  agentCharacterGetOutputSchema,
  agentCharacterListInputSchema,
  agentCharacterListOutputSchema,
  agentCharacterSetVoicesInputSchema,
  agentCharacterSetVoicesOutputSchema,
  agentCharacterUpdateInputSchema,
  agentCharacterUpdateOneAppearanceInputSchema,
  agentCharacterUpdateOneAppearanceOutputSchema,
  agentCharacterUpdateOutputSchema,
  agentEmptyInputSchema,
  agentFaceSetCreateInputSchema,
  agentFaceSetCreateOutputSchema,
  agentFaceSetGetInputSchema,
  agentFaceSetGetOutputSchema,
  agentFaceSetListInputSchema,
  agentFaceSetListOutputSchema,
  agentFaceSetUpdateInputSchema,
  agentFaceSetUpdateOutputSchema,
  agentFaceSetUsagesInputSchema,
  agentFaceSetUsagesOutputSchema,
  agentFontListInputSchema,
  agentFontListOutputSchema,
  agentThemeCreateInputSchema,
  agentThemeCreateOutputSchema,
  agentThemeDiagnoseInputSchema,
  agentThemeDiagnoseOutputSchema,
  agentThemeDraftGetInputSchema,
  agentThemeDraftGetOutputSchema,
  agentThemeDraftSaveInputSchema,
  agentThemeDraftSaveOutputSchema,
  agentThemeGetInputSchema,
  agentThemeGetOutputSchema,
  agentThemeListInputSchema,
  agentThemeListOutputSchema,
  agentThemePublishInputSchema,
  agentThemePublishOutputSchema,
  agentVoiceProfileCreateInputSchema,
  agentVoiceProfileCreateOutputSchema,
  agentVoiceProfileGetInputSchema,
  agentVoiceProfileGetOutputSchema,
  agentVoiceProfileListInputSchema,
  agentVoiceProfileListModelsInputSchema,
  agentVoiceProfileListModelsOutputSchema,
  agentVoiceProfileListOutputSchema,
  agentVoiceProfileListVoicesInputSchema,
  agentVoiceProfileListVoicesOutputSchema,
  agentVoiceProfileUpdateInputSchema,
  agentVoiceProfileUpdateOutputSchema,
  voiceAdapterListSchema,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import {
  createCharacter,
  getCharacter,
  listCharacters,
  newCharacterAppearanceId,
  setCharacterVoices,
  updateCharacterPartial,
} from "../services/character-library.ts";
import {
  addCharacterAppearance,
  updateCharacterAppearance,
} from "../services/character-appearances.ts";
import {
  createFaceSet,
  getFaceSet,
  getFaceSetUsages,
  listFaceSets,
  updateFaceSetPartial,
} from "../services/face-sets.ts";
import { searchFonts } from "../services/font-library.ts";
import {
  getThemeDetail,
  getThemeDraft,
  listSelectableThemes,
} from "../services/theme-library.ts";
import {
  createVoiceProfile,
  getVoiceProfile,
  listAdapterModels,
  listAdapterVoices,
  listVoiceAdapters,
  listVoiceProfiles,
  updateVoiceProfilePartial,
} from "../services/voice-profiles.ts";
import { AgentOperationError, agentIssue } from "./errors.ts";
import type { AgentOperationFragment } from "./operations.ts";

/**
 * The shared libraries (Character, Face Set, Voice Profile, Theme), the
 * installed Font Catalog, and the static Voice Adapter descriptors.
 *
 * Reads are open. Writes are limited to the reversible ones: Voice Profile
 * creation/update and Character creation/update (ADR 0088 / 0089 / 0099).
 * Deletion, Face Set and Theme management stay human-only. A library edit
 * never touches an existing Script Version because scripts hold copies; the
 * next `character.addFromLibrary` copy and later TTS are what see the change.
 */

function toLibraryAppearance(
  appearance: AgentCharacterAppearanceInput,
): CreateCharacterRequest["appearances"][number] {
  return {
    id: newCharacterAppearanceId(),
    assetId: appearance.assetId,
    expression: appearance.expression,
    pose: appearance.pose,
    ...(appearance.label === undefined ? {} : { label: appearance.label }),
    faceSetId: appearance.faceSetId,
  };
}

async function createCharacterFromAgent(
  prisma: PrismaClient,
  input: AgentCharacterCreateInput,
): Promise<CharacterLibraryEntry> {
  return createCharacter(prisma, {
    name: input.name,
    names: input.names,
    voices: input.voices,
    appearances: input.appearances.map(toLibraryAppearance),
  });
}

async function updateCharacterFromAgent(
  prisma: PrismaClient,
  input: AgentCharacterUpdateInput,
): Promise<CharacterLibraryEntry> {
  if (
    input.name === undefined &&
    input.names === undefined &&
    input.voices === undefined
  ) {
    throw new AgentOperationError("VALIDATION_ERROR", [
      agentIssue([], "invalid_value", "更新する項目を1つ以上指定してください。"),
    ]);
  }
  // The merge read and the write share one transaction inside the service, so
  // a concurrent voice edit is never overwritten with a stale snapshot.
  return updateCharacterPartial(prisma, input.characterId, {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.names === undefined ? {} : { names: input.names }),
    ...(input.voices === undefined ? {} : { voices: input.voices }),
  });
}

export const libraryOperationDefinitions = {
  // Copying into a script goes through `script.edit` +
  // `character.addFromLibrary`; these operations edit the library itself.
  "character.list": {
    input: agentCharacterListInputSchema,
    output: agentCharacterListOutputSchema,
    run: async (_input, context) => ({
      characters: await listCharacters(context.prisma),
    }),
  },
  "character.get": {
    input: agentCharacterGetInputSchema,
    output: agentCharacterGetOutputSchema,
    run: async (input, context) => ({
      character: await getCharacter(context.prisma, input.characterId),
    }),
  },
  // A new library resource, like voiceProfile.create / work.create: no
  // requestId, so a caller confirms with character.list after a timeout.
  "character.create": {
    input: agentCharacterCreateInputSchema,
    output: agentCharacterCreateOutputSchema,
    run: async (input, context) => ({
      character: await createCharacterFromAgent(context.prisma, input),
    }),
  },
  // A partial update. Omitted members stay as they are and a provided list
  // replaces that whole list, so changing the name cannot clear the voices.
  "character.update": {
    input: agentCharacterUpdateInputSchema,
    output: agentCharacterUpdateOutputSchema,
    run: async (input, context) => ({
      character: await updateCharacterFromAgent(context.prisma, input),
    }),
  },
  "character.addAppearance": {
    input: agentCharacterAddAppearanceInputSchema,
    output: agentCharacterAddAppearanceOutputSchema,
    run: async (input, context) => ({
      character: await addCharacterAppearance(
        context.prisma,
        input.characterId,
        {
          assetId: input.assetId,
          expression: input.expression,
          pose: input.pose,
          ...(input.label === undefined ? {} : { label: input.label }),
          faceSetId: input.faceSetId,
        },
      ),
    }),
  },
  "character.updateAppearance": {
    input: agentCharacterUpdateOneAppearanceInputSchema,
    output: agentCharacterUpdateOneAppearanceOutputSchema,
    run: async (input, context) => {
      if (
        input.assetId === undefined &&
        input.expression === undefined &&
        input.pose === undefined &&
        input.label === undefined &&
        input.faceSetId === undefined
      ) {
        throw new AgentOperationError("VALIDATION_ERROR", [
          agentIssue(
            [],
            "invalid_value",
            "更新する項目を1つ以上指定してください。",
          ),
        ]);
      }
      return {
        character: await updateCharacterAppearance(
          context.prisma,
          input.characterId,
          input.appearanceId,
          {
            ...(input.assetId === undefined ? {} : { assetId: input.assetId }),
            ...(input.expression === undefined
              ? {}
              : { expression: input.expression }),
            ...(input.pose === undefined ? {} : { pose: input.pose }),
            ...(input.label === undefined ? {} : { label: input.label }),
            ...(input.faceSetId === undefined
              ? {}
              : { faceSetId: input.faceSetId }),
          },
        ),
      };
    },
  },
  "character.setVoices": {
    input: agentCharacterSetVoicesInputSchema,
    output: agentCharacterSetVoicesOutputSchema,
    run: async (input, context) => ({
      character: await setCharacterVoices(context.prisma, input.characterId, input.voices),
    }),
  },
  "theme.list": {
    input: agentThemeListInputSchema,
    output: agentThemeListOutputSchema,
    run: async (_input, context) => ({
      themes: await listSelectableThemes(context.prisma),
    }),
  },
  "theme.get": {
    input: agentThemeGetInputSchema,
    output: agentThemeGetOutputSchema,
    run: async (input, context) => ({
      theme: await getThemeDetail(context.prisma, input.themeId, input.version),
    }),
  },
  "theme.diagnose": {
    input: agentThemeDiagnoseInputSchema,
    output: agentThemeDiagnoseOutputSchema,
    run: async (input, context) => {
      const theme = await getThemeDetail(context.prisma, input.themeId, input.version);
      const resolution = await context.fontCatalogService.resolveThemeFonts(
        theme.definition,
        { verify: input.verify, locale: input.locale },
      );
      return {
        diagnosis: {
          themeId: theme.id,
          version: theme.version,
          locale: input.locale,
          catalogSupported: resolution.catalogSupported,
          verificationSupported: resolution.verificationSupported,
          verificationReason: resolution.verificationReason,
          roles: resolution.roles,
          missingFonts: resolution.missingFonts,
          diagnostics: resolution.diagnostics,
        },
      };
    },
  },
  // Theme writes are additive: a new Theme, its mutable draft, and a new
  // immutable Revision. Archive and delete stay human-only.
  "theme.create": {
    input: agentThemeCreateInputSchema,
    output: agentThemeCreateOutputSchema,
    run: async (input, context) => {
      const detail = await context.themes.createTheme(input);
      const draft = detail.draft;
      if (draft === null) {
        throw new AgentOperationError("INTERNAL_ERROR");
      }
      return { themeId: detail.id, draft };
    },
  },
  "theme.draft.get": {
    input: agentThemeDraftGetInputSchema,
    output: agentThemeDraftGetOutputSchema,
    run: async (input, context) => ({
      draft: await getThemeDraft(context.prisma, input.themeId),
    }),
  },
  "theme.draft.save": {
    input: agentThemeDraftSaveInputSchema,
    output: agentThemeDraftSaveOutputSchema,
    run: async (input, context) => {
      const detail = await context.themes.updateThemeDraft(
        input.themeId,
        input.definition,
      );
      const draft = detail.draft;
      if (draft === null) {
        throw new AgentOperationError("INTERNAL_ERROR");
      }
      return { draft };
    },
  },
  "theme.publish": {
    input: agentThemePublishInputSchema,
    output: agentThemePublishOutputSchema,
    run: async (input, context) => {
      const detail = await context.themes.publishThemeDraft(input.themeId);
      const revision = detail.latestRevision;
      if (revision === null) {
        throw new AgentOperationError("INTERNAL_ERROR");
      }
      return {
        theme: {
          id: detail.id,
          name: detail.name,
          isBuiltIn: detail.isBuiltIn,
          version: revision.version,
          definition: revision.definition,
        },
      };
    },
  },
  // The catalog is large (thousands of faces), so this read filters and pages
  // instead of returning every installed face.
  "font.list": {
    input: agentFontListInputSchema,
    output: agentFontListOutputSchema,
    run: async (input, context) =>
      searchFonts(await context.fontCatalogService.getCatalog(), input),
  },
  "faceSet.list": {
    input: agentFaceSetListInputSchema,
    output: agentFaceSetListOutputSchema,
    run: async (_input, context) => ({
      faceSets: await listFaceSets(context.prisma),
    }),
  },
  "faceSet.get": {
    input: agentFaceSetGetInputSchema,
    output: agentFaceSetGetOutputSchema,
    run: async (input, context) => ({
      faceSet: await getFaceSet(context.prisma, input.faceSetId, input.version),
    }),
  },
  // A new library resource, like character.create / voiceProfile.create: no
  // requestId, so a caller confirms with faceSet.list after a timeout.
  "faceSet.create": {
    input: agentFaceSetCreateInputSchema,
    output: agentFaceSetCreateOutputSchema,
    run: async (input, context) => ({
      faceSet: await createFaceSet(context.prisma, input),
    }),
  },
  // A partial edit. Only a changed layers/expressions list creates a new
  // revision; a name-only change does not. Library Characters follow the
  // latest revision, saved works keep their pinned faceSetVersion.
  "faceSet.update": {
    input: agentFaceSetUpdateInputSchema,
    output: agentFaceSetUpdateOutputSchema,
    run: async (input, context) => ({
      faceSet: await updateFaceSetPartial(context.prisma, input.faceSetId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.layers === undefined ? {} : { layers: input.layers }),
        ...(input.expressions === undefined
          ? {}
          : { expressions: input.expressions }),
      }),
    }),
  },
  "faceSet.usages": {
    input: agentFaceSetUsagesInputSchema,
    output: agentFaceSetUsagesOutputSchema,
    run: async (input, context) => ({
      usages: await getFaceSetUsages(context.prisma, input.faceSetId),
    }),
  },
  // Static descriptors only: connection URLs, env names and credentials are
  // adapter settings, which agents may not read or change.
  "voiceAdapter.list": {
    input: agentEmptyInputSchema,
    output: voiceAdapterListSchema,
    run: async () => listVoiceAdapters(),
  },
  "voiceProfile.listVoices": {
    input: agentVoiceProfileListVoicesInputSchema,
    output: agentVoiceProfileListVoicesOutputSchema,
    run: async (input, context) =>
      listAdapterVoices(context.config, input.adapterId, input.model),
  },
  "voiceProfile.listModels": {
    input: agentVoiceProfileListModelsInputSchema,
    output: agentVoiceProfileListModelsOutputSchema,
    run: async (input, context) => listAdapterModels(context.config, input.adapterId),
  },
  "voiceProfile.create": {
    input: agentVoiceProfileCreateInputSchema,
    output: agentVoiceProfileCreateOutputSchema,
    // A new library resource, like work.create: no requestId, so callers
    // confirm with voiceProfile.list before retrying after a timeout.
    run: async (input, context) => ({
      voiceProfile: await createVoiceProfile(context.prisma, input),
    }),
  },
  "voiceProfile.update": {
    input: agentVoiceProfileUpdateInputSchema,
    output: agentVoiceProfileUpdateOutputSchema,
    run: async (input, context) => ({
      voiceProfile: await updateVoiceProfilePartial(context.prisma, input.voiceProfileId, {
        name: input.name,
        voiceId: input.voiceId,
        locale: input.locale,
        settings: input.settings,
      }),
    }),
  },
  "voiceProfile.list": {
    input: agentVoiceProfileListInputSchema,
    output: agentVoiceProfileListOutputSchema,
    run: async (_input, context) => ({
      voiceProfiles: await listVoiceProfiles(context.prisma),
    }),
  },
  "voiceProfile.get": {
    input: agentVoiceProfileGetInputSchema,
    output: agentVoiceProfileGetOutputSchema,
    run: async (input, context) => ({
      voiceProfile: await getVoiceProfile(context.prisma, input.voiceProfileId),
    }),
  },
} satisfies AgentOperationFragment;
