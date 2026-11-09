import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  liveCharacterSheetSchema,
  livePackageManifestSchema,
  livePackageShowSchema,
  liveProgramDocumentSchema,
  type LiveMaterialFormat,
  type LiveProgramVersionDetail,
  type LiveProgramDocument,
  type TtsAdapter,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { probeMedia } from "../media/probe.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import { createLiveExportJob } from "../services/live-exports.ts";
import { processLiveExportJob } from "../worker/live-export.ts";
import { wavFixture } from "../testing/tts-mocks.ts";
import { verifyPackage } from "../live/verify-package.ts";
import type { RenderMp4 } from "../live/prepare-live-materials.ts";
import {
  addScriptCue,
  createLiveCharacter,
  createLiveTestContext,
  createLiveVoiceProfile,
  createLiveWorkWithScene,
  liveFormatFixture,
  type LiveTestContext,
} from "./live-program-test-helpers.ts";
import { createLiveFormat } from "./live-formats.ts";
import {
  createLiveProgram,
  finalizeLiveProgramVersion,
  importLiveMaterial,
  saveLiveProgramDraft,
} from "./live-programs.ts";

const execFileAsync = promisify(execFile);
const testFontCatalog = new FontCatalogService(new FakeFontCatalogAdapter());

function pngHeader(width: number, height: number, salt?: string): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = 6;
  return salt === undefined ? buffer : Buffer.concat([buffer, Buffer.from(`\n${salt}`)]);
}

let context: LiveTestContext;
let config: AppConfig;
let prisma: LiveTestContext["prisma"];
let cutInVideo:
  | { data: Buffer; durationMs: number; width: number; height: number }
  | undefined;
let counter = 0;
let cutInAssetId: string | null = null;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function writeAssetFile(storageKey: string, data: Buffer): Promise<void> {
  const path = join(config.directories.root, storageKey);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, data);
}

interface MediaAssetInput {
  id: string;
  kind: "image" | "audio" | "video";
  mediaType: string;
  data: Buffer;
  durationMs?: number | null;
  widthPx?: number | null;
  heightPx?: number | null;
  hasAudio?: boolean;
  rendition?: boolean;
}

async function createMediaAsset(input: MediaAssetInput) {
  const sha256 = createHash("sha256").update(input.data).digest("hex");
  const storageKey = `assets/${input.id}`;
  await writeAssetFile(storageKey, input.data);
  const asset = await prisma.asset.create({
    data: {
      id: input.id,
      kind: input.kind,
      origin: "uploaded",
      status: "ready",
      storageKey,
      originalFilename: `asset-${input.id}`,
      mediaType: input.mediaType,
      byteSize: BigInt(input.data.byteLength),
      sha256,
      durationMs: input.durationMs ?? null,
      widthPx: input.widthPx ?? null,
      heightPx: input.heightPx ?? null,
      hasAudio: input.hasAudio ?? input.kind === "audio",
    },
  });
  if (input.rendition === true) {
    const renditionKey = `renditions/${input.id}`;
    await writeAssetFile(renditionKey, input.data);
    await prisma.assetRendition.create({
      data: {
        id: `rendition-${input.id}`,
        assetId: input.id,
        purpose: "render",
        storageKey: renditionKey,
        mediaType: input.mediaType,
        sha256,
        byteSize: BigInt(input.data.byteLength),
        durationMs: input.durationMs ?? null,
        widthPx: input.widthPx ?? null,
        heightPx: input.heightPx ?? null,
      },
    });
  }
  return asset;
}

async function generateCutInVideo(): Promise<typeof cutInVideo> {
  const path = join(context.dataDir, "cutin-source.mp4");
  await execFileAsync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=30",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-y",
    path,
  ]);
  const probe = await probeMedia(path, "video", "video/mp4");
  if (
    probe.durationMs === null ||
    probe.durationMs <= 0 ||
    probe.widthPx === null ||
    probe.heightPx === null
  ) {
    return undefined;
  }
  return {
    data: await readFile(path),
    durationMs: probe.durationMs,
    width: probe.widthPx,
    height: probe.heightPx,
  };
}

