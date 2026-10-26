import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import * as faceSets from "./face-sets.ts";
import * as characters from "./character-library.ts";
import * as works from "./works.ts";
import * as scriptVersions from "./script-versions.ts";
import { createInitialContentDocument } from "@kakeai/contracts";

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let counter = 0;

async function createImage(widthPx: number | null = 480, heightPx: number | null = 960) {
  counter += 1;
  return prisma.asset.create({
    data: {
      kind: "image",
      origin: "uploaded",
      status: "ready",
      storageKey: `assets/face-${counter}`,
      originalFilename: `face-${counter}.png`,
      mediaType: "image/png",
      byteSize: BigInt(10),
      sha256: `face-sha-${counter}`,
      widthPx,
      heightPx,
    },
  });
}

function layer(id: string, part: "brow" | "eye" | "mouth" | "foreground", assetId: string) {
  return { id, part, assetId, blinkLayerId: null, speakingLayerId: null };
}

async function createFaceSetInput() {
  const brow = await createImage();
  const eye = await createImage();
  const eyeClosed = await createImage();
  const mouth = await createImage();
  return {
    name: "リン正面",
    layers: [
      layer("brow-normal", "brow", brow.id),
      { ...layer("eye-normal", "eye", eye.id), blinkLayerId: "eye-closed" },
      layer("eye-closed", "eye", eyeClosed.id),
      layer("mouth-normal", "mouth", mouth.id),
    ],
    expressions: [
      {
        id: "normal",
        name: "通常",
        browLayerId: "brow-normal",
        eyeLayerId: "eye-normal",
        mouthLayerId: "mouth-normal",
      },
      {
        id: "happy",
        name: "笑い",
        browLayerId: "brow-normal",
        eyeLayerId: "eye-closed",
        mouthLayerId: "mouth-normal",
      },
    ],
  };
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-face-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
}, 60000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("face set library", () => {
  it("creates, lists, updates and deletes a face set", async () => {
    const created = await faceSets.createFaceSet(prisma, await createFaceSetInput());
    expect(created.name).toBe("リン正面");
    expect(created.layers.map((entry) => entry.id)).toEqual([
      "brow-normal",
      "eye-normal",
      "eye-closed",
      "mouth-normal",
    ]);
    expect(created.expressions.map((entry) => entry.id)).toEqual(["normal", "happy"]);

    const listed = await faceSets.listFaceSets(prisma);
    expect(listed.map((entry) => entry.id)).toContain(created.id);

    const fetched = await faceSets.getFaceSet(prisma, created.id);
    expect(fetched).toEqual(created);

    const updated = await faceSets.updateFaceSet(prisma, created.id, {
      ...(await createFaceSetInput()),
      name: "リン正面・改",
    });
    expect(updated.name).toBe("リン正面・改");

    await faceSets.deleteFaceSet(prisma, created.id);
    await expect(faceSets.getFaceSet(prisma, created.id)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("rejects mismatched layer dimensions", async () => {
    const input = await createFaceSetInput();
    const wide = await createImage(960, 960);
    input.layers[0] = layer("brow-normal", "brow", wide.id);
    await expect(faceSets.createFaceSet(prisma, input)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a missing normal preset", async () => {
    const input = await createFaceSetInput();
    input.expressions = input.expressions.filter((preset) => preset.id !== "normal");
    await expect(faceSets.createFaceSet(prisma, input)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects unknown layer references in presets", async () => {
    const input = await createFaceSetInput();
    input.expressions[0]!.eyeLayerId = "eye-missing";
    await expect(faceSets.createFaceSet(prisma, input)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a preset that points at the wrong part", async () => {
    const input = await createFaceSetInput();
    input.expressions[0]!.eyeLayerId = "brow-normal";
    await expect(faceSets.createFaceSet(prisma, input)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects blink and speaking layers on the wrong part", async () => {
    const input = await createFaceSetInput();
    input.layers[0] = { ...layer("brow-normal", "brow", input.layers[0]!.assetId), blinkLayerId: "eye-closed" };
    await expect(faceSets.createFaceSet(prisma, input)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects unknown and non-image assets", async () => {
    const input = await createFaceSetInput();
    input.layers[0] = layer("brow-normal", "brow", "asset-missing");
    await expect(faceSets.createFaceSet(prisma, input)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("refuses to delete a face set referenced by a library appearance", async () => {
    const faceSet = await faceSets.createFaceSet(prisma, await createFaceSetInput());
    const base = await createImage();
    const character = await characters.createCharacter(prisma, {
      name: "リン",
      names: [],
      voices: [],
      appearances: [
        { id: "appearance-face", assetId: base.id, expression: "smile", pose: "front", faceSetId: faceSet.id },
      ],
    });
    await expect(faceSets.deleteFaceSet(prisma, faceSet.id)).rejects.toMatchObject({
      code: "FACE_SET_IN_USE",
    });
    await characters.deleteCharacter(prisma, character.id);
    await faceSets.deleteFaceSet(prisma, faceSet.id);
  });

  it("refuses to delete a face set referenced by a saved script version", async () => {
    const faceSet = await faceSets.createFaceSet(prisma, await createFaceSetInput());
    const base = await createImage();
    const work = await works.createWork(prisma, "表情参照テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    content.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        appearances: [
          { id: "appearance-rin", assetId: base.id, expression: "smile", pose: "front", faceSetId: faceSet.id },
        ],
      },
    ];
    await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    await expect(faceSets.deleteFaceSet(prisma, faceSet.id)).rejects.toMatchObject({
      code: "FACE_SET_IN_USE",
    });
  });

  it("saves a line expression against the speaker standing", async () => {
    const faceSet = await faceSets.createFaceSet(prisma, await createFaceSetInput());
    const base = await createImage();
    const work = await works.createWork(prisma, "表情台詞テスト", "ja-JP");
    const edition = work.languageEditions[0]!;
    const content = createInitialContentDocument();
    content.speakers = [
      { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: null },
    ];
    content.characters = [
      {
        id: "character-rin",
        name: "リン",
        names: [],
        voices: [],
        appearances: [
          { id: "appearance-rin", assetId: base.id, expression: "smile", pose: "front", faceSetId: faceSet.id },
        ],
      },
    ];
    const point = content.scenes[1]!;
    if (point.kind !== "point") {
      throw new Error("expected a point scene");
    }
    point.lines = [
      {
        id: "line-happy",
        speakerId: "speaker-rin",
        captionText: "嬉しい",
        speechText: "うれしい",
        selectedAudioTakeId: null,
        expressionId: "happy",
      },
    ];
    point.visualCues.push({
      id: "vc-standing",
      template: { id: "character.standing", version: 1 },
      range: { kind: "scene" },
      layer: "standing",
      order: 0,
      transition: {
        enter: { preset: "none", durationMs: 0 },
        exit: { preset: "none", durationMs: 0 },
      },
      input: {
        characterId: "character-rin",
        appearanceId: "appearance-rin",
        side: "left",
        scale: 1,
      },
    });
    const saved = await scriptVersions.saveScriptVersion(prisma, edition.id, {
      sourceScriptVersionId: null,
      content,
    });
    expect(saved.scriptVersion.content.scenes[1]!.lines[0]!.expressionId).toBe("happy");

    const bad = createInitialContentDocument();
    bad.speakers = content.speakers;
    bad.characters = content.characters;
    const badPoint = bad.scenes[1]!;
    if (badPoint.kind !== "point") {
      throw new Error("expected a point scene");
    }
    badPoint.lines = [
      {
        id: "line-bad",
        speakerId: "speaker-rin",
        captionText: "不明",
        speechText: "ふめい",
        selectedAudioTakeId: null,
        expressionId: "angry",
      },
    ];
    badPoint.visualCues.push(point.visualCues[point.visualCues.length - 1]!);
    await expect(
      scriptVersions.saveScriptVersion(prisma, edition.id, {
        sourceScriptVersionId: null,
        content: bad,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an unknown face set on a library appearance", async () => {
    const base = await createImage();
    await expect(
      characters.createCharacter(prisma, {
        name: "だめ",
        names: [],
        voices: [],
        appearances: [
          { id: "appearance-x", assetId: base.id, expression: "", pose: "", faceSetId: "faceset-missing" },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
