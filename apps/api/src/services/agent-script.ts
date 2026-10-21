import {
  AGENT_ERROR_CODES,
  computeContentWarnings,
  getVisualTheme,
  type CharacterLibraryEntry,
  type ContentDocument,
  type PreviewTimeline,
  type ScriptEditRequest,
  type ScriptEditResult,
  type ScriptOperationCreated,
  type ScriptSaveRequest,
  type ScriptSaveResult,
  type ScriptValidateRequest,
  type ScriptValidateResult,
  type Warning,
} from "@kakeai/contracts";
import {
  createIdGenerator,
  type ScriptAssetInfo,
  type ScriptContext,
  type ScriptLibraryCharacter,
} from "@kakeai/script-edits";
import { CompositionCompileError, collectOffsetRangeWarnings } from "@kakeai/video";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { deserializeContent } from "../domain/content-json.ts";
import { toScriptVersion } from "../dto/mappers.ts";
import { validationError, type ValidationIssue } from "../http/validation.ts";
import {
  getCompositionCanvasProfilesByVersionId,
  getCompositionDurationsByVersionId,
} from "./compositions.ts";
import { listCharacters } from "./character-library.ts";
import {
  applyAndValidateScriptOperations,
  mergeWarnings,
  validateEditedScriptContent,
  type ScriptValidationReferences,
} from "./script-edits.ts";
import {
  buildPreviewTimeline,
  collectInsertWarnings,
  getCurrentScriptVersion,
  getScriptVersion,
  renderSourceDurationMs,
  saveScriptVersion,
  throwIfFatalTimelineError,
  type AssetWithRenditions,
  type FaceSetDetails,
} from "./script-versions.ts";
import { AgentOperationError, agentIssue } from "../agent/errors.ts";
import { sha256RequestHash } from "./agent-request-hash.ts";

interface ScriptResources {
  context: ScriptContext;
  references: ScriptValidationReferences;
}

function emptyCreated(): ScriptOperationCreated {
  return {
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    audioCueIds: [],
    audioTakeIds: [],
    characterIds: [],
    appearanceIds: [],
    speakerIds: [],
  };
}

/**
 * Hash of one `script.edit` request. It uses the shared canonical JSON and
 * SHA-256 helper, so the stored `agentRequestHash` keeps the format it always
 * had and stays comparable with the idempotency ledger hashes.
 */
export function computeScriptEditRequestHash(
  request: Pick<ScriptEditRequest, "baseScriptVersionId" | "operations">,
): string {
  return sha256RequestHash({
    baseScriptVersionId: request.baseScriptVersionId,
    operations: request.operations,
  });
}

function assetInfo(asset: AssetWithRenditions): ScriptAssetInfo {
  return {
    kind: asset.kind as ScriptAssetInfo["kind"],
    status: asset.status as ScriptAssetInfo["status"],
    durationMs: renderSourceDurationMs(asset),
    hasAudio: asset.hasAudio,
  };
}

async function loadScriptResources(prisma: PrismaClient): Promise<ScriptResources> {
  const [assets, faceSets, compositionIds, themeRevisions, characterEntries] =
    await Promise.all([
      prisma.asset.findMany({ include: { renditions: true } }),
      prisma.faceSet.findMany({
        include: {
          layers: { orderBy: { position: "asc" } },
          expressions: { orderBy: { position: "asc" } },
        },
      }),
      prisma.compositionVersion.findMany({ select: { id: true } }),
      prisma.themeRevision.findMany({ select: { themeId: true, versionNumber: true } }),
      listCharacters(prisma),
    ]);

  const assetById = new Map<string, AssetWithRenditions>(
    assets.map((asset) => [asset.id, asset]),
  );
  const faceSetById = new Map<string, FaceSetDetails>(
    faceSets.map((faceSet) => [faceSet.id, faceSet]),
  );
  const libraryCharacterById = new Map<string, ScriptLibraryCharacter>(
    characterEntries.map((entry) => [entry.id, toScriptLibraryCharacter(entry)]),
  );
  const versionIds = compositionIds.map((row) => row.id);
  const [compositionDurations, compositionProfiles] = await Promise.all([
    getCompositionDurationsByVersionId(prisma, versionIds),
    getCompositionCanvasProfilesByVersionId(prisma, versionIds),
  ]);
  const revisionKeys = new Set(
    themeRevisions.map((row) => `${row.themeId}@${row.versionNumber}`),
  );

  return {
    context: {
      assets: {
        get: (assetId) => {
          const asset = assetById.get(assetId);
          return asset === undefined ? null : assetInfo(asset);
        },
      },
      ids: createIdGenerator(),
      // Read-only projection of the library; `character.addFromLibrary` copies
      // from it into the document without writing the library back.
      libraryCharacters: {
        get: (characterId) => libraryCharacterById.get(characterId) ?? null,
      },
    },
    references: {
      assetById,
      faceSetById,
      compositionDurations,
      compositionProfiles,
      themeExists: (id, version) =>
        getVisualTheme(id, version) !== undefined || revisionKeys.has(`${id}@${version}`),
    },
  };
}

