import { CONTENT_SCHEMA_VERSION } from "./document";
import { DEFAULT_SCENE_LABELS, defaultPointLabel } from "./defaults";
import { sceneAccentSchema } from "./scene";
import { DEFAULT_VISUAL_THEME_REF } from "./theme";

const V4_SCHEMA_VERSION = 4;
const V5_SCHEMA_VERSION = 5;
const V6_SCHEMA_VERSION = 6;

function defaultLabel(kind: unknown, pointOrdinal: number): string | null {
  switch (kind) {
    case "intro":
      return DEFAULT_SCENE_LABELS.intro;
    case "outro":
      return DEFAULT_SCENE_LABELS.outro;
    case "point":
      return defaultPointLabel(pointOrdinal);
    default:
      return null;
  }
}

function migrateSceneLabels(scenes: unknown): unknown {
  if (!Array.isArray(scenes)) {
    return scenes;
  }
  let pointOrdinal = 0;
  return scenes.map((scene) => {
    if (typeof scene !== "object" || scene === null) {
      return scene;
    }
    const record = scene as Record<string, unknown>;
    if (record.kind === "point") {
      pointOrdinal += 1;
    }
    if (typeof record.label === "string" && record.label.trim().length > 0) {
      return scene;
    }
    const label = defaultLabel(record.kind, pointOrdinal);
    return label === null ? scene : { ...record, label };
  });
}

function migrateSceneAccents(scenes: unknown): unknown {
  if (!Array.isArray(scenes)) {
    return scenes;
  }
  return scenes.map((scene) => {
    if (typeof scene !== "object" || scene === null) {
      return scene;
    }
    const record = scene as Record<string, unknown>;
    const { accentColor, accent, ...rest } = record;
    void accentColor;
    if (accent !== undefined && sceneAccentSchema.safeParse(accent).success) {
      return { ...rest, accent };
    }
    return { ...rest, accent: { kind: "theme", token: "primary" } };
  });
}

function migrateV4ToV5(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...record,
    schemaVersion: V5_SCHEMA_VERSION,
    scenes: migrateSceneLabels(record.scenes),
  };
}

function migrateV5ToV6(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...record,
    schemaVersion: CONTENT_SCHEMA_VERSION,
    visualTheme: { ...DEFAULT_VISUAL_THEME_REF },
    scenes: migrateSceneAccents(record.scenes),
  };
}

function migrateAppearanceFaceSets(characters: unknown): unknown {
  if (!Array.isArray(characters)) {
    return characters;
  }
  return characters.map((character) => {
    if (typeof character !== "object" || character === null) {
      return character;
    }
    const record = character as Record<string, unknown>;
    if (!Array.isArray(record.appearances)) {
      return character;
    }
    return {
      ...record,
      appearances: (record.appearances as unknown[]).map((appearance) => {
        if (typeof appearance !== "object" || appearance === null) {
          return appearance;
        }
        const entry = appearance as Record<string, unknown>;
        if (entry.faceSetId !== undefined) {
          return appearance;
        }
        return { ...entry, faceSetId: null };
      }),
    };
  });
}

function migrateLineExpressions(scenes: unknown): unknown {
  if (!Array.isArray(scenes)) {
    return scenes;
  }
  return scenes.map((scene) => {
    if (typeof scene !== "object" || scene === null) {
      return scene;
    }
    const record = scene as Record<string, unknown>;
    if (!Array.isArray(record.lines)) {
      return scene;
    }
    return {
      ...record,
      lines: (record.lines as unknown[]).map((line) => {
        if (typeof line !== "object" || line === null) {
          return line;
        }
        const entry = line as Record<string, unknown>;
        if (entry.expressionId !== undefined) {
          return line;
        }
        return { ...entry, expressionId: null };
      }),
    };
  });
}

function migrateV6ToV7(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...record,
    schemaVersion: CONTENT_SCHEMA_VERSION,
    characters: migrateAppearanceFaceSets(record.characters),
    scenes: migrateLineExpressions(record.scenes),
  };
}

export function migrateContentDocument(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion === V4_SCHEMA_VERSION) {
    return migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(record)));
  }
  if (record.schemaVersion === V5_SCHEMA_VERSION) {
    return migrateV6ToV7(migrateV5ToV6(record));
  }
  if (record.schemaVersion === V6_SCHEMA_VERSION) {
    return migrateV6ToV7(record);
  }
  return input;
}
