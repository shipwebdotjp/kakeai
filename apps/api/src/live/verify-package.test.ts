import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  liveCharacterSheetSchema,
  livePackageManifestSchema,
  type LiveMediaType,
  type LivePackageFile,
} from "@kakeai/contracts";
import { probeMedia } from "../media/probe.ts";
import { verifyPackage } from "./verify-package.ts";

const execFileAsync = promisify(execFile);
const NOW = "2026-11-07T12:00:00.000Z";
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZQAAAABJRU5ErkJggg==",
  "base64",
);

function wavBytes(): Buffer {
  const sampleRate = 8000;
  const dataSize = 1600;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

interface FileMeta {
  mediaType: LiveMediaType;
  kind: LivePackageFile["kind"];
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  hasAudio: boolean;
}

interface PackageOptions {
  materialVideoWithAudio?: boolean;
  manifestCutInDurationMs?: number;
}

const roots: string[] = [];
const generatedRoots: string[] = [];
let mediaDir: string | null = null;
let ffmpegReady = false;
let probedCutInDurationMs = 0;
let probedCutInWidth = 0;
let probedCutInHeight = 0;

function mediaPath(name: string): string {
  if (mediaDir === null) {
    throw new Error("media fixture is not initialized");
  }
  return join(mediaDir, name);
}

async function buildPackage(options: PackageOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "kakeai-verify-package-"));
  roots.push(root);
  const files: LivePackageFile[] = [];

  async function add(
    relativePath: string,
    data: Buffer,
    meta: FileMeta,
  ): Promise<void> {
    const destination = join(root, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data);
    files.push({
      path: relativePath,
      sha256: createHash("sha256").update(data).digest("hex"),
      byteSize: data.byteLength,
      mediaType: meta.mediaType,
      kind: meta.kind,
      durationMs: meta.durationMs ?? null,
      width: meta.width ?? null,
      height: meta.height ?? null,
      hasAudio: meta.hasAudio,
    });
  }

  await add("theme.css", Buffer.from(":root{}\n"), {
    mediaType: "text/css",
    kind: "theme",
    hasAudio: false,
  });

  const characters = liveCharacterSheetSchema.parse({
    schemaVersion: 1,
    characters: [
      {
        id: "char-left",
        side: "left",
        name: "左",
        appearances: [
          {
            id: "left-normal",
            expression: "normal",
            image: "media/characters/left-normal.png",
            faceSetId: null,
            faceSetVersion: null,
          },
        ],
        voice: {
          adapterId: "voicevox",
          voiceId: "voice-1",
          speedScale: 1,
          settings: {},
        },
      },
    ],
    faceSets: [],
  });
  await add("characters.json", Buffer.from(`${JSON.stringify(characters, null, 2)}\n`), {
    mediaType: "application/json",
    kind: "characters",
    hasAudio: false,
  });

  await add("media/characters/left-normal.png", PNG_1X1, {
    mediaType: "image/png",
    kind: "asset",
    width: 1,
    height: 1,
    hasAudio: false,
  });

  const wav = wavBytes();
  for (const cueId of ["cue-opening", "cue-script", "cue-closing"]) {
    await add(`audio/prepared/${cueId}.wav`, wav, {
      mediaType: "audio/wav",
      kind: "prepared-audio",
      durationMs: 100,
      hasAudio: true,
    });
  }

  const cutInBytes = await readFile(mediaPath("cutin.mp4"));
  const cutInFile = "media/assets/cutin.mp4";
  await add(cutInFile, cutInBytes, {
    mediaType: "video/mp4",
    kind: "cut-in",
    durationMs: probedCutInDurationMs,
    width: probedCutInWidth,
    height: probedCutInHeight,
    hasAudio: true,
  });

  const materialFile = "media/assets/material.mp4";
  if (options.materialVideoWithAudio === true) {
    await add(materialFile, cutInBytes, {
      mediaType: "video/mp4",
      kind: "material",
      durationMs: probedCutInDurationMs,
      width: probedCutInWidth,
      height: probedCutInHeight,
      hasAudio: false,
    });
  }

  const show = {
    schemaVersion: 1,
    show: {
      title: "CutIn 検証",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      theme: "theme.css",
      characters: { left: "char-left", right: null },
      startAt: null,
    },
    commentSource: { kind: "youtube" },
    segments: [
      {
        id: "seg-opening",
        kind: "opening",
        label: "オープニング",
        targetDurationMs: 60_000,
        cues: ["cue-opening"],
      },
      {
        id: "seg-script",
        kind: "script",
        label: "本編",
        targetDurationMs: 300_000,
        cues: ["cue-script"],
      },
      {
        id: "seg-cut",
        kind: "cut_in",
        label: "コメントコーナーへ",
        cutInId: "jingle-1",
      },
      {
        id: "seg-closing",
        kind: "closing",
        label: "クロージング",
        targetDurationMs: 60_000,
        cues: ["cue-closing"],
      },
    ],
    cues: [
      {
        id: "cue-opening",
        origin: "live",
        speaker: "left",
        caption: "始まります。",
        speech: "はじまります。",
        expression: "normal",
        audio: "audio/prepared/cue-opening.wav",
        durationMs: 100,
      },
      {
        id: "cue-script",
        origin: "script",
        sourceLineId: "line-1",
        speaker: "left",
        caption: "本編です。",
        speech: "ほんぺんです。",
        expression: "normal",
        audio: "audio/prepared/cue-script.wav",
        durationMs: 100,
      },
      {
        id: "cue-closing",
        origin: "live",
        speaker: "left",
        caption: "終わります。",
        speech: "おわります。",
        expression: "normal",
        audio: "audio/prepared/cue-closing.wav",
        durationMs: 100,
      },
    ],
    materials:
      options.materialVideoWithAudio === true
        ? [
            {
              id: "material-1",
              kind: "video",
              file: materialFile,
              hasAudio: false,
              focus: true,
              width: probedCutInWidth,
              height: probedCutInHeight,
              durationMs: probedCutInDurationMs,
            },
          ]
        : [],
    cutIns: [
      {
        id: "jingle-1",
        file: cutInFile,
        durationMs: probedCutInDurationMs,
        hasAudio: true,
        width: probedCutInWidth,
        height: probedCutInHeight,
      },
    ],
    speakers: [],
    commentPolicy: {
      mode: "corner",
      freshnessMin: 10,
      maxCommentsPerCorner: 4,
      maxHumanPinsPerCorner: 4,
      maxExtraSlots: 2,
      allowImmediateInterrupt: false,
      skipWhenEmpty: true,
    },
    safety: {
      blockedTopics: [],
      persona: "親しみやすい解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-opening",
    },
    playout: {
      minBufferMs: 10_000,
      maxThinkingMs: 2000,
      closingReserveMs: 120_000,
      noApprovalDelay: true,
    },
  };
  const showText = `${JSON.stringify(show, null, 2)}\n`;
  await add("show.json", Buffer.from(showText), {
    mediaType: "application/json",
    kind: "show",
    hasAudio: false,
  });

  if (options.manifestCutInDurationMs !== undefined) {
    const cutInRecord = files.find((file) => file.path === cutInFile);
    if (cutInRecord !== undefined) {
      cutInRecord.durationMs = options.manifestCutInDurationMs;
    }
  }

  const manifest = livePackageManifestSchema.parse({
    packageSchemaVersion: 1,
    exporterVersion: "0.1.0",
    packageId: "livepkg-test",
    createdAt: NOW,
    source: {
      workId: "work-1",
      languageEditionId: "edition-1",
      scriptVersionId: "script-1",
      theme: { id: "neutral", version: 1 },
      profileSha256: "a".repeat(64),
    },
    files,
    fonts: [],
    voices: [],
  });
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { root, manifest };
}

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "kakeai-verify-media-"));
  generatedRoots.push(dir);
  mediaDir = dir;
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      mediaPath("cutin.mp4"),
    ]);
    const probe = await probeMedia(mediaPath("cutin.mp4"), "video", "video/mp4");
    if (
      probe.durationMs === null ||
      probe.durationMs <= 0 ||
      probe.widthPx === null ||
      probe.heightPx === null ||
      probe.audioCodec === null
    ) {
      return;
    }
    probedCutInDurationMs = probe.durationMs;
    probedCutInWidth = probe.widthPx;
    probedCutInHeight = probe.heightPx;
    ffmpegReady = true;
  } catch {
    ffmpegReady = false;
  }
});

afterAll(async () => {
  await Promise.all(
    [...roots, ...generatedRoots].splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("verifyPackage CutIn handling", () => {
  it("accepts a cut-in MP4 with audio", async () => {
    if (!ffmpegReady) return;
    const { root, manifest } = await buildPackage();
    const verified = await verifyPackage(root, manifest);
    expect(verified.show.cutIns).toHaveLength(1);
    expect(verified.show.cutIns[0]?.hasAudio).toBe(true);
  });

  it("still rejects a material video that contains audio", async () => {
    if (!ffmpegReady) return;
    const { root, manifest } = await buildPackage({ materialVideoWithAudio: true });
    await expect(verifyPackage(root, manifest)).rejects.toThrow(/動画カードに音声/);
  });

  it("rejects a cut-in duration that disagrees with the manifest", async () => {
    if (!ffmpegReady) return;
    const { root, manifest } = await buildPackage({
      manifestCutInDurationMs: probedCutInDurationMs + 1,
    });
    await expect(verifyPackage(root, manifest)).rejects.toThrow(/CutIn の尺/);
  });
});