/**
 * Adapts the library DTO to the operation core's read-only projection. The
 * Appearance `id` stays behind because the core assigns a new local ID.
 */
function toScriptLibraryCharacter(entry: CharacterLibraryEntry): ScriptLibraryCharacter {
  return {
    id: entry.id,
    name: entry.name,
    voices: entry.voices.map((voice) => ({
      locale: voice.locale,
      voiceProfileId: voice.voiceProfileId,
    })),
    appearances: entry.appearances.map((appearance) => ({
      assetId: appearance.assetId,
      expression: appearance.expression,
      pose: appearance.pose,
      ...(appearance.label === undefined ? {} : { label: appearance.label }),
      faceSetId: appearance.faceSetId,
    })),
  };
}

function timelineOf(content: ContentDocument): PreviewTimeline {
  try {
    return buildPreviewTimeline(content);
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      const issues: ValidationIssue[] = error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      }));
      throw validationError(issues);
    }
    throw error;
  }
}

async function warningsForContent(
  prisma: PrismaClient,
  content: ContentDocument,
): Promise<Warning[]> {
  let warnings: Warning[] = [...computeContentWarnings(content)];
  try {
    warnings = mergeWarnings(warnings, collectOffsetRangeWarnings(content));
  } catch (error) {
    throwIfFatalTimelineError(error);
  }
  try {
    warnings = mergeWarnings(warnings, await collectInsertWarnings(prisma, content));
  } catch {
    // Warnings are advisory; a failed lookup must not make a replay fail.
  }
  return warnings;
}

async function findRequestVersion(
  prisma: PrismaClient,
  languageEditionId: string,
  requestId: string,
) {
  return prisma.scriptVersion.findFirst({
    where: { languageEditionId, agentRequestId: requestId },
  });
}

async function replayVersion(
  prisma: PrismaClient,
  row: NonNullable<Awaited<ReturnType<typeof findRequestVersion>>>,
  requestHash: string,
): Promise<ScriptEditResult> {
  if (row.agentRequestHash !== requestHash) {
    throw new AgentOperationError(AGENT_ERROR_CODES.IDEMPOTENCY_CONFLICT, [
      agentIssue(
        ["requestId"],
        "idempotency_conflict",
        "同じ requestId が異なる入力で使われました。",
      ),
    ]);
  }
  const content = deserializeContent(row.contentJson);
  return {
    scriptVersion: toScriptVersion(row, content),
    created: emptyCreated(),
    warnings: await warningsForContent(prisma, content),
    timeline: timelineOf(content),
    replay: true,
  };
}

function scriptBaseStaleError(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.SCRIPT_BASE_STALE, [
    agentIssue(
      ["baseScriptVersionId"],
      "stale",
      "基準の台本版が現在の版ではありません。最新の版を取得して再試行してください。",
    ),
  ]);
}

