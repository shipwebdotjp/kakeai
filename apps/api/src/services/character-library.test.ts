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
import * as characters from "./character-library.ts";
import * as voiceProfiles from "./voice-profiles.ts";

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let counter = 0;

async function createAsset(kind: string, status = "ready") {
  counter += 1;
  return prisma.asset.create({
    data: {
      kind,
      origin: "uploaded",
      status,
      storageKey: `assets/test-${counter}`,
      originalFilename: `asset-${counter}`,
      mediaType: kind === "image" ? "image/png" : "audio/wav",
      byteSize: BigInt(10),
      sha256: `sha-${counter}`,
    },
  });
}

async function createProfile() {
  return voiceProfiles.createVoiceProfile(prisma, {
    name: "めたん",
    adapterId: "voicevox",
    voiceId: "uuid-1:2",
    locale: "ja-JP",
    settings: {},
  });
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-char-"));
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

describe("character library", () => {
  it("creates, lists, updates and deletes a character with appearances", async () => {
    const image = await createAsset("image");
    const profile = await createProfile();

    const created = await characters.createCharacter(prisma, {
      name: "リン",
      names: [],
      voices: [{ locale: "ja-JP", voiceProfileId: profile.id }],
      appearances: [
        { id: "appearance-1", assetId: image.id, expression: "smile", pose: "front", label: "夏服", faceSetId: null },
      ],
    });
    expect(created.name).toBe("リン");
    expect(created.voices).toEqual([{ locale: "ja-JP", voiceProfileId: profile.id }]);
    expect(created.appearances[0]).toMatchObject({ id: "appearance-1", label: "夏服" });

    const listed = await characters.listCharacters(prisma);
    expect(listed.map((entry) => entry.id)).toContain(created.id);

    const updated = await characters.updateCharacter(prisma, created.id, {
      name: "リン（冬）",
      names: [],
      voices: [],
      appearances: [
        { id: "appearance-2", assetId: image.id, expression: "normal", pose: "front", faceSetId: null },
      ],
    });
    expect(updated.name).toBe("リン（冬）");
    expect(updated.voices).toEqual([]);
    expect(updated.appearances.map((appearance) => appearance.id)).toEqual(["appearance-2"]);
    expect(updated.appearances[0]!.label).toBeUndefined();

    await characters.deleteCharacter(prisma, created.id);
    await expect(characters.getCharacter(prisma, created.id)).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND",
    });
  });

  it("rejects non-image and unknown assets", async () => {
    const audio = await createAsset("audio");
    await expect(
      characters.createCharacter(prisma, {
        name: "だめ",
        names: [],
        voices: [],
        appearances: [{ id: "a", assetId: audio.id, expression: "", pose: "", faceSetId: null }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      characters.createCharacter(prisma, {
        name: "だめ",
        names: [],
        voices: [],
        appearances: [{ id: "a", assetId: "asset-missing", expression: "", pose: "", faceSetId: null }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an unknown voice profile", async () => {
    await expect(
      characters.createCharacter(prisma, {
        name: "だめ",
        names: [],
        voices: [{ locale: "ja-JP", voiceProfileId: "vp-missing" }],
        appearances: [],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a voice profile whose locale differs from the entry", async () => {
    const profile = await createProfile();
    await expect(
      characters.createCharacter(prisma, {
        name: "だめ",
        names: [],
        voices: [{ locale: "en-US", voiceProfileId: profile.id }],
        appearances: [],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("saves and returns locale names", async () => {
    const created = await characters.createCharacter(prisma, {
      name: "ひなた",
      names: [
        { locale: "ja-JP", name: "ひなた" },
        { locale: "en-US", name: "Hinata" },
      ],
      voices: [],
      appearances: [],
    });
    expect(created.names).toEqual([
      { locale: "ja-JP", name: "ひなた" },
      { locale: "en-US", name: "Hinata" },
    ]);
    const fetched = await characters.getCharacter(prisma, created.id);
    expect(fetched.names).toEqual(created.names);
  });

  it("rejects duplicate locale names", async () => {
    await expect(
      characters.createCharacter(prisma, {
        name: "だめ",
        names: [
          { locale: "ja-JP", name: "ひなた" },
          { locale: "ja-JP", name: "ヒナタ" },
        ],
        voices: [],
        appearances: [],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("blocks deleting a voice profile referenced by a character", async () => {
    const profile = await createProfile();
    await characters.createCharacter(prisma, {
      name: "リン",
      names: [],
      voices: [{ locale: "ja-JP", voiceProfileId: profile.id }],
      appearances: [],
    });
    await expect(voiceProfiles.deleteVoiceProfile(prisma, profile.id)).rejects.toMatchObject({
      code: "VOICE_PROFILE_IN_USE",
    });
  });
});
