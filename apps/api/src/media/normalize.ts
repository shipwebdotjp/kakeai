import type { AssetKindName } from "@kakeai/contracts";
import { runFfmpeg } from "./ffmpeg.ts";

export async function createRendition(
  inputPath: string,
  outputPath: string,
  kind: AssetKindName,
): Promise<void> {
  // Do not pass -autorotate: FFmpeg 6.x treats the bare boolean option as
  // taking a value, while newer versions reject a value. Autorotation is on
  // by default, so omitting it is portable across both versions.
  if (kind === "image") {
    await runFfmpeg([
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-map_metadata",
      "-1",
      "-y",
      outputPath,
    ]);
    return;
  }
  if (kind === "video") {
    await runFfmpeg([
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-fps_mode",
      "cfr",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ]);
    return;
  }
  await runFfmpeg(["-i", inputPath, "-vn", "-c:a", "pcm_s16le", "-y", outputPath]);
}
