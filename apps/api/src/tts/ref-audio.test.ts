import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wavFixture } from "../testing/tts-mocks.ts";
import { prepareRefAudioPath } from "./ref-audio.ts";
import type { DataDirectories } from "../storage/paths.ts";

const execFileAsync = promisify(execFile);

let root: string;
let directories: DataDirectories;
let ffmpegReady = false;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kakeai-ref-audio-"));
  directories = {
    root,
    db: join(root, "db"),
    assets: join(root, "assets"),
    artifacts: join(root, "artifacts"),
    compositions: join(root, "compositions"),
    tmp: join(root, "tmp"),
    agent: join(root, "agent"),
  };
  await writeFile(join(root, "source.wav"), wavFixture(2000, 440));
  await mkdir(join(root, "tmp"), { recursive: true });
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    ffmpegReady = true;
  } catch {
    ffmpegReady = false;
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("prepareRefAudioPath", () => {
  it("links wav audio with a .wav extension for extension-sniffing engines", async () => {
    const prepared = await prepareRefAudioPath(directories, "source.wav", "audio/wav");
    try {
      expect(prepared.path.endsWith(".wav")).toBe(true);
      expect(prepared.path.startsWith(directories.tmp)).toBe(true);
      const linked = await readFile(prepared.path);
      const source = await readFile(join(root, "source.wav"));
      expect(linked.equals(source)).toBe(true);
    } finally {
      await prepared.cleanup();
    }
    await expect(stat(prepared.path)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(root, "source.wav"))).resolves.toBeDefined();
  });

  it("links mp3 audio with a .mp3 extension", async () => {
    const prepared = await prepareRefAudioPath(directories, "source.wav", "audio/mpeg");
    try {
      expect(prepared.path.endsWith(".mp3")).toBe(true);
    } finally {
      await prepared.cleanup();
    }
  });

  it("transcodes engine-unsupported containers to wav", async () => {
    if (!ffmpegReady) {
      return;
    }
    const m4aPath = join(root, "source.m4a");
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:a",
      "aac",
      m4aPath,
    ]);
    const prepared = await prepareRefAudioPath(directories, "source.m4a", "audio/mp4");
    try {
      expect(prepared.path.endsWith(".wav")).toBe(true);
      const header = (await readFile(prepared.path)).subarray(0, 4).toString("ascii");
      expect(header).toBe("RIFF");
    } finally {
      await prepared.cleanup();
    }
  });
});
