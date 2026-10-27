import {
  agentPreviewAssetFrameInputSchema,
  agentPreviewAssetFrameOutputSchema,
  agentPreviewFaceSetInputSchema,
  agentPreviewFaceSetOutputSchema,
  agentPreviewFrameInputSchema,
  agentPreviewFrameOutputSchema,
  agentPreviewScriptFrameInputSchema,
  agentPreviewScriptFrameOutputSchema,
  agentPreviewThemeInputSchema,
  agentPreviewThemeOutputSchema,
  agentPreviewThumbnailInputSchema,
  agentPreviewThumbnailOutputSchema,
  agentThumbnailImageInputSchema,
  agentThumbnailImageOutputSchema,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { getAssetFrame } from "../services/preview-asset-frames.ts";
import { getFaceSetPreviewFrame } from "../services/preview-face-set-frames.ts";
import { getPreviewFrame } from "../services/preview-frames.ts";
import { getScriptVersionFrame } from "../services/preview-script-frames.ts";
import { getThemePreviewFrame } from "../services/preview-theme-frames.ts";
import {
  generateThumbnailImage,
  renderThumbnailPreviewImage,
} from "../services/thumbnails.ts";
import { asWorkResource } from "./errors.ts";
import type { AgentOperationFragment } from "./operations.ts";

/**
 * The app's own loopback origin. The preview rasterizer navigates here once to
 * receive the same-origin media session cookie before loading compiled HTML.
 * Kakeai serves plain HTTP on loopback only; TLS and non-loopback origins are
 * outside the security policy.
 */
export function previewOrigin(config: AppConfig): string {
  const host =
    config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  const formatted = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${formatted}:${config.port}`;
}

/**
 * The common shape of a rendered PNG. Both thumbnail image operations share it
 * so the MIME type and encoding live in one place.
 */
function pngPayload(image: { width: number; height: number; png: Buffer }) {
  return {
    width: image.width,
    height: image.height,
    mimeType: "image/png" as const,
    pngBase64: image.png.toString("base64"),
  };
}

/**
 * The operations whose output carries image bytes. They are grouped here
 * because the bindings treat them alike: MCP returns an image content block
 * and CLI writes the bytes with `--out`. Every run only rasterizes or reads
 * an existing resource; none creates a Job, Version or Artifact.
 */
export const imageOperationDefinitions = {
  "preview.frame": {
    input: agentPreviewFrameInputSchema,
    output: agentPreviewFrameOutputSchema,
    run: async (input, context) =>
      getPreviewFrame(context.prisma, context.directories, input),
  },
  "preview.scriptFrame": {
    input: agentPreviewScriptFrameInputSchema,
    output: agentPreviewScriptFrameOutputSchema,
    run: async (input, context) =>
      getScriptVersionFrame(
        context.prisma,
        context.directories,
        context.previewRasterizer,
        previewOrigin(context.config),
        input,
      ),
  },
  "preview.assetFrame": {
    input: agentPreviewAssetFrameInputSchema,
    output: agentPreviewAssetFrameOutputSchema,
    run: async (input, context) =>
      getAssetFrame(context.prisma, context.directories, input),
  },
  // Unsaved Theme Draft preview: the definition is supplied by the caller, so
  // no DB row is read or written.
  "preview.theme": {
    input: agentPreviewThemeInputSchema,
    output: agentPreviewThemeOutputSchema,
    run: async (input, context) =>
      getThemePreviewFrame(
        context.previewRasterizer,
        previewOrigin(context.config),
        input,
      ),
  },
  "preview.thumbnail": {
    input: agentPreviewThumbnailInputSchema,
    output: agentPreviewThumbnailOutputSchema,
    run: async (input, context) => {
      const { languageEditionId, ...preview } = input;
      const image = await asWorkResource(
        renderThumbnailPreviewImage(
          context.prisma,
          context.directories,
          context.rasterizer,
          languageEditionId,
          preview,
        ),
      );
      return {
        languageEditionId,
        ...pngPayload(image),
      };
    },
  },
  // Unsaved Face Set draft: the caller supplies the layers and expressions, so
  // no Face Set row is read or written. The result is the agent's quality check
  // for `faceSet.create` / `faceSet.update`.
  "preview.faceSet": {
    input: agentPreviewFaceSetInputSchema,
    output: agentPreviewFaceSetOutputSchema,
    run: async (input, context) =>
      getFaceSetPreviewFrame(
        context.prisma,
        context.directories,
        context.rasterizer,
        input,
      ),
  },
  "thumbnail.image": {
    input: agentThumbnailImageInputSchema,
    output: agentThumbnailImageOutputSchema,
    run: async (input, context) => {
      const image = await generateThumbnailImage(
        context.prisma,
        context.directories,
        context.rasterizer,
        input.thumbnailId,
      );
      return {
        thumbnailId: input.thumbnailId,
        filename: image.filename,
        ...pngPayload(image),
      };
    },
  },
} satisfies AgentOperationFragment;
