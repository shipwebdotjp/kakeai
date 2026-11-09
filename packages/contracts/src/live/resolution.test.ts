import { describe, expect, it } from "vitest";
import { liveResolutionSnapshotSchema } from "./resolution";
import type { LiveAssetSnapshot } from "./snapshot";

const HASH = "a".repeat(64);

const imageAsset: LiveAssetSnapshot = {
  assetId: "asset-card-image",
  renditionId: null,
  kind: "image",
  mediaType: "image/png",
  sha256: HASH,
  byteSize: 10,
  durationMs: null,
  widthPx: 32,
  heightPx: 18,
  hasAudio: false,
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    theme: { id: "neutral", version: 1, sha256: HASH },
    characters: [],
    voices: [],
    audioAssets: [],
    cutIns: [],
    cardAssets: [],
    materials: [],
    ...overrides,
  };
}

function leftCharacter(characterId: string) {
  return {
    side: "left" as const,
    characterId,
    name: "左",
    appearances: [
      {
        id: "appearance-1",
        expression: "normal",
        pose: "default",
        standing: { scale: 1, edge: "margin", vertical: "standard" },
        image: imageAsset,
        faceSet: null,
      },
    ],
  };
}

function leftVoice(characterId: string) {
  return {
    side: "left" as const,
    characterId,
    voiceProfileId: "voice-1",
    adapterId: "voicevox" as const,
    voiceId: "voice-1",
    speedScale: 1,
    settings: {},
    referenceAudio: null,
  };
}

describe("liveResolutionSnapshotSchema", () => {
  it("accepts card image snapshots and rejects duplicate asset ids", () => {
    const cardAsset = { assetId: imageAsset.assetId, asset: imageAsset };
    expect(
      liveResolutionSnapshotSchema.safeParse(snapshot({ cardAssets: [cardAsset] })).success,
    ).toBe(true);
    const duplicate = liveResolutionSnapshotSchema.safeParse(
      snapshot({ cardAssets: [cardAsset, cardAsset] }),
    );
    expect(duplicate.success).toBe(false);
    expect(
      duplicate.error?.issues.some((issue) =>
        issue.message.includes("カード画像 Asset が重複"),
      ),
    ).toBe(true);
  });

  it("requires the card image asset id to match its snapshot", () => {
    expect(
      liveResolutionSnapshotSchema.safeParse(
        snapshot({
          cardAssets: [{ assetId: "asset-other", asset: imageAsset }],
        }),
      ).success,
    ).toBe(false);
  });

  it("requires every voice side to match a character with the same id", () => {
    expect(
      liveResolutionSnapshotSchema.safeParse(
        snapshot({
          characters: [leftCharacter("char-1")],
          voices: [leftVoice("char-1")],
        }),
      ).success,
    ).toBe(true);

    const missingCharacter = liveResolutionSnapshotSchema.safeParse(
      snapshot({ voices: [leftVoice("char-1")] }),
    );
    expect(missingCharacter.success).toBe(false);
    expect(
      missingCharacter.error?.issues.some((issue) =>
        issue.message.includes("対応するキャラクターがありません"),
      ),
    ).toBe(true);

    const missingVoice = liveResolutionSnapshotSchema.safeParse(
      snapshot({ characters: [leftCharacter("char-1")] }),
    );
    expect(missingVoice.success).toBe(false);
    expect(
      missingVoice.error?.issues.some((issue) =>
        issue.message.includes("対応する声がありません"),
      ),
    ).toBe(true);

    const mismatched = liveResolutionSnapshotSchema.safeParse(
      snapshot({
        characters: [leftCharacter("char-1")],
        voices: [leftVoice("char-2")],
      }),
    );
    expect(mismatched.success).toBe(false);
    expect(
      mismatched.error?.issues.some((issue) =>
        issue.message.includes("キャラクター ID"),
      ),
    ).toBe(true);
  });
});
