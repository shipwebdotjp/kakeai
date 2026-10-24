import {
  applyThumbnailAppearance,
  getThumbnailTemplate,
  mergeThumbnailAppearance,
  resolveThumbnailAppearanceDefaults,
  thumbnailAppearanceOverrideOf,
  type ThumbnailAppearance,
  type ThumbnailCutoutHeroInput,
  type ThumbnailDocument,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { THUMBNAIL_OUTPUT_HEIGHT, THUMBNAIL_OUTPUT_WIDTH } from "../meta";
import type { AssetResolver } from "../resolver";
import { renderCutoutHero, type RenderedThumbnail, type ThumbnailRenderContext } from "./render";

export interface CompileThumbnailOptions {
  document: ThumbnailDocument;
  theme: VisualThemeDefinition;
  assetResolver: AssetResolver;
  /** Saved language-edition appearance. Candidate overrides live in the document. */
  appearance?: ThumbnailAppearance | null;
}

export interface CompiledThumbnail {
  html: string;
  assetIds: string[];
  width: number;
  height: number;
}

const THUMBNAIL_STYLES = [
  "*{box-sizing:border-box}",
  "html,body{margin:0;padding:0}",
  `body{width:${THUMBNAIL_OUTPUT_WIDTH}px;height:${THUMBNAIL_OUTPUT_HEIGHT}px;overflow:hidden}`,
].join("");

function dispatch(
  key: string,
  input: unknown,
  context: ThumbnailRenderContext,
): RenderedThumbnail {
  switch (key) {
    case "thumbnail.cutout-hero@1":
      return renderCutoutHero(input as ThumbnailCutoutHeroInput, context);
    default:
      throw new CompositionCompileError([
        {
          path: ["template"],
          code: "unknown_template",
          message: `未対応のサムネイルテンプレートです: ${key}`,
        },
      ]);
  }
}

function assemble(inner: string): string {
  return [
    "<!doctype html>",
    `<html lang="ja">`,
    "<head>",
    `<meta charset="UTF-8">`,
    `<meta name="viewport" content="width=${THUMBNAIL_OUTPUT_WIDTH}, height=${THUMBNAIL_OUTPUT_HEIGHT}">`,
    `<title>サムネイル</title>`,
    `<style>${THUMBNAIL_STYLES}</style>`,
    "</head>",
    "<body>",
    `<div id="kakeai-thumbnail-root" data-thumbnail-width="${THUMBNAIL_OUTPUT_WIDTH}" data-thumbnail-height="${THUMBNAIL_OUTPUT_HEIGHT}" style="position:relative;width:${THUMBNAIL_OUTPUT_WIDTH}px;height:${THUMBNAIL_OUTPUT_HEIGHT}px;overflow:hidden">`,
    inner,
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}

export function compileThumbnail(options: CompileThumbnailOptions): CompiledThumbnail {
  const { document, theme, assetResolver } = options;
  const { id, version } = document.template;
  const definition = getThumbnailTemplate(id, version);
  if (definition === undefined) {
    throw new CompositionCompileError([
      {
        path: ["template"],
        code: "unknown_template",
        message: `未対応のサムネイルテンプレートです: ${id}@${version}`,
      },
    ]);
  }
  const parsed = definition.inputSchema.safeParse(document.input);
  if (!parsed.success) {
    throw new CompositionCompileError(
      parsed.error.issues.map((issue) => ({
        path: [
          "input",
          ...issue.path.map((segment) => (typeof segment === "symbol" ? segment.toString() : segment)),
        ],
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  const merged = mergeThumbnailAppearance(
    options.appearance ?? null,
    thumbnailAppearanceOverrideOf(document),
  );
  const appearance = applyThumbnailAppearance(
    resolveThumbnailAppearanceDefaults(theme),
    merged,
  );
  const rendered = dispatch(`${id}@${version}`, parsed.data, {
    theme,
    assetResolver,
    path: ["input"],
    appearance,
    accentOverridden: merged?.accent !== undefined,
  });
  return {
    html: assemble(rendered.html),
    assetIds: rendered.assetIds,
    width: THUMBNAIL_OUTPUT_WIDTH,
    height: THUMBNAIL_OUTPUT_HEIGHT,
  };
}
