import type { ContentDocument, ScriptOperation } from "@kakeai/contracts";
import {
  applyScriptOperation,
  createIdGenerator,
  type ScriptAssetInfo,
  type ScriptContext,
  type ScriptOperationResult,
} from "@kakeai/script-edits";
import {
  buildContentDocument,
  toFormValues,
  type DocumentFormValues,
} from "./form";

export interface StructuralAsset {
  id: string;
  kind: "image" | "video" | "audio";
  status: "processing" | "ready" | "failed";
  durationMs: number | null;
  hasAudio: boolean;
}

export interface StructuralEditResult {
  values: DocumentFormValues;
  document: ContentDocument;
  result: ScriptOperationResult;
}

export function applyStructuralOperation(
  base: ContentDocument,
  values: DocumentFormValues,
  operation: ScriptOperation,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult {
  const document = buildContentDocument(base, values);
  const assetById = new Map<string, ScriptAssetInfo>(
    assets.map((asset) => [
      asset.id,
      {
        kind: asset.kind,
        status: asset.status,
        durationMs: asset.durationMs,
        hasAudio: asset.hasAudio,
      },
    ]),
  );
  const context: ScriptContext = {
    assets: { get: (assetId) => assetById.get(assetId) ?? null },
    ids: createIdGenerator(),
  };
  const result = applyScriptOperation(document, operation, context);
  return {
    values: toFormValues(result.document),
    document: result.document,
    result,
  };
}