interface ProgramFixture {
  version: LiveProgramVersionDetail;
  openingCueId: string;
  audioAssetId: string;
  cardImageAssetId: string;
  materialId: string;
  materials: { id: string; format: LiveMaterialFormat }[];
  cutInId: string | null;
}

interface MaterialFixtureOptions {
  format: LiveMaterialFormat;
  durationMs?: number;
}

async function createProgramFixture(
  prefix: string,
  options: {
    withAudioRendition?: boolean;
    materials?: MaterialFixtureOptions[];
  } = {},
): Promise<ProgramFixture> {
  const characterAsset = await createMediaAsset({
    id: nextId(`${prefix}-char-image`),
    kind: "image",
    mediaType: "image/png",
    data: pngHeader(64, 64, nextId(`${prefix}-char-bytes`)),
    widthPx: 64,
    heightPx: 64,
  });
  const cardImageAsset = await createMediaAsset({
    id: nextId(`${prefix}-card-image`),
    kind: "image",
    mediaType: "image/png",
    data: pngHeader(32, 18, nextId(`${prefix}-card-bytes`)),
    widthPx: 32,
    heightPx: 18,
  });
  counter += 1;
  const audioAsset = await createMediaAsset({
    id: nextId(`${prefix}-audio`),
    kind: "audio",
    mediaType: "audio/wav",
    data: wavFixture(3000, 440 + counter),
    durationMs: 3000,
    rendition: options.withAudioRendition ?? true,
  });
  const videoAsset = cutInAssetId === null ? undefined : { id: cutInAssetId };

  const characterId = nextId(`${prefix}-char`);
  const voiceId = nextId(`${prefix}-voice`);
  await createLiveCharacter(prisma, {
    id: characterId,
    name: "左キャラ",
    appearanceAssetId: characterAsset.id,
  });
  await createLiveVoiceProfile(prisma, { id: voiceId });

  const work = await createLiveWorkWithScene(prisma, {
    workId: nextId(`${prefix}-work`),
    sceneId: "scene-intro",
  });
  const format = await createLiveFormat(
    prisma,
    liveFormatFixture({ characterId, voiceProfileId: voiceId }),
  );
  const program = await createLiveProgram(prisma, { formatId: format.id });
  let document: LiveProgramDocument = addScriptCue(program.draftDocument);

  const openingSegment = document.segments.find((segment) => segment.kind === "opening");
  const openingCueId = openingSegment?.kind === "opening" ? openingSegment.cues[0] : undefined;
  if (openingCueId === undefined) {
    throw new Error("opening cue がありません。");
  }
  const imageCardId = nextId(`${prefix}-card`);
  const imageStateId = nextId(`${prefix}-state`);
  document = liveProgramDocumentSchema.parse({
    ...document,
    cues: document.cues.map((cue) => {
      if (cue.id === openingCueId) {
        return { ...cue, audioAssetId: audioAsset.id };
      }
      if (cue.id === "test-script-cue") {
        return {
          ...cue,
          visual: { kind: "card", cardId: imageCardId, stateId: imageStateId },
        };
      }
      return cue;
    }),
    cards: [
      ...document.cards,
      {
        id: imageCardId,
        type: "image",
        states: [{ id: imageStateId, assetId: cardImageAsset.id }],
      },
    ],
  });
  if (videoAsset !== undefined) {
    const cutInId = nextId(`${prefix}-cutin`);
    const closingIndex = document.segments.findIndex((segment) => segment.kind === "closing");
    document = liveProgramDocumentSchema.parse({
      ...document,
      cutIns: [{ id: cutInId, assetId: videoAsset.id }],
      segments: [
        ...document.segments.slice(0, closingIndex),
        {
          id: nextId(`${prefix}-cut-seg`),
          kind: "cut_in",
          label: "コーナーへ",
          cutInId,
        },
        ...document.segments.slice(closingIndex),
      ],
    });
  }
  const saved = await saveLiveProgramDraft(prisma, program.id, {
    expectedRevision: program.draftRevision,
    document,
  });
  const materialSpecs = options.materials ?? [{ format: "png" }];
  let revision = saved.draftRevision;
  let imported:
    | Awaited<ReturnType<typeof importLiveMaterial>>
    | undefined;
  const importedMaterials: { id: string; format: LiveMaterialFormat }[] = [];
  for (const spec of materialSpecs) {
    imported = await importLiveMaterial(prisma, program.id, {
      expectedRevision: revision,
      workId: work.workId,
      sceneId: work.sceneId,
      name: `ニュース図版 ${spec.format}`,
      format: spec.format,
      ...(spec.durationMs === undefined ? {} : { durationMs: spec.durationMs }),
    });
    revision = imported.program.draftRevision;
    importedMaterials.push({
      id: imported.material.id,
      format: spec.format,
    });
  }
  if (imported === undefined) {
    throw new Error("Live Material fixture がありません。");
  }
  const withMaterialVisual = liveProgramDocumentSchema.parse({
    ...imported.program.draftDocument,
    segments: imported.program.draftDocument.segments.map((segment) =>
      segment.kind === "script"
        ? {
            ...segment,
            visual: { kind: "material", materialId: imported.material.id },
          }
        : segment,
    ),
  });
  const savedMaterial = await saveLiveProgramDraft(prisma, program.id, {
    expectedRevision: revision,
    document: withMaterialVisual,
  });
  const version = await finalizeLiveProgramVersion(prisma, program.id, {
    expectedRevision: savedMaterial.draftRevision,
  });
  const versionDocument = version.document;
  const cutIn = versionDocument.segments.find((segment) => segment.kind === "cut_in");
  return {
    version,
    openingCueId,
    audioAssetId: audioAsset.id,
    cardImageAssetId: cardImageAsset.id,
    materialId: imported.material.id,
    materials: importedMaterials,
    cutInId: cutIn?.kind === "cut_in" ? cutIn.cutInId : null,
  };
}

