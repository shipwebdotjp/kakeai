import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LiveShowProfile, LiveMaterialInput } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { resolveVisualTheme } from "@kakeai/video";
import { dataDirectories } from "../storage/paths.ts";
import { probeMedia } from "../media/probe.ts";
import type { ResolvedAssetFile } from "./profile-resolution";
import { prepareMaterials } from "./prepare-materials";
import { PackageWriter } from "./package-writer";

const execFileAsync = promisify(execFile);

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function profile(material: LiveMaterialInput): LiveShowProfile {
  return {
    schemaVersion: 1,
    show: {
      title: "素材テスト",
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
        material: material.id,
      },
      {
        id: "seg-closing",
        kind: "closing",
        label: "クロージング",
        targetDurationMs: 60_000,
        cues: ["cue-closing"],
      },
    ],
    scriptCues: [{ id: "cue-script", lineId: "line-p1-1" }],
    liveCues: [
      {
        id: "cue-opening",
        speaker: "left",
        caption: "始まります。",
        speech: "はじまります。",
        expression: "normal",
      },
      {
        id: "cue-closing",
        speaker: "left",
        caption: "終わります。",
        speech: "おわります。",
        expression: "normal",
      },
    ],
    materials: [material],
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
      persona: "解説役",
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
}

let dir: string;
let assetById: Map<string, ResolvedAssetFile>;
let silentMp4: string | undefined;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "kakeai-materials-"));
  const imagePath = join(dir, "image.png");
  await writeFile(imagePath, pngHeader(1, 1));
  assetById = new Map([
    [
      "asset-bg",
      {
        assetId: "asset-bg",
        path: imagePath,
        kind: "image",
        mediaType: "image/png",
        sha256: "a".repeat(64),
        byteSize: 33,
        durationMs: null,
        widthPx: 1,
        heightPx: 1,
        hasAudio: false,
      },
    ],
  ]);
  try {
    const output = join(dir, "silent.mp4");
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=1920x1080:d=4:r=30",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-movflags",
      "+faststart",
      "-y",
      output,
    ]);
    silentMp4 = output;
  } catch {
    silentMp4 = undefined;
  }
}, 60000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("prepareMaterials", () => {
  it("writes a script-free HTML card with package-relative asset URLs", async () => {
    const content = validContentDocument();
    const writer = new PackageWriter(join(dir, "html-package"));
    const prepared = await prepareMaterials(
      profile({ id: "material-1", sceneId: "scene-intro", focus: true, format: "html", durationMs: 4000 }),
      content,
      resolveVisualTheme(content),
      assetById,
      writer,
      { directories: dataDirectories(dir), voiceBaseUrls: {} } as never,
    );
    expect(prepared.materials[0]?.kind).toBe("html");
    const html = await readFile(join(dir, "html-package", prepared.materials[0]!.file), "utf8");
    expect(html).not.toMatch(/<script\b/i);
    expect(html).toContain("../media/assets/");
  });

  it("writes a silent MP4 card when a renderer is available", async () => {
    if (silentMp4 === undefined) {
      return;
    }
    const content = validContentDocument();
    const writer = new PackageWriter(join(dir, "mp4-package"));
    const prepared = await prepareMaterials(
      profile({ id: "material-1", sceneId: "scene-intro", focus: true, format: "mp4", durationMs: 4000 }),
      content,
      resolveVisualTheme(content),
      assetById,
      writer,
      { directories: dataDirectories(dir), voiceBaseUrls: {} } as never,
      {
        renderMp4: async (input) => {
          await copyFile(silentMp4!, input.outputPath);
        },
      },
    );
    expect(prepared.materials[0]?.kind).toBe("video");
    expect(prepared.materials[0]?.hasAudio).toBe(false);
    const probe = await probeMedia(
      join(dir, "mp4-package", prepared.materials[0]!.file),
      "video",
      "video/mp4",
    );
    expect(probe.audioCodec).toBeNull();
    expect(probe.widthPx).toBe(1920);
    expect(probe.heightPx).toBe(1080);
  });
});
