import {
  AUTHORING_CONTEXT_SCHEMA_VERSION,
  AUTHORING_STYLE_DIRECTORY,
  DEFAULT_CANVAS_PROFILE,
  resolveVisualThemeSkin,
  type CanvasProfile,
  type CompositionAuthoringContext,
  type CompositionAuthoredStyleProvenance,
  type CompositionStyleProvenance,
  type VisualThemeRef,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import type { FontCatalogService } from "./font-catalog.ts";
import {
  STYLE_KIT_VERSION,
  buildStyleKitContents,
  compositionAuthoringBriefOf,
  styleKitProvenance,
} from "./style-kit.ts";
import { ThemeResolver } from "./theme-resolver.ts";

export interface ResolvedAuthoringStyle {
  context: CompositionAuthoringContext;
  provenance: CompositionAuthoredStyleProvenance;
  kitFiles: Record<string, string>;
}

export class CompositionAuthoringService {
  constructor(
    private deps: {
      db: PrismaClient;
      fontCatalogService: FontCatalogService;
    },
  ) {}

  async resolve(input: {
    visualTheme: VisualThemeRef;
    canvasProfile?: CanvasProfile;
  }): Promise<ResolvedAuthoringStyle> {
    const canvasProfile = input.canvasProfile ?? DEFAULT_CANVAS_PROFILE;
    const resolver = new ThemeResolver(this.deps.db);
    const theme = await resolver.resolve(input.visualTheme.id, input.visualTheme.version);
    if (theme === undefined) {
      throw new ApiError(422, "VALIDATION_ERROR", undefined, {
        issues: [
          {
            path: ["visualTheme"],
            code: "unknown_theme",
            message: `公開済みのVisual Themeが見つかりません: ${input.visualTheme.id}@${input.visualTheme.version}`,
          },
        ],
      });
    }

    const skin = resolveVisualThemeSkin(theme);
    const fontResolution = await this.deps.fontCatalogService.resolveThemeFonts(theme, {
      verify: true,
    });
    const contents = buildStyleKitContents({ skin, theme, fontResolution });
    const provenance = styleKitProvenance({ skin, theme, canvasProfile, contents });

    const context: CompositionAuthoringContext = {
      contextSchemaVersion: AUTHORING_CONTEXT_SCHEMA_VERSION,
      theme: provenance.theme,
      skin,
      kit: { version: STYLE_KIT_VERSION, hash: contents.kitHash },
      canvasProfile,
      brief: compositionAuthoringBriefOf(skin),
      fontDiagnostics: contents.fontDiagnostics,
      seed: { styleDirectory: `${AUTHORING_STYLE_DIRECTORY}/` },
    };

    return { context, provenance, kitFiles: contents.files };
  }

  async diagnoseStyleFonts(
    provenance: CompositionStyleProvenance | undefined,
  ): Promise<string[]> {
    if (provenance === undefined || provenance.kind !== "authored") {
      return [];
    }
    const resolver = new ThemeResolver(this.deps.db);
    const theme = await resolver.resolve(
      provenance.theme.ref.id,
      provenance.theme.ref.version,
    );
    if (theme === undefined) {
      return [
        `作者Theme ${provenance.theme.ref.id}@${provenance.theme.ref.version} を解決できないためFont診断を省略しました`,
      ];
    }
    const resolution = await this.deps.fontCatalogService.resolveThemeFonts(theme, {
      verify: true,
    });
    return resolution.diagnostics;
  }
}
