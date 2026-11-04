import {
  blinkSchedule,
  mouthSchedule,
  seededRandom,
  type FaceEvent,
} from "@kakeai/video/face-events";

export type PreviewPart = "brow" | "eye" | "mouth" | "foreground";

export interface FaceSetPreviewLayer {
  id: string;
  part: PreviewPart;
  assetId: string | null;
  blinkLayerId: string | null;
  speakingLayerId: string | null;
}

export interface FaceSetPreviewExpression {
  id: string;
  name: string;
  browLayerId: string | null;
  eyeLayerId: string | null;
  mouthLayerId: string | null;
}

const PART_ORDER: PreviewPart[] = ["brow", "eye", "mouth", "foreground"];

/** The base and blinking/speaking layers an expression can actually draw. */
export interface FacePreviewVariantLayers {
  eyeBaseId: string | null;
  eyeVariantId: string | null;
  mouthBaseId: string | null;
  mouthVariantId: string | null;
}

function renderable(
  layersById: ReadonlyMap<string, FaceSetPreviewLayer>,
  id: string | null,
): FaceSetPreviewLayer | undefined {
  if (id === null) {
    return undefined;
  }
  const layer = layersById.get(id);
  return layer !== undefined && layer.assetId !== null ? layer : undefined;
}

/**
 * Resolves the closed-eye and open-mouth layers reachable from the active
 * expression. Variants belong to the eye/mouth layer itself, not to the
 * preset, so a preset that reuses an eye layer inherits its blink target.
 */
export function resolveFacePreviewVariants(
  expression: FaceSetPreviewExpression | undefined,
  layers: readonly FaceSetPreviewLayer[],
): FacePreviewVariantLayers {
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));
  const eye = renderable(
    layersById,
    expression?.eyeLayerId ?? null,
  );
  const mouth = renderable(
    layersById,
    expression?.mouthLayerId ?? null,
  );
  const variantId = (
    base: FaceSetPreviewLayer | undefined,
    part: "blinkLayerId" | "speakingLayerId",
  ): string | null => {
    const targetId = base?.[part] ?? null;
    return targetId === null ? null : (renderable(layersById, targetId)?.id ?? null);
  };
  return {
    eyeBaseId: eye?.id ?? null,
    eyeVariantId: variantId(eye, "blinkLayerId"),
    mouthBaseId: mouth?.id ?? null,
    mouthVariantId: variantId(mouth, "speakingLayerId"),
  };
}

export interface FacePreviewStackItem {
  key: string;
  layerId: string;
  role: "base" | "variant";
  variant: "eye" | "mouth" | null;
}

/**
 * The image order of one preview frame. Variants sit next to their base layer
 * so the foreground stays above the face, and opacity chooses which one shows.
 */
export function buildFacePreviewStack(
  expression: FaceSetPreviewExpression | undefined,
  layers: readonly FaceSetPreviewLayer[],
): FacePreviewStackItem[] {
  const ordered = [...layers].sort(
    (left, right) =>
      PART_ORDER.indexOf(left.part) - PART_ORDER.indexOf(right.part),
  );
  const layersById = new Map(ordered.map((layer) => [layer.id, layer]));
  const variants = resolveFacePreviewVariants(expression, ordered);
  const item = (
    layerId: string,
    role: FacePreviewStackItem["role"],
    variant: FacePreviewStackItem["variant"],
  ): FacePreviewStackItem => ({
    key: `${role}-${variant ?? "plain"}-${layerId}`,
    layerId,
    role,
    variant,
  });
  const stack: FacePreviewStackItem[] = [];
  const brow = renderable(layersById, expression?.browLayerId ?? null);
  if (brow !== undefined) {
    stack.push(item(brow.id, "base", null));
  }
  if (variants.eyeBaseId !== null) {
    stack.push(
      item(
        variants.eyeBaseId,
        "base",
        variants.eyeVariantId !== null ? "eye" : null,
      ),
    );
  }
  if (variants.eyeVariantId !== null) {
    stack.push(item(variants.eyeVariantId, "variant", "eye"));
  }
  if (variants.mouthBaseId !== null) {
    stack.push(
      item(
        variants.mouthBaseId,
        "base",
        variants.mouthVariantId !== null ? "mouth" : null,
      ),
    );
  }
  if (variants.mouthVariantId !== null) {
    stack.push(item(variants.mouthVariantId, "variant", "mouth"));
  }
  for (const layer of ordered) {
    if (layer.part === "foreground" && layer.assetId !== null) {
      stack.push(item(layer.id, "base", null));
    }
  }
  return stack;
}

const PREVIEW_LOOP_MS = 30_000;
const SPEAKING_WINDOW_MS = 2_500;
const SPEAKING_REST_MS = 1_500;

export interface FacePreviewSchedule {
  loopMs: number;
  blinks: readonly FaceEvent[];
  mouths: readonly FaceEvent[];
}

/**
 * Preview-only loop that alternates short speaking windows with pauses. It
 * reuses the renderer's blink/mouth distributions with a fixed seed so the
 * thumbnails behave like an idle standing character.
 */
export function buildFacePreviewSchedule(): FacePreviewSchedule {
  const windows: FaceEvent[] = [];
  for (
    let start = 0;
    start + SPEAKING_WINDOW_MS <= PREVIEW_LOOP_MS;
    start += SPEAKING_WINDOW_MS + SPEAKING_REST_MS
  ) {
    windows.push({ startMs: start, endMs: start + SPEAKING_WINDOW_MS });
  }
  return {
    loopMs: PREVIEW_LOOP_MS,
    blinks: blinkSchedule(
      seededRandom("face-set-preview|blink"),
      0,
      PREVIEW_LOOP_MS,
    ),
    mouths: mouthSchedule(
      seededRandom("face-set-preview|mouth"),
      windows,
    ),
  };
}

export interface FacePreviewMotion {
  eyesClosed: boolean;
  mouthOpen: boolean;
}

export const FACE_PREVIEW_STILL: FacePreviewMotion = {
  eyesClosed: false,
  mouthOpen: false,
};

function activeAt(events: readonly FaceEvent[], timeMs: number): boolean {
  return events.some(
    (event) => timeMs >= event.startMs && timeMs < event.endMs,
  );
}

export function facePreviewMotionAt(
  schedule: FacePreviewSchedule,
  elapsedMs: number,
): FacePreviewMotion {
  const timeMs =
    ((elapsedMs % schedule.loopMs) + schedule.loopMs) % schedule.loopMs;
  return {
    eyesClosed: activeAt(schedule.blinks, timeMs),
    mouthOpen: activeAt(schedule.mouths, timeMs),
  };
}

export function isMotionVisible(
  item: FacePreviewStackItem,
  motion: FacePreviewMotion,
): boolean {
  if (item.variant === null) {
    return true;
  }
  const variantActive =
    item.variant === "eye" ? motion.eyesClosed : motion.mouthOpen;
  return item.role === "variant" ? variantActive : !variantActive;
}
