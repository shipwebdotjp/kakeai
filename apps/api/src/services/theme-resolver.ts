import {
  getVisualTheme,
  visualThemeDefinitionSchema,
  visualThemeDefinitions,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";

export class ThemeResolver {
  constructor(private db: PrismaClient) {}

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
