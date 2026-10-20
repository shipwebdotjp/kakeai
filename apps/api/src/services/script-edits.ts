import {
  contentDocumentSchema,
  collectAssetReferences,
  compositionFullBleedInputSchema,
  computeContentWarnings,
  getVisualTheme,
  type ContentDocument,
  type ScriptOperation,
  type Warning,
} from "@kakeai/contracts";
import {
  applyScriptOperations,
  type ScriptContext,
  type ScriptOperationResult,
} from "@kakeai/script-edits";
import {
  OFFSET_RANGE_CLAMPED_CODE,
  OFFSET_RANGE_OUT_OF_SCENE_CODE,
  collectCompositionWindowIssues,
  collectOffsetRangeWarnings,
  collectTimelineIssues,
} from "@kakeai/video";
import { validationError, type ValidationIssue } from "../http/validation.ts";
import { collectCompositionVersionIds } from "./compositions.ts";
import {
  assertAssetsAvailable,
  assertFaceSetReferences,
  assertInsertScenes,
  assertTakeDurations,
  assertVideoPlayback,
  throwIfFatalTimelineError,
  type AssetWithRenditions,
  type FaceSetDetails,
} from "./script-versions.ts";

export interface ScriptValidationReferences {
  assetById: Map<string, AssetWithRenditions>;
  faceSetById: Map<string, FaceSetDetails>;
  compositionDurations: Map<string, number>;
  compositionProfiles: Map<string, "landscape" | "portrait">;
  themeExists?: (id: string, version: number) => boolean;
}

export interface ValidatedScriptEditResult extends ScriptOperationResult {
  warnings: Warning[];
}

function warningKey(warning: Warning): string {
  return `${warning.code}|${warning.path.join("/")}|${warning.message}`;
}

export function mergeWarnings(first: Warning[], second: Warning[]): Warning[] {
  const seen = new Set(first.map(warningKey));
  const merged = [...first];
  for (const warning of second) {
    const key = warningKey(warning);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(warning);
    }
  }
  return merged;
}

export function validateEditedScriptContent(
  content: ContentDocument,
  references: ScriptValidationReferences,
): Warning[] {
  const parsed = contentDocumentSchema.safeParse(content);
  if (!parsed.success) {
    throw validationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.filter(
          (segment): segment is string | number =>
            typeof segment === "string" || typeof segment === "number",
        ),
        code: "invalid_value",
        message: issue.message,
      })),
    );
  }
  const document = parsed.data;

  let timelineIssues: ReturnType<typeof collectTimelineIssues> = [];
  try {
    timelineIssues = collectTimelineIssues(document);
  } catch (error) {
    throwIfFatalTimelineError(error);
  }
  if (timelineIssues.length > 0) {
    throw validationError(
      timelineIssues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  const compositionVersionIds = collectCompositionVersionIds(document);
  const missingCompositionVersionIds = compositionVersionIds.filter(
    (versionId) => !references.compositionDurations.has(versionId),
  );
  if (missingCompositionVersionIds.length > 0) {
    const cuePathByVersionId = new Map<string, (string | number)[]>();
    document.scenes.forEach((scene, sceneIndex) => {
      scene.visualCues.forEach((cue, cueIndex) => {
        if (cue.template.id !== "composition.full-bleed") {
          return;
        }
        const input = compositionFullBleedInputSchema.safeParse(cue.input);
        if (!input.success) {
          return;
        }
        if (!cuePathByVersionId.has(input.data.compositionVersionId)) {
          cuePathByVersionId.set(input.data.compositionVersionId, [
            "scenes",
            sceneIndex,
            "visualCues",
            cueIndex,
            "input",
            "compositionVersionId",
          ]);
        }
      });
    });
    throw validationError(
      missingCompositionVersionIds.map((versionId) => ({
        path: cuePathByVersionId.get(versionId) ?? ["compositions", versionId],
        code: "invalid_value",
        message: `CompositionVersionが見つかりません: ${versionId}`,
      })),
    );
  }

  const portraitIssues: ValidationIssue[] = [];
  document.scenes.forEach((scene, sceneIndex) => {
    scene.visualCues.forEach((cue, cueIndex) => {
      if (cue.template.id !== "composition.full-bleed") {
        return;
      }
      const input = compositionFullBleedInputSchema.safeParse(cue.input);
      if (!input.success) {
        return;
      }
      if (references.compositionProfiles.get(input.data.compositionVersionId) === "portrait") {
        portraitIssues.push({
          path: ["scenes", sceneIndex, "visualCues", cueIndex, "input", "compositionVersionId"],
          code: "invalid_value",
          message:
            "composition.full-bleed@1 には横長(landscape)のCompositionVersionだけを指定できます。縦型はscene.device-frame@1の画面に配置してください。",
        });
      }
    });
  });
  if (portraitIssues.length > 0) {
    throw validationError(portraitIssues);
  }

  let compositionWindowIssues: ReturnType<typeof collectCompositionWindowIssues> = [];
  try {
    compositionWindowIssues = collectCompositionWindowIssues(
      document,
      references.compositionDurations,
    );
  } catch (error) {
    throwIfFatalTimelineError(error);
  }
  if (compositionWindowIssues.length > 0) {
    throw validationError(
      compositionWindowIssues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  if (
    references.themeExists === undefined
      ? getVisualTheme(document.visualTheme.id, document.visualTheme.version) === undefined
      : !references.themeExists(document.visualTheme.id, document.visualTheme.version)
  ) {
    throw validationError([
      {
        path: ["visualTheme"],
        code: "invalid_value",
        message: `Visual Themeが見つかりません: ${document.visualTheme.id}@${document.visualTheme.version}`,
      },
    ]);
  }

  assertAssetsAvailable(collectAssetReferences(document), references.assetById);
  assertTakeDurations(document, references.assetById);
  assertInsertScenes(document, references.assetById);
  assertVideoPlayback(document, references.assetById);
  assertFaceSetReferences(document, references.faceSetById, references.assetById);

  let offsetWarnings: Warning[] = [];
  try {
    offsetWarnings = collectOffsetRangeWarnings(document);
  } catch (error) {
    throwIfFatalTimelineError(error);
  }
  return [...computeContentWarnings(document), ...offsetWarnings];
}

export function applyAndValidateScriptOperations(
  content: ContentDocument,
  operations: readonly ScriptOperation[],
  scriptContext: ScriptContext,
  references: ScriptValidationReferences,
): ValidatedScriptEditResult {
  const result = applyScriptOperations(content, operations, scriptContext);
  const warnings = validateEditedScriptContent(result.document, references);
  const derivedCodes = new Set([
    OFFSET_RANGE_CLAMPED_CODE,
    OFFSET_RANGE_OUT_OF_SCENE_CODE,
  ]);
  return {
    ...result,
    warnings: mergeWarnings(
      warnings,
      result.warnings.filter((warning) => !derivedCodes.has(warning.code)),
    ),
  };
}