function normalizedAgentId(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function editAgentScript(
  prisma: PrismaClient,
  request: ScriptEditRequest,
  defaultAgentId?: string,
): Promise<ScriptEditResult> {
  const base = await prisma.scriptVersion.findUnique({
    where: { id: request.baseScriptVersionId },
    include: {
      languageEdition: { select: { id: true, currentScriptVersionId: true } },
    },
  });
  if (base === null) {
    throw new AgentOperationError(AGENT_ERROR_CODES.WORK_NOT_FOUND, [
      agentIssue(["baseScriptVersionId"], "not_found", "基準の台本版が見つかりません。"),
    ]);
  }

  const editionId = base.languageEditionId;
  const requestHash = computeScriptEditRequestHash(request);
  const existing = await findRequestVersion(prisma, editionId, request.requestId);
  if (existing !== null) {
    return replayVersion(prisma, existing, requestHash);
  }

  if (base.languageEdition.currentScriptVersionId !== base.id) {
    throw scriptBaseStaleError();
  }

  const content = deserializeContent(base.contentJson);
  const resources = await loadScriptResources(prisma);
  const edited = applyAndValidateScriptOperations(
    content,
    request.operations,
    resources.context,
    resources.references,
  );
  const timeline = timelineOf(edited.document);

  let saved;
  try {
    saved = await saveScriptVersion(
      prisma,
      editionId,
      { sourceScriptVersionId: null, content: edited.document },
      {
        author: "agent",
        authorAgentId:
          normalizedAgentId(request.authorAgentId) ?? normalizedAgentId(defaultAgentId),
        agentRequestId: request.requestId,
        agentRequestHash: requestHash,
      },
      {
        expectedCurrentScriptVersionId: base.id,
        staleError: scriptBaseStaleError,
      },
    );
  } catch (error) {
    // A concurrent identical retry may have won the race after our replay
    // lookup. Re-read the request id before reporting a failure.
    const raced = await findRequestVersion(prisma, editionId, request.requestId);
    if (raced !== null) {
      return replayVersion(prisma, raced, requestHash);
    }
    throw error;
  }

  return {
    scriptVersion: saved.scriptVersion,
    created: edited.created,
    warnings: mergeWarnings(edited.warnings, saved.warnings),
    timeline,
    replay: false,
  };
}

export async function validateAgentScript(
  prisma: PrismaClient,
  request: ScriptValidateRequest,
): Promise<ScriptValidateResult> {
  let content: ContentDocument;
  let warnings: Warning[];
  if ("content" in request) {
    content = request.content;
    const resources = await loadScriptResources(prisma);
    warnings = validateEditedScriptContent(content, resources.references);
    warnings = mergeWarnings(warnings, await collectInsertWarnings(prisma, content));
  } else {
    const base = await prisma.scriptVersion.findUnique({
      where: { id: request.baseScriptVersionId },
    });
    if (base === null) {
      throw new AgentOperationError(AGENT_ERROR_CODES.WORK_NOT_FOUND, [
        agentIssue(["baseScriptVersionId"], "not_found", "基準の台本版が見つかりません。"),
      ]);
    }
    const resources = await loadScriptResources(prisma);
    const edited = applyAndValidateScriptOperations(
      deserializeContent(base.contentJson),
      request.operations,
      resources.context,
      resources.references,
    );
    content = edited.document;
    warnings = mergeWarnings(
      edited.warnings,
      await collectInsertWarnings(prisma, content),
    );
  }
  return { warnings, timeline: timelineOf(content) };
}

export async function saveAgentScript(
  prisma: PrismaClient,
  request: ScriptSaveRequest,
  defaultAgentId?: string,
): Promise<ScriptSaveResult> {
  const edition = await prisma.languageEdition.findUnique({
    where: { id: request.languageEditionId },
    select: { id: true },
  });
  if (edition === null) {
    throw new AgentOperationError(AGENT_ERROR_CODES.WORK_NOT_FOUND, [
      agentIssue(["languageEditionId"], "not_found", "言語版が見つかりません。"),
    ]);
  }
  return saveScriptVersion(
    prisma,
    edition.id,
    { sourceScriptVersionId: null, content: request.content },
    {
      author: "agent",
      authorAgentId: normalizedAgentId(request.authorAgentId) ?? normalizedAgentId(defaultAgentId),
      agentRequestId: null,
      agentRequestHash: null,
    },
  );
}

export async function getAgentScript(
  prisma: PrismaClient,
  input: { scriptVersionId?: string; languageEditionId?: string },
) {
  if (input.scriptVersionId !== undefined) {
    return getScriptVersion(prisma, input.scriptVersionId);
  }
  if (input.languageEditionId !== undefined) {
    return getCurrentScriptVersion(prisma, input.languageEditionId);
  }
  throw new AgentOperationError(AGENT_ERROR_CODES.VALIDATION_ERROR, [
    agentIssue(
      ["scriptVersionId"],
      "invalid_value",
      "scriptVersionId または languageEditionId を指定してください。",
    ),
  ]);
}
