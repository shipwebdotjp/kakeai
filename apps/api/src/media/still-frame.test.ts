import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ensureStillFramePngAtPts,
  resolveStillFramePtsMs,
  stillFrameCacheDir,
  stillFrameCacheFileName,
} from "./still-frame.ts";

const execFileAsync = promisify(execFile);

describe("still frame extraction", () => {
  let dir: string;
  let videoPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kakeai-still-"));
    videoPath = join(dir, "source.mp4");
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x120:rate=30",
      "-t",
      "2",
      "-pix_fmt",
      "yuv420p",
      videoPath,
    ]);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const source = () => ({ filePath: videoPath, sha256: "still-test-sha" });

  it("resolves the last frame PTS at or before the requested time", async () => {
    expect(await resolveStillFramePtsMs(source(), 1450)).toBe(1433);
    expect(await resolveStillFramePtsMs(source(), 1000)).toBe(1000);
  });

  it("clamps a request before the first frame to the first frame", async () => {
    const firstPts = await resolveStillFramePtsMs(source(), 0);
    expect(firstPts).toBeGreaterThanOrEqual(0);
    expect(firstPts).toBeLessThanOrEqual(200);
    expect(await resolveStillFramePtsMs(source(), firstPts)).toBe(firstPts);
  });

  it("writes a normalized PNG once and reuses it on the next call", async () => {
    const cacheDir = stillFrameCacheDir(dir);
    const first = await ensureStillFramePngAtPts(source(), 1400, cacheDir);
    expect(first).toBe(join(cacheDir, stillFrameCacheFileName("still-test-sha", 1400)));
    const info = await stat(first);
    expect(info.isFile()).toBe(true);
    expect(info.size).toBeGreaterThan(0);

    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      first,
    ]);
    expect(stdout.trim()).toBe("160,120");

    const second = await ensureStillFramePngAtPts(source(), 1400, cacheDir);
    expect(second).toBe(first);
  });

  it("extracts the clamped last frame when the request exceeds the duration", async () => {
    const cacheDir = stillFrameCacheDir(dir);
    const lastPts = await resolveStillFramePtsMs(source(), 9000);
    expect(lastPts).toBe(1967);
    const output = await ensureStillFramePngAtPts(source(), lastPts, cacheDir);
    const info = await stat(output);
    expect(info.isFile()).toBe(true);
    expect(info.size).toBeGreaterThan(0);
  });
});
