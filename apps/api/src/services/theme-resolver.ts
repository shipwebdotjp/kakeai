import {
  getVisualTheme,
  isLatestVisualThemeDefinition,
  visualThemeDefinitionSchema,
  visualThemeDefinitions,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { findSelectableTheme } from "./theme-library.ts";

export class ThemeResolver {
  constructor(private db: PrismaClient | Prisma.TransactionClient) {}

  async resolve(id: string, version: number): Promise<VisualThemeDefinition | undefined> {
    const builtIn = getVisualTheme(id, version);
    if (builtIn) {
      return builtIn;
    }
    const revision = await this.db.themeRevision.findUnique({
      where: {
        themeId_versionNumber: {
          themeId: id,
          versionNumber: version,
        },
      },
    });
    if (!revision) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(revision.definitionJson);
      return visualThemeDefinitionSchema.parse(parsed);
    } catch {
      return undefined;
    }
  }

  /**
   * Resolves `id@version` only when it is selectable for a new Script Version:
   * a built-in at its latest version, or the latest revision of an unarchived
   * user Theme. Returns undefined for an archived, non-latest, corrupt or
   * missing revision. `resolve` remains the unrestricted lookup for old
   * versions and renders.
   */
  async resolveSelectable(
    id: string,
    version: number,
  ): Promise<VisualThemeDefinition | undefined> {
    if (isLatestVisualThemeDefinition(id, version)) {
      return getVisualTheme(id, version);
    }
    const theme = await findSelectableTheme(this.db, id);
    return theme !== null && !theme.isBuiltIn && theme.version === version
      ? theme.definition
      : undefined;
  }

  async listPublishedThemes(): Promise<VisualThemeDefinition[]> {
    const builtIns = [...visualThemeDefinitions];
    const userThemes = await this.db.theme.findMany({
      where: { archivedAt: null },
      include: {
        revisions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
    });

    const userDefinitions: VisualThemeDefinition[] = [];
    for (const ut of userThemes) {
      const latestRev = ut.revisions[0];
      if (latestRev) {
        try {
          const parsed = JSON.parse(latestRev.definitionJson);
          userDefinitions.push(visualThemeDefinitionSchema.parse(parsed));
        } catch {
          // ignore corrupted
        }
      }
    }
    return [...builtIns, ...userDefinitions];
  }
}
