import {
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  getVisualTheme,
  toVisualThemeDefinitionV2,
  visualThemeDefinitionSchema,
  visualThemeDefinitions,
  type ThemeDetail,
  type ThemeRevision as ThemeRevisionDto,
  type ThemeSummary,
  type VisualThemeDefinition,
  type VisualThemeDefinitionV2,
  type VisualThemeRef,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { ApiError } from "../http/errors.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import { logger } from "../logger.ts";
import type { FontCatalogService } from "./font-catalog.ts";
import { ThemeResolver } from "./theme-resolver.ts";

export class ThemeService {
  private resolver: ThemeResolver;

  constructor(
    private prisma: PrismaClient,
    private fontCatalogService: FontCatalogService,
  ) {
    this.resolver = new ThemeResolver(prisma);
  }

  async listThemes(includeArchived = false): Promise<ThemeSummary[]> {
    const builtIns: ThemeSummary[] = await Promise.all(
      visualThemeDefinitions.map(async (def) => {
        const diagnostics = await this.fontCatalogService.diagnoseTheme(def);
        return {
          id: def.id,
          isBuiltIn: true,
          name: def.name ?? def.id,
          archivedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          latestRevision: {
            id: `builtin-${def.id}-v${def.version}`,
            themeId: def.id,
            version: def.version,
            definition: def,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          hasDraft: false,
          missingFonts: diagnostics.missingFonts,
        };
      }),
    );

    const userThemes = await this.prisma.theme.findMany({
      where: includeArchived ? undefined : { archivedAt: null },
      include: {
        draft: true,
        revisions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const userSummaries: ThemeSummary[] = await Promise.all(
      userThemes.map(async (row) => {
        const latestRevRow = row.revisions[0];
        let latestRevision: ThemeRevisionDto | null = null;
        let missingFonts: string[] = [];

        if (latestRevRow) {
          try {
            const def = visualThemeDefinitionSchema.parse(JSON.parse(latestRevRow.definitionJson));
            latestRevision = {
              id: latestRevRow.id,
              themeId: latestRevRow.themeId,
              version: latestRevRow.versionNumber,
              definition: def,
              createdAt: latestRevRow.createdAt.toISOString(),
            };
            const diag = await this.fontCatalogService.diagnoseTheme(def);
            missingFonts = diag.missingFonts;
          } catch {
            // ignore corrupted definition
          }
        } else if (row.draft) {
          try {
            const def = visualThemeDefinitionSchema.parse(JSON.parse(row.draft.definitionJson));
            const diag = await this.fontCatalogService.diagnoseTheme(def);
            missingFonts = diag.missingFonts;
          } catch {
            // ignore
          }
        }

        return {
          id: row.id,
          isBuiltIn: false,
          name: row.name,
          archivedAt: row.archivedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          latestRevision,
          hasDraft: row.draft !== null,
          missingFonts,
        };
      }),
    );

    return [...builtIns, ...userSummaries];
  }

  async getTheme(id: string): Promise<ThemeDetail> {
    const builtInDefs = visualThemeDefinitions.filter((def) => def.id === id);
    if (builtInDefs.length > 0) {
      const latestDef = builtInDefs.reduce((max, curr) => (curr.version > max.version ? curr : max));
      const diagnostics = await this.fontCatalogService.diagnoseTheme(latestDef);
      const revisions: ThemeRevisionDto[] = builtInDefs.map((def) => ({
        id: `builtin-${def.id}-v${def.version}`,
        themeId: def.id,
        version: def.version,
        definition: def,
        createdAt: "2026-01-01T00:00:00.000Z",
      }));

      return {
        id: latestDef.id,
        isBuiltIn: true,
        name: latestDef.name ?? latestDef.id,
        archivedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        latestRevision: revisions[revisions.length - 1] ?? null,
        hasDraft: false,
        missingFonts: diagnostics.missingFonts,
        revisions,
        draft: null,
      };
    }

    const row = await this.prisma.theme.findUnique({
      where: { id },
      include: {
        draft: true,
        revisions: { orderBy: { versionNumber: "asc" } },
      },
    });

    if (!row) {
      throw resourceNotFound("theme", id);
    }

    const revisions: ThemeRevisionDto[] = row.revisions
      .map((rev) => {
        try {
          const def = visualThemeDefinitionSchema.parse(JSON.parse(rev.definitionJson));
          return {
            id: rev.id,
            themeId: rev.themeId,
            version: rev.versionNumber,
            definition: def,
            createdAt: rev.createdAt.toISOString(),
          };
        } catch {
          return null;
        }
      })
      .filter((rev): rev is ThemeRevisionDto => rev !== null);

    const latestRevision = revisions.length > 0 ? revisions[revisions.length - 1]! : null;

    let draft: ThemeDetail["draft"] = null;
    let missingFonts: string[] = [];

    if (row.draft) {
      try {
        const def = visualThemeDefinitionSchema.parse(JSON.parse(row.draft.definitionJson));
        draft = {
          id: row.draft.id,
          themeId: row.draft.themeId,
          definition: def,
          updatedAt: row.draft.updatedAt.toISOString(),
        };
        const diag = await this.fontCatalogService.diagnoseTheme(def);
        missingFonts = diag.missingFonts;
      } catch {
        // ignore
      }
    } else if (latestRevision) {
      const diag = await this.fontCatalogService.diagnoseTheme(latestRevision.definition);
      missingFonts = diag.missingFonts;
    }

    return {
      id: row.id,
      isBuiltIn: false,
      name: row.name,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      latestRevision,
      hasDraft: draft !== null,
      missingFonts,
      revisions,
      draft,
    };
  }

  async resolveFontDiagnostics(definition: VisualThemeDefinition): Promise<string[]> {
    try {
      const { diagnostics } = await this.fontCatalogService.diagnoseTheme(definition, {
        verify: true,
      });
      return diagnostics;
    } catch (error) {
      logger.warn("theme_font_diagnostics_failed", {
        themeId: definition.id,
        version: definition.version,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async createTheme(input: { name: string; sourceThemeRef?: VisualThemeRef }): Promise<ThemeDetail> {
    const { name, sourceThemeRef } = input;
    let baseDefinition: VisualThemeDefinition | undefined;

    if (sourceThemeRef) {
      baseDefinition = await this.resolver.resolve(sourceThemeRef.id, sourceThemeRef.version);
      if (!baseDefinition) {
        throw validationError([
          {
            path: ["sourceThemeRef"],
            code: "invalid_value",
            message: `複製元のテーマが見つかりません: ${sourceThemeRef.id}@${sourceThemeRef.version}`,
          },
        ]);
      }
    } else {
      baseDefinition = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const theme = await tx.theme.create({
        data: { name },
      });

      const initialDefinition: VisualThemeDefinitionV2 = {
        ...toVisualThemeDefinitionV2(baseDefinition),
        id: theme.id,
        name,
        version: 1,
      };

      const draft = await tx.themeDraft.create({
        data: {
          themeId: theme.id,
          definitionJson: JSON.stringify(initialDefinition),
        },
      });

      return { theme, draft, initialDefinition };
    });

    return this.getTheme(created.theme.id);
  }

  async updateThemeDraft(themeId: string, definition: VisualThemeDefinition): Promise<ThemeDetail> {
    const theme = await this.prisma.theme.findUnique({ where: { id: themeId } });
    if (!theme || theme.archivedAt !== null) {
      throw resourceNotFound("theme", themeId);
    }

    const updatedDefinition: VisualThemeDefinitionV2 = {
      ...toVisualThemeDefinitionV2(definition),
      id: themeId,
      name: theme.name,
    };

    const definitionJson = JSON.stringify(updatedDefinition);

    await this.prisma.themeDraft.upsert({
      where: { themeId },
      create: {
        themeId,
        definitionJson,
      },
      update: {
        definitionJson,
      },
    });

    await this.prisma.theme.update({
      where: { id: themeId },
      data: { updatedAt: new Date() },
    });

    return this.getTheme(themeId);
  }

  async discardThemeDraft(themeId: string): Promise<ThemeDetail> {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
      include: {
        draft: true,
        revisions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
    });

    if (!theme || theme.archivedAt !== null) {
      throw resourceNotFound("theme", themeId);
    }

    if (!theme.draft) {
      return this.getTheme(themeId);
    }

    const latestRevision = theme.revisions[0];
    if (latestRevision) {
      // If a published revision exists, delete draft
      await this.prisma.themeDraft.delete({ where: { themeId } });
    } else {
      // Reset draft definition back to base default
      const defaultDef = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
      const resetDef: VisualThemeDefinitionV2 = {
        ...toVisualThemeDefinitionV2(defaultDef),
        id: themeId,
        name: theme.name,
        version: 1,
      };
      await this.prisma.themeDraft.update({
        where: { themeId },
        data: { definitionJson: JSON.stringify(resetDef) },
      });
    }

    return this.getTheme(themeId);
  }

  async publishThemeDraft(themeId: string): Promise<ThemeDetail> {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
      include: { draft: true },
    });

    if (!theme || theme.archivedAt !== null) {
      throw resourceNotFound("theme", themeId);
    }

    if (!theme.draft) {
      throw new ApiError(400, "INVALID_STATE", "編集中のDraftが存在しません。");
    }

    let rawDefinition: VisualThemeDefinition;
    try {
      rawDefinition = visualThemeDefinitionSchema.parse(JSON.parse(theme.draft.definitionJson));
    } catch {
      throw new ApiError(422, "THEME_DEFINITION_INVALID", "Theme Draftの定義が無効です。");
    }

    await this.prisma.$transaction(async (tx) => {
      const aggregate = await tx.themeRevision.aggregate({
        where: { themeId },
        _max: { versionNumber: true },
      });

      const nextVersion = (aggregate._max.versionNumber ?? 0) + 1;

      const publishedDefinition: VisualThemeDefinitionV2 = {
        ...toVisualThemeDefinitionV2(rawDefinition),
        id: themeId,
        name: theme.name,
        version: nextVersion,
      };

      await tx.themeRevision.create({
        data: {
          themeId,
          versionNumber: nextVersion,
          definitionJson: JSON.stringify(publishedDefinition),
        },
      });

      await tx.themeDraft.delete({ where: { themeId } });

      await tx.theme.update({
        where: { id: themeId },
        data: { updatedAt: new Date() },
      });
    });

    return this.getTheme(themeId);
  }

  async archiveTheme(themeId: string): Promise<ThemeDetail> {
    const isBuiltIn = visualThemeDefinitions.some((def) => def.id === themeId);
    if (isBuiltIn) {
      throw new ApiError(400, "INVALID_OPERATION", "組み込みテーマはアーカイブできません。");
    }

    const theme = await this.prisma.theme.findUnique({ where: { id: themeId } });
    if (!theme) {
      throw resourceNotFound("theme", themeId);
    }

    await this.prisma.theme.update({
      where: { id: themeId },
      data: { archivedAt: new Date() },
    });

    return this.getTheme(themeId);
  }
}
