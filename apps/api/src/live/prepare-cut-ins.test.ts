import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { LiveShowProfile } from "@kakeai/contracts";
import { probeMedia } from "../media/probe.ts";
import { dataDirectories } from "../storage/paths.ts";
import { LiveExportError } from "./errors";
import { PackageWriter } from "./package-writer";
import type { ResolvedAssetFile, ResolvedCutIn } from "./profile-resolution";
import { prepareCutIns } from "./prepare-cut-ins";

const execFileAsync = promisify(execFile);

function profile(
  cutIns: LiveShowProfile["cutIns"],
  referencedIds: string[],
): LiveShowProfile {
  return {
    schemaVersion: 1,
    cutIns,
    show: {
      title: "CutIn テスト",
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
      ...referencedIds.map((cutInId, index) => ({
        id: `seg-cut-${index}`,
        kind: "cut_in" as const,
        label: "区切り",
        cutInId,
      })),
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
    materials: [],
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

function resolvedCutIns(entries: Array<{ id: string; assetId: string }>): ResolvedCutIn[] {
  return entries.map((entry) => ({ id: entry.id, assetId: entry.assetId }));
}

function resolvedAsset(input: {
  assetId: string;
  path: string;
  kind?: "video" | "audio";
  mediaType?: string;
  durationMs?: number | null;
  widthPx?: number | null;
  heightPx?: number | null;
  hasAudio?: boolean;
}): ResolvedAssetFile {
  return {
    assetId: input.assetId,
    path: input.path,
    kind: input.kind ?? "video",
    mediaType: input.mediaType ?? "video/mp4",
    sha256: "a".repeat(64),
    byteSize: 1,
    durationMs: input.durationMs ?? null,
    widthPx: input.widthPx ?? null,
    heightPx: input.heightPx ?? null,
    hasAudio: input.hasAudio ?? false,
  };
}

let dir: string;
let config: { directories: ReturnType<typeof dataDirectories> };
let silentMp4: string | undefined;
let audioMp4: string | undefined;
let mpeg4Mp4: string | undefined;

async function makeVideo(
  fileName: string,
  codec: "libx264" | "mpeg4",
  withAudio: boolean,
): Promise<string> {
  const output = join(dir, fileName);
  const args = ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30"];
  if (withAudio) {
    args.push("-f", "lavfi", "-i", "sine=frequency=440:duration=1.5");
  }
  args.push("-t", "1.5", "-c:v", codec);
  if (codec === "libx264") {
    args.push("-pix_fmt", "yuv420p");
  }
  if (withAudio) {
    args.push("-c:a", "aac", "-shortest");
  } else {
    args.push("-an");
  }
  args.push("-movflags", "+faststart", "-y", output);
  await execFileAsync("ffmpeg", args);
  return output;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "kakeai-cutins-"));
  const directories = dataDirectories(dir);
  await mkdir(directories.tmp, { recursive: true });
  config = { directories };
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    silentMp4 = await makeVideo("silent.mp4", "libx264", false);
    audioMp4 = await makeVideo("audio.mp4", "libx264", true);
    mpeg4Mp4 = await makeVideo("mpeg4.mp4", "mpeg4", false);
  } catch {
    silentMp4 = undefined;
    audioMp4 = undefined;
    mpeg4Mp4 = undefined;
  }
}, 60000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function newWriter(name: string): PackageWriter {
  return new PackageWriter(join(dir, `package-${name}`));
}

