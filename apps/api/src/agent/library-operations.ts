import {
  type AgentCharacterAppearanceInput,
  type AgentCharacterCreateInput,
  type AgentCharacterUpdateInput,
  type CharacterLibraryEntry,
  type CreateCharacterRequest,
  agentCharacterCreateInputSchema,
  agentCharacterCreateOutputSchema,
  agentCharacterGetInputSchema,
  agentCharacterGetOutputSchema,
  agentCharacterListInputSchema,
  agentCharacterListOutputSchema,
  agentCharacterSetVoicesInputSchema,
  agentCharacterSetVoicesOutputSchema,
  agentCharacterUpdateInputSchema,
  agentCharacterUpdateOutputSchema,
  agentFaceSetGetInputSchema,
  agentFaceSetGetOutputSchema,
  agentFaceSetListInputSchema,
  agentFaceSetListOutputSchema,
  agentThemeGetInputSchema,
  agentThemeGetOutputSchema,
  agentThemeListInputSchema,
  agentThemeListOutputSchema,
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
import { getFaceSet, listFaceSets } from "../services/face-sets.ts";
import { getSelectableTheme, listSelectableThemes } from "../services/theme-library.ts";
import {
  createVoiceProfile,
  getVoiceProfile,
  listAdapterModels,
  listAdapterVoices,
  listVoiceProfiles,
  updateVoiceProfile,
} from "../services/voice-profiles.ts";
import { AgentOperationError, agentIssue } from "./errors.ts";
import type { AgentOperationFragment } from "./operations.ts";

/**
 * The shared libraries (Character, Face Set, Voice Profile, Theme).
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
    input.voices === undefined &&
    input.appearances === undefined
  ) {
    throw new AgentOperationError("VALIDATION_ERROR", [
      agentIssue([], "invalid_value", "更新する項目を1つ以上指定してください。"),
    ]);
  }
  // The merge read and the write share one transaction inside the service, so
  // a concurrent voice or appearance edit is never overwritten with a stale
  // snapshot.
  return updateCharacterPartial(prisma, input.characterId, {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.names === undefined ? {} : { names: input.names }),
    ...(input.voices === undefined ? {} : { voices: input.voices }),
    appearances:
      input.appearances === undefined
        ? undefined
        : input.appearances.map(toLibraryAppearance),
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
      theme: await getSelectableTheme(context.prisma, input.themeId),
    }),
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
      faceSet: await getFaceSet(context.prisma, input.faceSetId),
    }),
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
      voiceProfile: await updateVoiceProfile(context.prisma, input.voiceProfileId, {
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
