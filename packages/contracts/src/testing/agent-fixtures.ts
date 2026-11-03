import { validContentDocument } from "./fixtures";
import type {
  Asset,
  Composition,
  CompositionVersion,
  Job,
  ScriptVersion,
  Work,
} from "../index";

export const FIXTURE_TIMESTAMP = "2026-10-21T00:00:00.000Z";
export const FIXTURE_WORK_ID = "work-1";
export const FIXTURE_EDITION_ID = "led-1";
export const FIXTURE_SCRIPT_VERSION_ID = "scr-1";

export function fixtureWork(
  title = "テスト作品",
  outputProfile: Work["outputProfile"] = "landscape",
): Work {
  return {
    id: FIXTURE_WORK_ID,
    title,
    originalLocale: "ja-JP",
    outputProfile,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    parentWorkId: null,
    languageEditions: [
      {
        id: FIXTURE_EDITION_ID,
        workId: FIXTURE_WORK_ID,
        locale: "ja-JP",
        updatedAt: FIXTURE_TIMESTAMP,
        currentScriptVersion: {
          id: FIXTURE_SCRIPT_VERSION_ID,
          versionNumber: 1,
          createdAt: FIXTURE_TIMESTAMP,
        },
        latestRenderJob: null,
      },
    ],
  };
}

export function fixtureScriptVersion(
  id = FIXTURE_SCRIPT_VERSION_ID,
  versionNumber = 1,
): ScriptVersion {
  return {
    id,
    languageEditionId: FIXTURE_EDITION_ID,
    versionNumber,
    contentSchemaVersion: 1,
    author: "agent",
    authorAgentId: "mcp",
    agentRequestId: `request-${versionNumber}`,
    agentRequestHash: `hash-${versionNumber}`,
    sourceScriptVersionId: null,
    createdAt: FIXTURE_TIMESTAMP,
    content: validContentDocument(),
  };
}

export function fixtureAsset(): Asset {
  return {
    id: "asset-1",
    kind: "image",
    origin: "generated",
    status: "processing",
    originalFilename: "fixture.png",
    mediaType: "image/png",
    byteSize: 68,
    sha256: "sha256-fixture",
    durationMs: null,
    widthPx: 1,
    heightPx: 1,
    hasAudio: false,
    tags: [],
    favoritedAt: null,
    archivedAt: null,
    createdAt: FIXTURE_TIMESTAMP,
    contentUrl: "/assets/asset-1/content",
  };
}

export function fixtureAssetJob(
  status: Job["status"] = "queued",
  id = "job-asset-1",
): Job {
  return {
    id,
    kind: "asset_ingest",
    status,
    workId: null,
    assetId: "asset-1",
    languageEditionId: null,
    scriptVersionId: null,
    progressPercent: status === "succeeded" ? 100 : 0,
    createdAt: FIXTURE_TIMESTAMP,
    startedAt: null,
    finishedAt: status === "succeeded" ? FIXTURE_TIMESTAMP : null,
    error: null,
    ttsResult: null,
    artifacts: [],
  };
}

export function fixtureRenderJob(
  status: Job["status"] = "queued",
  id = "job-render-1",
): Job {
  return {
    id,
    kind: "render",
    status,
    workId: FIXTURE_WORK_ID,
    assetId: null,
    languageEditionId: FIXTURE_EDITION_ID,
    scriptVersionId: "scr-2",
    progressPercent: status === "succeeded" ? 100 : 0,
    createdAt: FIXTURE_TIMESTAMP,
    startedAt: null,
    finishedAt: status === "succeeded" ? FIXTURE_TIMESTAMP : null,
    error: null,
    ttsResult: null,
    artifacts: [],
  };
}

export function fixtureTtsJob(
  status: Job["status"] = "succeeded",
  id = "job-tts-1",
): Job {
  return {
    id,
    kind: "tts",
    status,
    workId: FIXTURE_WORK_ID,
    assetId: null,
    languageEditionId: FIXTURE_EDITION_ID,
    scriptVersionId: FIXTURE_SCRIPT_VERSION_ID,
    progressPercent: status === "succeeded" ? 100 : 0,
    createdAt: FIXTURE_TIMESTAMP,
    startedAt: status === "queued" ? null : FIXTURE_TIMESTAMP,
    finishedAt:
      status === "succeeded" || status === "failed" || status === "cancelled"
        ? FIXTURE_TIMESTAMP
        : null,
    error:
      status === "failed"
        ? { code: "TTS_SYNTHESIS_FAILED", message: "音声の合成に失敗しました。" }
        : null,
    ttsResult:
      status === "succeeded"
        ? {
            narrationSegmentId: "line-p1-1",
            assetId: "asset-tts-1",
            durationMs: 1200,
            source: "tts",
          }
        : null,
    artifacts: [],
  };
}

export function fixtureComposition(): Composition {
  return {
    id: "cmp-1",
    name: "MCP Composition",
    runtimeCompositionId: "cmp.mcp.test",
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    draft: null,
    versions: [],
  };
}

export function fixtureCompositionVersion(): CompositionVersion {
  return {
    id: "cmpver-1",
    compositionId: "cmp-1",
    versionNumber: 1,
    bundleHash: "bundle-hash-1",
    storageKey: "compositions/bundles/bundle-hash-1/cmpver-1",
    manifest: {
      entrypoint: "index.html",
      contentHash: "bundle-hash-1",
      runtimeCompositionId: "cmp.mcp.test",
      canvasProfile: "landscape",
      width: 1920,
      height: 1080,
      durationMs: 4000,
      dependencies: [],
    },
    createdAt: FIXTURE_TIMESTAMP,
  };
}
