import { describe, expect, it } from "vitest";
import {
  createFaceSetRequestSchema,
  faceSetSchema,
  updateFaceSetRequestSchema,
} from "./face-set";

function validRequest() {
  return {
    name: "リン正面",
    layers: [
      { id: "brow-normal", part: "brow", assetId: "asset-brow", blinkLayerId: null, speakingLayerId: null },
      { id: "eye-normal", part: "eye", assetId: "asset-eye", blinkLayerId: "eye-closed", speakingLayerId: null },
      { id: "eye-closed", part: "eye", assetId: "asset-eye-closed", blinkLayerId: null, speakingLayerId: null },
      { id: "mouth-normal", part: "mouth", assetId: "asset-mouth", blinkLayerId: null, speakingLayerId: "mouth-open" },
      { id: "mouth-open", part: "mouth", assetId: "asset-mouth-open", blinkLayerId: null, speakingLayerId: null },
    ],
    expressions: [
      { id: "normal", name: "通常", browLayerId: "brow-normal", eyeLayerId: "eye-normal", mouthLayerId: "mouth-normal" },
      { id: "happy", name: "笑い", browLayerId: "brow-normal", eyeLayerId: "eye-normal", mouthLayerId: "mouth-open" },
    ],
  };
}

describe("createFaceSetRequestSchema", () => {
  it("accepts layers and expressions", () => {
    expect(createFaceSetRequestSchema.safeParse(validRequest()).success).toBe(true);
    expect(updateFaceSetRequestSchema.safeParse(validRequest()).success).toBe(true);
  });

  it("rejects a blank name", () => {
    expect(
      createFaceSetRequestSchema.safeParse({ ...validRequest(), name: "  " }).success,
    ).toBe(false);
  });

  it("rejects an unknown layer part", () => {
    const request = validRequest();
    request.layers[0]!.part = "nose";
    expect(createFaceSetRequestSchema.safeParse(request).success).toBe(false);
  });
});

describe("faceSetSchema", () => {
  it("accepts a stored face set", () => {
    expect(
      faceSetSchema.safeParse({
        ...validRequest(),
        id: "faceset-rin",
        createdAt: "2026-10-09T00:00:00.000Z",
        updatedAt: "2026-10-09T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
