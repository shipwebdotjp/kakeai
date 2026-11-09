import type {
  ImportLiveMaterialRequest,
  LiveMaterialFormat,
} from "@kakeai/contracts";

export const DEFAULT_MATERIAL_DURATION_SECONDS = 4;
export const MAX_MATERIAL_DURATION_SECONDS = 30;

export const MATERIAL_FORMAT_OPTIONS: ReadonlyArray<{
  value: LiveMaterialFormat;
  label: string;
}> = [
  { value: "png", label: "PNG（静止画）" },
  { value: "html", label: "HTML（静止カード）" },
  { value: "mp4", label: "MP4（短い動画）" },
];

export function materialDurationMs(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_MATERIAL_DURATION_SECONDS) {
    return null;
  }
  return Math.round(seconds * 1000);
}

export function isMaterialDurationValid(
  format: LiveMaterialFormat,
  seconds: number,
): boolean {
  return format !== "mp4" || materialDurationMs(seconds) !== null;
}

export interface MaterialImportFormInput {
  workId: string;
  sceneId: string;
  name?: string;
  format: LiveMaterialFormat;
  durationSeconds: number;
}

/**
 * Shapes the import dialog fields into the API request. MP4 uses the entered
 * duration; PNG/HTML always store the 4000ms static-card duration.
 */
export function buildMaterialImportInput(
  input: MaterialImportFormInput,
): Omit<ImportLiveMaterialRequest, "expectedRevision"> {
  const name = input.name?.trim() ?? "";
  const requestedDuration =
    input.format === "mp4" ? materialDurationMs(input.durationSeconds) : 4000;
  if (requestedDuration === null) {
    throw new Error("MP4 素材の表示時間が不正です。");
  }
  return {
    workId: input.workId,
    sceneId: input.sceneId,
    ...(name === "" ? {} : { name }),
    format: input.format,
    durationMs: requestedDuration,
  };
}
