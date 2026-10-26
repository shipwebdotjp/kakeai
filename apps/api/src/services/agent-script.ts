import {
  AGENT_ERROR_CODES,
  computeContentWarnings,
  getVisualTheme,
  localeSchema,
  type CharacterLibraryEntry,
  type ContentDocument,
  type PreviewTimeline,
  type ScriptEditRequest,
  type ScriptEditResult,
  type ScriptOperationCreated,
  type ScriptSaveRequest,
  type ScriptSaveResult,
  type ScriptListVersionsResult,
  type ScriptRestoreRequest,
  type ScriptRestoreResult,
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
  getScriptVersionHistory,
  renderSourceDurationMs,
  saveScriptVersion,
  throwIfFatalTimelineError,
  type AssetWithRenditions,
  type FaceSetDetails,
  type SaveScriptVersionGuard,
} from "./script-versions.ts";
import { selectableThemeKeys } from "./theme-library.ts";
import { AgentOperationError, agentIssue } from "../agent/errors.ts";
import { normalizeAgentId } from "./attribution.ts";
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

/**
 * Hash of one `script.restore` request. The caller-supplied author identity is
 * not part of the logical request, so a retry that only changes it replays the
 * existing version.
 */
export function computeScriptRestoreRequestHash(
  request: Pick<ScriptRestoreRequest, "scriptVersionId" | "baseScriptVersionId">,
): string {
  return sha256RequestHash({
    scriptVersionId: request.scriptVersionId,
    baseScriptVersionId: request.baseScriptVersionId,
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
  const [
    assets,
    faceSets,
    compositionIds,
    themeRevisions,
    characterEntries,
    voiceProfileRows,
    selectableThemeKeySet,
  ] = await Promise.all([
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
    prisma.voiceProfile.findMany({ select: { id: true, locale: true } }),
    selectableThemeKeys(prisma),
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
  const voiceProfileById = new Map<
    string,
    { id: string; locale: ContentDocument["locale"] }
  >();
  for (const row of voiceProfileRows) {
    // A locale outside the supported registry is corrupt data. Skip it so the
    // profile behaves as "not found" for assignment instead of failing every
    // script edit that loads the voice-profile context.
    const locale = localeSchema.safeParse(row.locale);
    if (locale.success) {
      voiceProfileById.set(row.id, { id: row.id, locale: locale.data });
    }
  }
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
      voiceProfiles: {
        get: (voiceProfileId) => voiceProfileById.get(voiceProfileId) ?? null,
      },
      // User Theme keys; the operation core checks built-ins directly.
      themes: {
        isSelectable: (id, version) =>
          selectableThemeKeySet.has(`${id}@${version}`),
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
    names: entry.names.map((name) => ({
      locale: name.locale,
      name: name.name,
    })),
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

type RequestVersionRow = NonNullable<
  Awaited<ReturnType<typeof findRequestVersion>>
>;

/**
 * Shared replay path for the version-level idempotency of `script.edit` and
 * `script.restore`. Both operations persist `agentRequestHash` on the created
 * version, so a replay must verify the hash, rebuild warnings from the saved
 * content and hand the result to the operation-specific builder.
 */
async function replayRequestVersion<T>(
  prisma: PrismaClient,
  row: RequestVersionRow,
  requestHash: string,
  build: (
    content: ContentDocument,
    warnings: Warning[],
    scriptVersion: ReturnType<typeof toScriptVersion>,
  ) => T,
): Promise<T> {
  if (row.agentRequestHash !== requestHash) {
    throw idempotencyConflictError();
  }
  const content = deserializeContent(row.contentJson);
  const warnings = await warningsForContent(prisma, content);
  return build(content, warnings, toScriptVersion(row, content));
}

async function replayVersion(
  prisma: PrismaClient,
  row: RequestVersionRow,
  requestHash: string,
): Promise<ScriptEditResult> {
  return replayRequestVersion(
    prisma,
    row,
    requestHash,
    (content, warnings, scriptVersion) => ({
      scriptVersion,
      created: emptyCreated(),
      warnings,
      timeline: timelineOf(content),
      replay: true,
    }),
  );
}

function idempotencyConflictError(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.IDEMPOTENCY_CONFLICT, [
    agentIssue(
      ["requestId"],
      "idempotency_conflict",
      "同じ requestId が異なる入力で使われました。",
    ),
  ]);
}

async function replayRestoreVersion(
  prisma: PrismaClient,
  row: RequestVersionRow,
  requestHash: string,
): Promise<ScriptRestoreResult> {
  return replayRequestVersion(
    prisma,
    row,
    requestHash,
    (_content, warnings, scriptVersion) => ({
      scriptVersion,
      warnings,
      replay: true,
    }),
  );
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

/**
 * Builds the optional compare-and-set guard for `script.save` and
 * `script.restore`. The base must exist in the same Edition; the current
 * version is checked inside the save transaction.
 */
async function baseGuardFor(
  prisma: PrismaClient,
  editionId: string,
  baseScriptVersionId: string | undefined,
): Promise<SaveScriptVersionGuard | undefined> {
  if (baseScriptVersionId === undefined) {
    return undefined;
  }
  const base = await prisma.scriptVersion.findUnique({
    where: { id: baseScriptVersionId },
    select: { languageEditionId: true },
  });
  if (base === null) {
    throw new AgentOperationError(AGENT_ERROR_CODES.WORK_NOT_FOUND, [
      agentIssue(["baseScriptVersionId"], "not_found", "基準の台本版が見つかりません。"),
    ]);
  }
  if (base.languageEditionId !== editionId) {
    throw new AgentOperationError(AGENT_ERROR_CODES.VALIDATION_ERROR, [
      agentIssue(
        ["baseScriptVersionId"],
        "invalid_value",
        "基準の台本版は同じ言語版の版を指定してください。",
      ),
    ]);
  }
  return {
    expectedCurrentScriptVersionId: baseScriptVersionId,
    staleError: scriptBaseStaleError,
  };
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
          normalizeAgentId(request.authorAgentId) ?? normalizeAgentId(defaultAgentId),
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

  const guard = await baseGuardFor(prisma, edition.id, request.baseScriptVersionId);

  return saveScriptVersion(
    prisma,
    edition.id,
    { sourceScriptVersionId: request.sourceScriptVersionId, content: request.content },
    {
      author: "agent",
      authorAgentId: normalizeAgentId(request.authorAgentId) ?? normalizeAgentId(defaultAgentId),
      agentRequestId: null,
      agentRequestHash: null,
    },
    guard,
  );
}

export async function listAgentScriptVersions(
  prisma: PrismaClient,
  languageEditionId: string,
): Promise<ScriptListVersionsResult> {
  const history = await getScriptVersionHistory(prisma, languageEditionId);
  return {
    languageEditionId,
    currentScriptVersionId: history.currentScriptVersionId,
    scriptVersions: history.scriptVersions,
  };
}

/**
 * Restores an earlier version as a new version. The source content is read on
 * the server, so the caller never uploads a ContentDocument and cannot change
 * it in transit. The new version records the source id and is attributed to
 * the agent. `requestId` is idempotent on the created version, like
 * `script.edit`: a replay returns the existing version instead of creating a
 * second one.
 */
export async function restoreAgentScript(
  prisma: PrismaClient,
  request: ScriptRestoreRequest,
  defaultAgentId?: string,
): Promise<ScriptRestoreResult> {
  const source = await prisma.scriptVersion.findUnique({
    where: { id: request.scriptVersionId },
    include: {
      languageEdition: { select: { currentScriptVersionId: true } },
    },
  });
  if (source === null) {
    throw new AgentOperationError(AGENT_ERROR_CODES.WORK_NOT_FOUND, [
      agentIssue(["scriptVersionId"], "not_found", "復元元の台本版が見つかりません。"),
    ]);
  }

  const editionId = source.languageEditionId;
  const requestHash = computeScriptRestoreRequestHash(request);
  const existing = await findRequestVersion(prisma, editionId, request.requestId);
  if (existing !== null) {
    return replayRestoreVersion(prisma, existing, requestHash);
  }

  if (source.languageEdition.currentScriptVersionId === source.id) {
    throw new AgentOperationError(AGENT_ERROR_CODES.VALIDATION_ERROR, [
      agentIssue(
        ["scriptVersionId"],
        "invalid_value",
        "指定した版は現在の版です。復元する必要はありません。",
      ),
    ]);
  }

  const guard = await baseGuardFor(prisma, editionId, request.baseScriptVersionId);

  const content = deserializeContent(source.contentJson);
  let saved: Awaited<ReturnType<typeof saveScriptVersion>>;
  try {
    saved = await saveScriptVersion(
      prisma,
      editionId,
      { sourceScriptVersionId: source.id, content },
      {
        author: "agent",
        authorAgentId:
          normalizeAgentId(request.authorAgentId) ?? normalizeAgentId(defaultAgentId),
        agentRequestId: request.requestId,
        agentRequestHash: requestHash,
      },
      guard,
      { enforceSelectableTheme: false },
    );
  } catch (error) {
    // A concurrent identical restore may have won the race after the replay
    // lookup. Re-read the request id before reporting a failure.
    const raced = await findRequestVersion(prisma, editionId, request.requestId);
    if (raced !== null) {
      return replayRestoreVersion(prisma, raced, requestHash);
    }
    throw error;
  }

  return {
    scriptVersion: saved.scriptVersion,
    warnings: saved.warnings,
    replay: false,
  };
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
