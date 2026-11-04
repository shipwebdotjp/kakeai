import { describe, expect, it } from "vitest";
import {
  buildFacePreviewStack,
  facePreviewMotionAt,
  isMotionVisible,
  resolveFacePreviewVariants,
  type FacePreviewSchedule,
  type FaceSetPreviewLayer,
} from "./facePreviewAnimation";

function layer(
  id: string,
  part: FaceSetPreviewLayer["part"],
  overrides: Partial<FaceSetPreviewLayer> = {},
): FaceSetPreviewLayer {
  return {
    id,
    part,
    assetId: `asset-${id}`,
    blinkLayerId: null,
    speakingLayerId: null,
    ...overrides,
  };
}

describe("resolveFacePreviewVariants", () => {
  it("follows the eye and mouth variants of the active expression", () => {
    const layers = [
      layer("eye", "eye", { blinkLayerId: "eye-closed" }),
      layer("eye-closed", "eye"),
      layer("mouth", "mouth", { speakingLayerId: "mouth-open" }),
      layer("mouth-open", "mouth"),
    ];
    expect(
      resolveFacePreviewVariants(
        {
          id: "happy",
          name: "笑い",
          browLayerId: null,
          eyeLayerId: "eye",
          mouthLayerId: "mouth",
        },
        layers,
      ),
    ).toEqual({
      eyeBaseId: "eye",
      eyeVariantId: "eye-closed",
      mouthBaseId: "mouth",
      mouthVariantId: "mouth-open",
    });
  });

  it("ignores variants that cannot be drawn", () => {
    const layers = [
      layer("eye", "eye", { blinkLayerId: "eye-closed" }),
      layer("eye-closed", "eye", { assetId: null }),
      layer("mouth", "mouth", { speakingLayerId: "missing" }),
    ];
    expect(
      resolveFacePreviewVariants(
        {
          id: "normal",
          name: "通常",
          browLayerId: null,
          eyeLayerId: "eye",
          mouthLayerId: "mouth",
        },
        layers,
      ),
    ).toEqual({
      eyeBaseId: "eye",
      eyeVariantId: null,
      mouthBaseId: "mouth",
      mouthVariantId: null,
    });
  });

  it("does not cross expressions to find a variant", () => {
    const layers = [
      layer("eye-normal", "eye"),
      layer("eye-happy", "eye", { blinkLayerId: "eye-closed" }),
      layer("eye-closed", "eye"),
    ];
    expect(
      resolveFacePreviewVariants(
        {
          id: "normal",
          name: "通常",
          browLayerId: null,
          eyeLayerId: "eye-normal",
          mouthLayerId: null,
        },
        layers,
      ).eyeVariantId,
    ).toBeNull();
  });
});

describe("buildFacePreviewStack", () => {
  it("keeps variants next to their part and the foreground above the face", () => {
    const layers = [
      layer("foreground", "foreground"),
      layer("mouth-open", "mouth"),
      layer("mouth", "mouth", { speakingLayerId: "mouth-open" }),
      layer("eye-closed", "eye"),
      layer("eye", "eye", { blinkLayerId: "eye-closed" }),
      layer("brow", "brow"),
      layer("unused-eye", "eye"),
    ];
    expect(
      buildFacePreviewStack(
        {
          id: "normal",
          name: "通常",
          browLayerId: "brow",
          eyeLayerId: "eye",
          mouthLayerId: "mouth",
        },
        layers,
      ).map((item) => `${item.role}:${item.layerId}`),
    ).toEqual([
      "base:brow",
      "base:eye",
      "variant:eye-closed",
      "base:mouth",
      "variant:mouth-open",
      "base:foreground",
    ]);
  });

  it("keeps a part still when only the other part has a variant", () => {
    const layers = [
      layer("eye", "eye", { blinkLayerId: "eye-closed" }),
      layer("eye-closed", "eye"),
      layer("mouth", "mouth"),
    ];
    const stack = buildFacePreviewStack(
      {
        id: "normal",
        name: "通常",
        browLayerId: null,
        eyeLayerId: "eye",
        mouthLayerId: "mouth",
      },
      layers,
    );
    const mouth = stack.find((item) => item.layerId === "mouth");
    expect(mouth?.variant).toBeNull();
    expect(
      isMotionVisible(mouth!, { eyesClosed: false, mouthOpen: true }),
    ).toBe(true);
  });
});

describe("isMotionVisible", () => {
  const still = { eyesClosed: false, mouthOpen: false };
  const closed = { eyesClosed: true, mouthOpen: true };

  it("swaps the base and variant for the active motion", () => {
    expect(
      isMotionVisible({ key: "a", layerId: "eye", role: "base", variant: "eye" }, closed),
    ).toBe(false);
    expect(
      isMotionVisible(
        { key: "b", layerId: "eye-closed", role: "variant", variant: "eye" },
        closed,
      ),
    ).toBe(true);
    expect(
      isMotionVisible({ key: "c", layerId: "eye", role: "base", variant: "eye" }, still),
    ).toBe(true);
    expect(
      isMotionVisible({ key: "d", layerId: "brow", role: "base", variant: null }, closed),
    ).toBe(true);
  });
});

describe("facePreviewMotionAt", () => {
  const schedule: FacePreviewSchedule = {
    loopMs: 1000,
    blinks: [{ startMs: 100, endMs: 200 }],
    mouths: [{ startMs: 400, endMs: 500 }],
  };

  it("reads the frame at an elapsed time and wraps the loop", () => {
    expect(facePreviewMotionAt(schedule, 150)).toEqual({
      eyesClosed: true,
      mouthOpen: false,
    });
    expect(facePreviewMotionAt(schedule, 450)).toEqual({
      eyesClosed: false,
      mouthOpen: true,
    });
    expect(facePreviewMotionAt(schedule, 1150)).toEqual({
      eyesClosed: true,
      mouthOpen: false,
    });
  });

  it("treats event ends as closed", () => {
    expect(facePreviewMotionAt(schedule, 200)).toEqual({
      eyesClosed: false,
      mouthOpen: false,
    });
  });
});
