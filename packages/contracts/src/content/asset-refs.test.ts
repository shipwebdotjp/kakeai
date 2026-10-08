import { describe, expect, it } from "vitest";
import { validContentDocument } from "../testing/fixtures";
import { collectAssetReferences } from "./asset-refs";

describe("collectAssetReferences", () => {
  it("collects audio takes, audio cues and media cues with allowed kinds", () => {
    const references = collectAssetReferences(validContentDocument());
    const byAssetId = new Map(references.map((reference) => [reference.assetId, reference]));
    expect(byAssetId.get("asset-audio-1")?.allowedKinds).toEqual(["audio"]);
    expect(byAssetId.get("asset-bgm")?.allowedKinds).toEqual(["audio"]);
    expect(byAssetId.get("asset-bg")?.allowedKinds).toEqual(["image", "video"]);
  });

  it("ignores cues whose template is not media based", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      {
        id: "vc-text",
        template: { id: "text.body", version: 1 },
        range: { kind: "scene" },
        input: { heading: "見出し", body: "本文" },
      },
    ];
    const references = collectAssetReferences(document);
    expect(references.some((reference) => reference.assetId === "asset-text")).toBe(false);
  });
});
