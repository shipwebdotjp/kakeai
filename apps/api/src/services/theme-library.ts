import {
  getVisualTheme,
  latestVisualThemeDefinitions,
  visualThemeDefinitionSchema,
  type AgentThemeDetail,
  type AgentThemeSummary,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { resourceNotFound } from "../http/validation.ts";
import { logger } from "../logger.ts";

type ThemeDb = PrismaClient | Prisma.TransactionClient;

/** The latest Revision of a Theme, shared by the read and selectability paths. */
const latestRevisionSelect = {
  revisions: {
    orderBy: { versionNumber: "desc" as const },
    take: 1,
  },
} as const;

interface SelectableThemeRecord {
  id: string;
  name: string;
  isBuiltIn: boolean;
  version: number;
  definition: VisualThemeDefinition;
}

function latestBuiltInThemes(): SelectableThemeRecord[] {
  return latestVisualThemeDefinitions().map((definition) => ({
    id: definition.id,
    name: definition.name ?? definition.id,
    isBuiltIn: true,
    version: definition.version,
    definition,
  }));
}

function toSummary(record: SelectableThemeRecord): AgentThemeSummary {
  return {
    id: record.id,
    name: record.name,
    isBuiltIn: record.isBuiltIn,
    version: record.version,
  };
}

function parseRevision(
  definitionJson: string,
  themeId: string,
  version: number,
): VisualThemeDefinition | null {
  try {
    return visualThemeDefinitionSchema.parse(JSON.parse(definitionJson));
  } catch (error) {
    // A corrupt revision is not selectable. Log it so the disappearance from
    // theme.list / theme.get is diagnosable rather than silent.
    logger.warn("theme_definition_invalid", {
      themeId,
      version,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function listUserThemes(db: ThemeDb): Promise<SelectableThemeRecord[]> {
  // No pagination yet: the Theme library is expected to stay small. Revisit
  // with a take/skip when agent payloads grow.
  const rows = await db.theme.findMany({
    where: { archivedAt: null },
    include: latestRevisionSelect,
    orderBy: { createdAt: "asc" },
  });

  const records: SelectableThemeRecord[] = [];
  for (const row of rows) {
    const revision = row.revisions[0];
    if (revision === undefined) {
      continue;
    }
    const definition = parseRevision(
      revision.definitionJson,
      row.id,
      revision.versionNumber,
    );
    if (definition === null) {
      continue;
    }
    records.push({
      id: row.id,
      name: row.name,
      isBuiltIn: false,
      version: revision.versionNumber,
      definition,
    });
  }
  return records;
}

async function listSelectableThemeRecords(db: ThemeDb): Promise<SelectableThemeRecord[]> {
  return [...latestBuiltInThemes(), ...(await listUserThemes(db))];
}

/** Used by `theme.list`; only the latest published Revision is exposed. */
export async function listSelectableThemes(
  db: ThemeDb,
): Promise<AgentThemeSummary[]> {
  return (await listSelectableThemeRecords(db)).map(toSummary);
}

function toUserThemeDetail(
  row: { id: string; name: string },
  revision: { versionNumber: number },
  definition: VisualThemeDefinition,
): AgentThemeDetail {
  return {
    id: row.id,
    name: row.name,
    isBuiltIn: false,
    version: revision.versionNumber,
    definition,
  };
}

/**
 * Resolves one selectable Theme by id. Archived, draft-only, non-latest and
 * corrupt revisions return null. Shared by `theme.get` and the save-time
 * selectability check so both use the same rule.
 */
export async function findSelectableTheme(
  db: ThemeDb,
  themeId: string,
): Promise<AgentThemeDetail | null> {
  const builtIn = latestBuiltInThemes().find((entry) => entry.id === themeId);
  if (builtIn !== undefined) {
    return {
      ...toSummary(builtIn),
      definition: builtIn.definition,
    };
  }

  const row = await db.theme.findFirst({
    where: { id: themeId, archivedAt: null },
    include: latestRevisionSelect,
  });
  const revision = row?.revisions[0];
  const definition =
    revision === undefined
      ? null
      : parseRevision(revision.definitionJson, themeId, revision.versionNumber);
  if (row === null || revision === undefined || definition === null) {
    return null;
  }
  return toUserThemeDetail(row, revision, definition);
}

/** Used by `theme.get`. Archived, draft-only and non-latest revisions are absent. */
export async function getSelectableTheme(
  db: ThemeDb,
  themeId: string,
): Promise<AgentThemeDetail> {
  const theme = await findSelectableTheme(db, themeId);
  if (theme === null) {
    throw resourceNotFound("theme", themeId);
  }
  return theme;
}

/**
 * Used when the caller names a Revision. Any stored Revision with a valid
 * definition is readable, including one whose Theme is archived: existing
 * Script Versions may still reference it and the renderer resolves it.
 * Draft-only Themes and unknown Revisions are RESOURCE_NOT_FOUND.
 */
export async function getThemeRevision(
  db: ThemeDb,
  themeId: string,
  version: number,
): Promise<AgentThemeDetail> {
  const builtIn = getVisualTheme(themeId, version);
  if (builtIn !== undefined) {
    return {
      id: builtIn.id,
      name: builtIn.name ?? builtIn.id,
      isBuiltIn: true,
      version: builtIn.version,
      definition: builtIn,
    };
  }

  const row = await db.theme.findUnique({
    where: { id: themeId },
    include: {
      revisions: { where: { versionNumber: version }, take: 1 },
    },
  });
  const revision = row?.revisions[0];
  const definition =
    revision === undefined
      ? null
      : parseRevision(revision.definitionJson, themeId, revision.versionNumber);
  if (row === null || revision === undefined || definition === null) {
    throw resourceNotFound("theme", `${themeId}@${version}`);
  }
  return toUserThemeDetail(row, revision, definition);
}

/**
 * Resolves the Theme a read should use. Without a version this keeps the
 * selectable (latest, unarchived) rule; an explicit version reads that stored
 * Revision, including one of an archived Theme.
 */
export async function getThemeDetail(
  db: ThemeDb,
  themeId: string,
  version?: number,
): Promise<AgentThemeDetail> {
  return version === undefined
    ? getSelectableTheme(db, themeId)
    : getThemeRevision(db, themeId, version);
}

/**
 * Keys of selectable user Theme revisions for the operation core. Built-ins are
 * handled by `document.setVisualTheme` directly. Only ids and version numbers
 * are read here; full definitions are parsed by `theme.get` and the save path,
 * so a corrupt Revision is rejected there with a logged diagnostic.
 */
export async function selectableThemeKeys(db: ThemeDb): Promise<Set<string>> {
  // No pagination yet: the Theme library is expected to stay small. Revisit
  // with a take/skip when agent payloads grow.
  const rows = await db.theme.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      revisions: {
        ...latestRevisionSelect.revisions,
        select: { versionNumber: true },
      },
    },
  });
  const keys = new Set<string>();
  for (const row of rows) {
    const revision = row.revisions[0];
    if (revision !== undefined) {
      keys.add(`${row.id}@${revision.versionNumber}`);
    }
  }
  return keys;
}

/** True when `id@version` is the latest, parseable revision of an unarchived user Theme. */
export async function isSelectableUserTheme(
  db: ThemeDb,
  themeId: string,
  version: number,
): Promise<boolean> {
  const theme = await findSelectableTheme(db, themeId);
  return theme !== null && !theme.isBuiltIn && theme.version === version;
}