describe("prepareCutIns", () => {
  it("marks silent and audio MP4s from probe results", async () => {
    if (silentMp4 === undefined || audioMp4 === undefined) return;
    const silent = resolvedAsset({
      assetId: "asset-silent",
      path: silentMp4,
      durationMs: 1500,
    });
    const audio = resolvedAsset({
      assetId: "asset-audio",
      path: audioMp4,
      durationMs: 1500,
      hasAudio: true,
    });
    const writer = newWriter("audio");
    const prepared = await prepareCutIns(
      profile(
        [
          { id: "silent", assetId: "asset-silent" },
          { id: "audio", assetId: "asset-audio" },
        ],
        ["silent", "audio"],
      ),
      resolvedCutIns([
        { id: "silent", assetId: "asset-silent" },
        { id: "audio", assetId: "asset-audio" },
      ]),
      new Map([
        ["asset-silent", silent],
        ["asset-audio", audio],
      ]),
      writer,
      config as never,
    );

    expect(prepared.warnings).toEqual([]);
    expect(prepared.cutIns.map((cutIn) => cutIn.id)).toEqual(["silent", "audio"]);
    const byId = new Map(prepared.cutIns.map((cutIn) => [cutIn.id, cutIn]));
    expect(byId.get("silent")?.hasAudio).toBe(false);
    expect(byId.get("audio")?.hasAudio).toBe(true);

    for (const cutIn of prepared.cutIns) {
      const facts = await probeMedia(
        writer.resolvePath(cutIn.file),
        "video",
        "video/mp4",
      );
      expect(cutIn.durationMs).toBe(facts.durationMs);
      expect(cutIn.width).toBe(facts.widthPx);
      expect(cutIn.height).toBe(facts.heightPx);
      expect(cutIn.hasAudio).toBe(facts.audioCodec !== null);
    }

    const cutInFiles = writer.fileList().filter((file) => file.kind === "cut-in");
    expect(cutInFiles).toHaveLength(2);
    expect(cutInFiles.every((file) => file.mediaType === "video/mp4")).toBe(true);
    expect(cutInFiles.every((file) => file.durationMs !== null && file.durationMs > 0)).toBe(
      true,
    );
  });

  it("normalizes a non-H.264 source to H.264 MP4", async () => {
    if (mpeg4Mp4 === undefined) return;
    const source = resolvedAsset({ assetId: "asset-mpeg4", path: mpeg4Mp4 });
    const writer = newWriter("normalized");
    const prepared = await prepareCutIns(
      profile([{ id: "converted", assetId: "asset-mpeg4" }], ["converted"]),
      resolvedCutIns([{ id: "converted", assetId: "asset-mpeg4" }]),
      new Map([["asset-mpeg4", source]]),
      writer,
      config as never,
    );

    expect(prepared.cutIns).toHaveLength(1);
    const cutIn = prepared.cutIns[0]!;
    const facts = await probeMedia(
      writer.resolvePath(cutIn.file),
      "video",
      "video/mp4",
    );
    expect(facts.codec).toBe("h264");
    expect(cutIn.durationMs).toBe(facts.durationMs);
    expect(cutIn.hasAudio).toBe(false);
    expect(writer.fileList().find((file) => file.path === cutIn.file)?.kind).toBe(
      "cut-in",
    );
  });

  it("warns and uses the probe duration when the DB duration differs", async () => {
    if (silentMp4 === undefined) return;
    const probed = await probeMedia(silentMp4, "video", "video/mp4");
    expect(probed.durationMs).not.toBeNull();
    const dbDuration = (probed.durationMs ?? 0) + 1000;
    const source = resolvedAsset({
      assetId: "asset-drift",
      path: silentMp4,
      durationMs: dbDuration,
    });
    const writer = newWriter("drift");
    const prepared = await prepareCutIns(
      profile([{ id: "drift", assetId: "asset-drift" }], ["drift"]),
      resolvedCutIns([{ id: "drift", assetId: "asset-drift" }]),
      new Map([["asset-drift", source]]),
      writer,
      config as never,
    );

    expect(prepared.warnings).toHaveLength(1);
    expect(prepared.cutIns[0]?.durationMs).not.toBe(dbDuration);
    expect(prepared.cutIns[0]?.durationMs).toBe(probed.durationMs);
  });

  it("exports only referenced CutIns and deduplicates a shared Asset", async () => {
    if (silentMp4 === undefined || audioMp4 === undefined) return;
    const shared = resolvedAsset({
      assetId: "asset-shared",
      path: silentMp4,
      durationMs: 1500,
    });
    const unused = resolvedAsset({
      assetId: "asset-unused",
      path: audioMp4,
      durationMs: 1500,
      hasAudio: true,
    });
    const writer = newWriter("referenced");
    const prepared = await prepareCutIns(
      profile(
        [
          { id: "first", assetId: "asset-shared" },
          { id: "second", assetId: "asset-shared" },
          { id: "unused", assetId: "asset-unused" },
        ],
        ["first", "second"],
      ),
      resolvedCutIns([
        { id: "first", assetId: "asset-shared" },
        { id: "second", assetId: "asset-shared" },
        { id: "unused", assetId: "asset-unused" },
      ]),
      new Map([
        ["asset-shared", shared],
        ["asset-unused", unused],
      ]),
      writer,
      config as never,
    );

    expect(prepared.cutIns.map((cutIn) => cutIn.id)).toEqual(["first", "second"]);
    expect(prepared.cutIns[0]?.file).toBe(prepared.cutIns[1]?.file);
    expect(writer.fileList().filter((file) => file.kind === "cut-in")).toHaveLength(1);
  });

  it("fails for a missing or wrong-kind asset", async () => {
    const writer = newWriter("invalid");
    await expect(
      prepareCutIns(
        profile([{ id: "missing", assetId: "asset-missing" }], ["missing"]),
        resolvedCutIns([{ id: "missing", assetId: "asset-missing" }]),
        new Map(),
        writer,
        config as never,
      ),
    ).rejects.toMatchObject({ errorCode: "LIVE_EXPORT_CUT_IN_FAILED" });

    const audio = resolvedAsset({
      assetId: "asset-audio-kind",
      path: silentMp4 ?? join(dir, "unused.mp4"),
      kind: "audio",
      mediaType: "audio/wav",
    });
    await expect(
      prepareCutIns(
        profile([{ id: "wrong", assetId: "asset-audio-kind" }], ["wrong"]),
        resolvedCutIns([{ id: "wrong", assetId: "asset-audio-kind" }]),
        new Map([["asset-audio-kind", audio]]),
        newWriter("wrong-kind"),
        config as never,
      ),
    ).rejects.toMatchObject({ errorCode: "LIVE_EXPORT_CUT_IN_FAILED" });
  });

  it("surfaces writer and rendition failures as material CutIn failures", async () => {
    if (silentMp4 === undefined) return;
    const source = resolvedAsset({ assetId: "asset-writer", path: silentMp4 });
    const failingWriter = {
      writeAsset: async () => {
        throw new LiveExportError("LIVE_EXPORT_FAILED", "output", "ディスクがいっぱいです");
      },
    } as unknown as PackageWriter;
    const writerError = await prepareCutIns(
      profile([{ id: "writer", assetId: "asset-writer" }], ["writer"]),
      resolvedCutIns([{ id: "writer", assetId: "asset-writer" }]),
      new Map([["asset-writer", source]]),
      failingWriter,
      config as never,
    ).catch((caught: unknown) => caught);

    expect(writerError).toBeInstanceOf(LiveExportError);
    expect((writerError as LiveExportError).errorCode).toBe("LIVE_EXPORT_CUT_IN_FAILED");
    expect((writerError as LiveExportError).failure.stage).toBe("material");
    expect((writerError as LiveExportError).failure.id).toBe("writer");
    expect((writerError as LiveExportError).failure.message).toContain("ディスクがいっぱいです");

    const notPlayable = resolvedAsset({
      assetId: "asset-rendition",
      path: silentMp4,
      mediaType: "video/quicktime",
    });
    const renditionError = await prepareCutIns(
      profile([{ id: "rendition", assetId: "asset-rendition" }], ["rendition"]),
      resolvedCutIns([{ id: "rendition", assetId: "asset-rendition" }]),
      new Map([["asset-rendition", notPlayable]]),
      newWriter("rendition-failure"),
      config as never,
      {
        createRendition: async () => {
          throw new Error("encoder exploded");
        },
      },
    ).catch((caught: unknown) => caught);

    expect(renditionError).toBeInstanceOf(LiveExportError);
    expect((renditionError as LiveExportError).errorCode).toBe("LIVE_EXPORT_CUT_IN_FAILED");
    expect((renditionError as LiveExportError).failure.stage).toBe("material");
    expect((renditionError as LiveExportError).failure.message).toContain("encoder exploded");
  });

  it("honours cancellation between CutIns", async () => {
    if (silentMp4 === undefined) return;
    const source = resolvedAsset({ assetId: "asset-cancel", path: silentMp4 });
    const error = await prepareCutIns(
      profile([{ id: "cancel", assetId: "asset-cancel" }], ["cancel"]),
      resolvedCutIns([{ id: "cancel", assetId: "asset-cancel" }]),
      new Map([["asset-cancel", source]]),
      newWriter("cancel"),
      config as never,
      { isCancelled: async () => true },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LiveExportError);
    expect((error as LiveExportError).errorCode).toBe("LIVE_EXPORT_FAILED");
  });
});
