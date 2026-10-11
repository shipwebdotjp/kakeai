import { CONTENT_SCHEMA_VERSION } from "./document";
import { DEFAULT_SCENE_LABELS, defaultPointLabel } from "./defaults";

const V4_SCHEMA_VERSION = 4;

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

function migrateScenes(scenes: unknown): unknown {
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

export function migrateContentDocument(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return input;
  }
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== V4_SCHEMA_VERSION) {
    return input;
  }
  return {
    ...record,
    schemaVersion: CONTENT_SCHEMA_VERSION,
    scenes: migrateScenes(record.scenes),
  };
}
