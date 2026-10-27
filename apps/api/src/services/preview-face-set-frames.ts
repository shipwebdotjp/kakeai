import {
  AGENT_PREVIEW_IMAGE_MAX_BYTES,
  NORMAL_EXPRESSION_ID,
  type AgentPreviewFaceSetInput,
  type AgentPreviewFaceSetOutput,
} from "@kakeai/contracts";
import { readFile } from "node:fs/promises";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import type { Rasterizer } from "../media/rasterize.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { resolveAssetContent } from "./assets/content.ts";

/**
 * The base plus up to 50 layers are embedded in one HTML string. Cap the
 * aggregate as well as each image so one preview request cannot pull hundreds
 * of MiB into the API process.
 */
const PREVIEW_TOTAL_MAX_BYTES = 64 * 1024 * 1024;

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function readDataUrl(location: { path: string; mediaType: string }): Promise<string> {
  const bytes = await readFile(location.path);
  return `data:${location.mediaType};base64,${bytes.toString("base64")}`;
}

function assertPreviewBytes(bytes: number, fieldPath: readonly (string | number)[]): void {
  if (bytes > AGENT_PREVIEW_IMAGE_MAX_BYTES) {
    throw validationError([
      {
        path: [...fieldPath],
        code: "invalid_value",
        message: "プレビューする画像が大きすぎます。",
      },
    ]);
  }
}

/**
 * Resolves the layers one expression draws, in render order. A preset that
 * references a layer outside the draft, or no `normal` expression, is an
 * invalid draft and is rejected without touching the DB.
 */
function resolveExpressionLayers(input: AgentPreviewFaceSetInput) {
  const expressionId = input.expressionId ?? NORMAL_EXPRESSION_ID;
  const expression = input.expressions.find((entry) => entry.id === expressionId);
  if (expression === undefined) {
    throw validationError([
      {
        path: ["expressionId"],
        code: "invalid_value",
        message: `表情「${expressionId}」がありません。`,
      },
    ]);
  }
  const layerById = new Map(input.layers.map((layer) => [layer.id, layer]));
  const ids = [
    expression.browLayerId,
    expression.eyeLayerId,
    expression.mouthLayerId,
    ...input.layers
      .filter((layer) => layer.part === "foreground")
      .map((layer) => layer.id),
  ].filter((id): id is string => id !== null);
  return ids.map((id) => {
    const layer = layerById.get(id);
    if (layer === undefined) {
      throw validationError([
        {
          path: ["expressions"],
          code: "invalid_value",
          message: "表情が同じセットにないレイヤーを参照しています。",
        },
      ]);
    }
    return layer;
  });
}

function compositeHtml(baseUrl: string, layerUrls: readonly string[]): string {
  const images = [baseUrl, ...layerUrls]
    .map((url) => `<img src="${escapeHtmlAttribute(url)}" alt="">`)
    .join("");
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    "<style>html,body{margin:0;padding:0}img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}</style>",
    `</head><body>${images}</body></html>`,
  ].join("");
}

/**
 * Composites an unsaved Face Set draft over a base image and returns a PNG.
 * Nothing is written: no Face Set, revision, Job or Artifact. This is the
 * agent's quality check for C9/C10 before a revision is committed.
 */
export async function getFaceSetPreviewFrame(
  prisma: PrismaClient,
  directories: DataDirectories,
  rasterizer: Rasterizer,
  input: AgentPreviewFaceSetInput,
): Promise<AgentPreviewFaceSetOutput> {
  const layers = resolveExpressionLayers(input);
  const assetIds = [
    ...new Set([input.baseAssetId, ...layers.map((layer) => layer.assetId)]),
  ];
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds } },
    select: { id: true, kind: true, widthPx: true, heightPx: true },
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  const base = byId.get(input.baseAssetId);
  if (base === undefined) {
    throw resourceNotFound("asset", input.baseAssetId);
  }
  if (base.kind !== "image") {
    throw validationError([
      {
        path: ["baseAssetId"],
        code: "invalid_type",
        message: "ベース画像には画像素材を選んでください。",
      },
    ]);
  }
  if (base.widthPx === null || base.heightPx === null) {
    throw validationError([
      {
        path: ["baseAssetId"],
        code: "invalid_value",
        message: "ベース画像の寸法を確認できません。",
      },
    ]);
  }

  // Mirror the write path: a non-image or differently sized layer would be
  // rejected by `faceSet.create` / `faceSet.update`. Surfacing the reason here
  // is more useful than a composite that silently omits or letterboxes it.
  layers.forEach((layer, index) => {
    const asset = byId.get(layer.assetId);
    if (asset === undefined) {
      throw resourceNotFound("asset", layer.assetId);
    }
    if (asset.kind !== "image") {
      throw validationError([
        {
          path: ["layers", index, "assetId"],
          code: "invalid_type",
          message: "顔レイヤーには画像素材を選んでください。",
        },
      ]);
    }
    if (
      asset.widthPx === null ||
      asset.heightPx === null ||
      asset.widthPx !== base.widthPx ||
      asset.heightPx !== base.heightPx
    ) {
      throw validationError([
        {
          path: ["layers", index, "assetId"],
          code: "invalid_value",
          message: `顔レイヤーはベース画像（${base.widthPx}×${base.heightPx}）と同じ寸法にしてください。`,
        },
      ]);
    }
  });

  const baseLocation = await resolveAssetContent(
    prisma,
    directories,
    input.baseAssetId,
    true,
  );
  assertPreviewBytes(baseLocation.byteSize, ["baseAssetId"]);
  let totalBytes = baseLocation.byteSize;
  const baseUrl = await readDataUrl(baseLocation);

  const locations = await Promise.all(
    layers.map((layer) => resolveAssetContent(prisma, directories, layer.assetId, true)),
  );
  const layerUrls: string[] = [];
  for (const [index, location] of locations.entries()) {
    assertPreviewBytes(location.byteSize, ["layers", index, "assetId"]);
    totalBytes += location.byteSize;
    if (totalBytes > PREVIEW_TOTAL_MAX_BYTES) {
      throw validationError([
        {
          path: ["layers", index, "assetId"],
          code: "invalid_value",
          message: "プレビューする画像の合計サイズが大きすぎます。",
        },
      ]);
    }
    layerUrls.push(await readDataUrl(location));
  }

  const png = await rasterizer.renderPng(
    compositeHtml(baseUrl, layerUrls),
    base.widthPx,
    base.heightPx,
  );
  assertPreviewBytes(png.byteLength, ["png"]);
  return {
    width: base.widthPx,
    height: base.heightPx,
    mimeType: "image/png",
    pngBase64: png.toString("base64"),
  };
}