function fakeTts(calls: { count: number }): TtsAdapter {
  return {
    id: "voicevox",
    listVoices: async () => ({ voices: [], engineVersion: null }),
    synthesize: async () => {
      calls.count += 1;
      return { data: wavFixture(1000, 440), mediaType: "audio/wav" };
    },
  };
}

async function runJob(
  versionId: string,
  outDir: string,
  adapter: TtsAdapter,
  overrides: { renderMp4?: RenderMp4 } = {},
) {
  const job = await createLiveExportJob(
    prisma,
    { programVersionId: versionId, outDir },
    testFontCatalog,
  );
  expect(job.programVersionId).toBe(versionId);
  expect(job.workId).toBeNull();
  expect(job.scriptVersionId).toBeNull();
  const row = await prisma.job.update({
    where: { id: job.id },
    data: { status: "running", startedAt: new Date() },
  });
  await processLiveExportJob(prisma, config, row, {
    adapterFor: () => adapter,
    rasterizer: { renderPng: async () => pngHeader(1920, 1080) },
    ...(overrides.renderMp4 === undefined ? {} : { renderMp4: overrides.renderMp4 }),
    isCancelled: async () => false,
  });
  return prisma.job.findUniqueOrThrow({ where: { id: job.id } });
}

beforeAll(async () => {
  context = await createLiveTestContext("kakeai-live-program-export-");
  config = loadConfig();
  prisma = context.prisma;
  await createMediaAsset({
    id: "asset-bg",
    kind: "image",
    mediaType: "image/png",
    data: pngHeader(16, 9),
    widthPx: 16,
    heightPx: 9,
  });
  try {
    cutInVideo = await generateCutInVideo();
  } catch {
    cutInVideo = undefined;
  }
  if (cutInVideo !== undefined) {
    const asset = await createMediaAsset({
      id: "asset-cutin-video",
      kind: "video",
      mediaType: "video/mp4",
      data: cutInVideo.data,
      durationMs: cutInVideo.durationMs,
      widthPx: cutInVideo.width,
      heightPx: cutInVideo.height,
      hasAudio: false,
    });
    cutInAssetId = asset.id;
  }
}, 60_000);

afterAll(async () => {
  await context.close();
});

describe("Live Program Version export", () => {
  it("writes a v2 package with cards, card assets, materials and source hashes", async () => {
    const fixture = await createProgramFixture("export");
    const outDir = join(context.dataDir, "program-package");
    const calls = { count: 0 };
    const finished = await runJob(fixture.version.id, outDir, fakeTts(calls));
    expect(finished.status).toBe("succeeded");
    const result = JSON.parse(finished.resultJson!) as {
      packageId: string;
      preparedCueCount: number;
    };
    expect(result.preparedCueCount).toBe(fixture.version.document.cues.length);

    const manifestJson = await readFile(join(outDir, "manifest.json"), "utf8");
    const manifest = livePackageManifestSchema.parse(JSON.parse(manifestJson));
    expect(manifest.packageSchemaVersion).toBe(2);
    expect(manifest.cardSchemaVersion).toBe(1);
    expect(manifest.source).toMatchObject({
      programId: fixture.version.programId,
      programVersionId: fixture.version.id,
      programVersionNumber: fixture.version.versionNumber,
      programDocumentSha256: fixture.version.documentSha256,
      resolutionSnapshotSha256: fixture.version.resolutionSnapshotSha256,
      theme: {
        id: fixture.version.resolutionSnapshot.theme.id,
        version: fixture.version.resolutionSnapshot.theme.version,
      },
    });
    expect(manifest.files.some((file) => file.path === "show.json")).toBe(true);
    const cardAssetFile = manifest.files.find((file) => file.kind === "card-asset");
    expect(cardAssetFile).toBeDefined();
    const cardBytes = await readFile(join(outDir, cardAssetFile!.path));
    expect(createHash("sha256").update(cardBytes).digest("hex")).toBe(cardAssetFile!.sha256);
    expect(cardAssetFile!.byteSize).toBe(cardBytes.byteLength);
    expect(cardAssetFile!.mediaType).toBe("image/png");
    expect(cardAssetFile!.width).toBe(32);
    expect(cardAssetFile!.height).toBe(18);
    expect(manifest.files.some((file) => file.kind === "material")).toBe(true);

    const rawShow = JSON.parse(await readFile(join(outDir, "show.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(rawShow).not.toHaveProperty("commentSource");
    expect(rawShow).not.toHaveProperty("test");
    expect(rawShow).not.toHaveProperty("show.startAt");
    const show = livePackageShowSchema.parse(rawShow);
    expect(show.schemaVersion).toBe(2);
    expect(show.cards.map((card) => card.id)).toHaveLength(1);
    expect(show.cards[0]?.type).toBe("image");
    expect(show.cardAssets).toEqual([
      expect.objectContaining({
        id: fixture.cardImageAssetId,
        file: expect.stringMatching(/^cards\/.+\.png$/),
        mediaType: "image/png",
        width: 32,
        height: 18,
      }),
    ]);
    const scriptSegment = show.segments.find((segment) => segment.kind === "script");
    expect(
      scriptSegment?.kind === "script" ? scriptSegment.visual : undefined,
    ).toEqual({
      kind: "material",
      materialId: fixture.materialId,
    });
    expect(show.materials).toEqual([
      expect.objectContaining({
        id: fixture.materialId,
        kind: "image",
        file: "materials/card-0001.png",
      }),
    ]);
    if (fixture.cutInId !== null) {
      expect(show.cutIns.map((cutIn) => cutIn.id)).toEqual([fixture.cutInId]);
    }
    for (const cue of show.cues) {
      expect(cue.origin).toBe("live");
      expect(cue).not.toHaveProperty("materialId");
      expect(cue).not.toHaveProperty("sourceLineId");
      expect(cue.audio).toMatch(/^audio\/prepared\//);
      expect(cue.durationMs).toBeGreaterThan(0);
    }
    expect(
      show.cues.find((cue) => cue.id === fixture.openingCueId)?.durationMs,
    ).toBe(3000);
    liveCharacterSheetSchema.parse(
      JSON.parse(await readFile(join(outDir, "characters.json"), "utf8")),
    );
    const verified = await verifyPackage(outDir, manifest);
    expect(verified.show.schemaVersion).toBe(2);
    expect((await stat(outDir)).isDirectory()).toBe(true);
  });

  it("exports PNG, HTML and MP4 Live Materials in the selected formats", async () => {
    const fixture = await createProgramFixture("material-formats", {
      materials: [
        { format: "png" },
        { format: "html" },
        { format: "mp4" },
      ],
    });
    const outDir = join(context.dataDir, "material-formats-package");
    const renderMp4: RenderMp4 = async ({ outputPath }) => {
      await execFileAsync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x1f2937:s=1920x1080:r=30",
        "-t",
        "4",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        outputPath,
      ]);
    };
    const finished = await runJob(
      fixture.version.id,
      outDir,
      fakeTts({ count: 0 }),
      { renderMp4 },
    );
    expect(finished.status).toBe("succeeded");

    const manifest = livePackageManifestSchema.parse(
      JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8")),
    );
    const show = livePackageShowSchema.parse(
      JSON.parse(await readFile(join(outDir, "show.json"), "utf8")),
    );
    expect(show.materials.map((material) => material.kind)).toEqual([
      "image",
      "html",
      "video",
    ]);
    expect(show.materials.map((material) => material.file)).toEqual([
      "materials/card-0001.png",
      "materials/card-0002.html",
      "materials/card-0003.mp4",
    ]);

    const htmlFile = manifest.files.find(
      (file) => file.path === "materials/card-0002.html",
    );
    expect(htmlFile).toMatchObject({
      mediaType: "text/html",
      kind: "material",
      width: 1920,
      height: 1080,
      hasAudio: false,
    });
    const html = await readFile(join(outDir, "materials/card-0002.html"), "utf8");
    expect(html).not.toMatch(/<script\b/i);
    const assetReferences = [
      ...html.matchAll(/\.\.\/(media\/assets\/[0-9a-f]{64}\.png)/g),
    ].map((match) => match[1]!);
    expect(assetReferences.length).toBeGreaterThan(0);
    for (const assetPath of assetReferences) {
      expect(manifest.files).toContainEqual(
        expect.objectContaining({
          path: assetPath,
          kind: "asset",
          mediaType: "image/png",
        }),
      );
    }

    const videoCard = show.materials[2];
    expect(videoCard?.kind).toBe("video");
    if (videoCard?.kind !== "video") {
      throw new Error("MP4 素材カードがありません。");
    }
    expect(videoCard.durationMs).toBeGreaterThan(0);
    const videoFile = manifest.files.find(
      (file) => file.path === "materials/card-0003.mp4",
    );
    expect(videoFile).toMatchObject({
      mediaType: "video/mp4",
      kind: "material",
      width: 1920,
      height: 1080,
      hasAudio: false,
      durationMs: videoCard.durationMs,
    });
    const probe = await probeMedia(
      join(outDir, "materials/card-0003.mp4"),
      "video",
      "video/mp4",
    );
    expect(probe.audioCodec).toBeNull();
    expect(probe.durationMs).toBe(videoCard.durationMs);
    expect(probe.widthPx).toBe(1920);
    expect(probe.heightPx).toBe(1080);

    await expect(verifyPackage(outDir, manifest)).resolves.toMatchObject({
      show: { schemaVersion: 2 },
    });
  });

  it("fails an MP4 material with the material id when rendering fails", async () => {
    const fixture = await createProgramFixture("material-mp4-failure", {
      materials: [{ format: "mp4" }],
    });
    const outDir = join(context.dataDir, "material-mp4-failure-package");
    const finished = await runJob(
      fixture.version.id,
      outDir,
      fakeTts({ count: 0 }),
      {
        renderMp4: async () => {
          throw new Error("render failed");
        },
      },
    );
    expect(finished.status).toBe("failed");
    expect(finished.errorCode).toBe("LIVE_EXPORT_MATERIAL_FAILED");
    const result = JSON.parse(finished.resultJson!) as {
      failures: { stage: string; id: string | null }[];
    };
    expect(result.failures[0]).toMatchObject({
      stage: "material",
      id: fixture.materialId,
    });
  });

  it("creates a new build for the same version and leaves the old package intact", async () => {
    const fixture = await createProgramFixture("rebuild");
    const firstDir = join(context.dataDir, "rebuild-package-1");
    const secondDir = join(context.dataDir, "rebuild-package-2");
    const first = await runJob(fixture.version.id, firstDir, fakeTts({ count: 0 }));
    expect(first.status).toBe("succeeded");
    const firstManifestBefore = await readFile(join(firstDir, "manifest.json"), "utf8");
    const firstResult = JSON.parse(first.resultJson!) as { packageId: string };

    const second = await runJob(fixture.version.id, secondDir, fakeTts({ count: 0 }));
    expect(second.status).toBe("succeeded");
    const secondResult = JSON.parse(second.resultJson!) as { packageId: string };
    expect(secondResult.packageId).not.toBe(firstResult.packageId);
    expect(await readFile(join(firstDir, "manifest.json"), "utf8")).toBe(
      firstManifestBefore,
    );
    expect((await stat(firstDir)).isDirectory()).toBe(true);
    expect((await stat(secondDir)).isDirectory()).toBe(true);
  });

  it("fails instead of using a character appearance edited after finalization", async () => {
    const fixture = await createProgramFixture("standing-drift");
    const characterId = fixture.version.document.cast.left.characterId;
    await prisma.characterAppearance.updateMany({
      where: { characterId },
      data: { standingEdge: "center" },
    });
    await expect(
      createLiveExportJob(
        prisma,
        { programVersionId: fixture.version.id, outDir: join(context.dataDir, "standing-drift-package") },
        testFontCatalog,
      ),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
  });

  it("fails instead of using a card image asset replaced after finalization", async () => {
    const fixture = await createProgramFixture("card-drift");
    await prisma.asset.update({
      where: { id: fixture.cardImageAssetId },
      data: { sha256: "c".repeat(64) },
    });
    await expect(
      createLiveExportJob(
        prisma,
        {
          programVersionId: fixture.version.id,
          outDir: join(context.dataDir, "card-drift-package"),
        },
        testFontCatalog,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("解決スナップショット"),
    });
  });

  it("fails instead of calling TTS when an audio Asset rendition disappeared", async () => {
    const fixture = await createProgramFixture("missing-rendition", {
      withAudioRendition: true,
    });
    const outDir = join(context.dataDir, "missing-rendition-package");
    const job = await createLiveExportJob(
      prisma,
      { programVersionId: fixture.version.id, outDir },
      testFontCatalog,
    );
    const rendition = await prisma.assetRendition.findFirstOrThrow({
      where: { assetId: fixture.audioAssetId },
    });
    await prisma.assetRendition.delete({ where: { id: rendition.id } });

    const calls = { count: 0 };
    const row = await prisma.job.update({
      where: { id: job.id },
      data: { status: "running", startedAt: new Date() },
    });
    await processLiveExportJob(prisma, config, row, {
      adapterFor: () => fakeTts(calls),
      rasterizer: { renderPng: async () => pngHeader(1920, 1080) },
      isCancelled: async () => false,
    });
    const finished = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finished.status).toBe("failed");
    expect(finished.errorCode).toBe("LIVE_EXPORT_INPUT_INVALID");
    expect(calls.count).toBe(0);
    const result = JSON.parse(finished.resultJson!);
    expect(result.failures[0].stage).toBe("input");
  });

  it("exports from the Live Material snapshot after the source scene changes", async () => {
    const fixture = await createProgramFixture("material-snapshot");
    // The Live Material keeps the imported Scene snapshot; the source Script
    // Version is no longer consulted by the exporter.
    const liveMaterial = await prisma.liveMaterial.findFirstOrThrow({
      where: { programId: fixture.version.programId },
    });
    const provenance = JSON.parse(liveMaterial.provenanceJson) as {
      workId: string;
      sceneId: string;
    };
    const editions = await prisma.languageEdition.findMany({
      where: { workId: provenance.workId },
      include: { currentScriptVersion: true },
    });
    for (const edition of editions) {
      if (edition.currentScriptVersion !== null) {
        await prisma.scriptVersion.update({
          where: { id: edition.currentScriptVersion.id },
          data: { contentJson: JSON.stringify({}) },
        });
      }
    }

    const outDir = join(context.dataDir, "material-snapshot-package");
    const finished = await runJob(fixture.version.id, outDir, fakeTts({ count: 0 }));
    expect(finished.status).toBe("succeeded");
    const show = livePackageShowSchema.parse(
      JSON.parse(await readFile(join(outDir, "show.json"), "utf8")),
    );
    expect(show.materials).toHaveLength(1);
    expect(show.materials[0]?.id).toBe(fixture.materialId);
  });
});
