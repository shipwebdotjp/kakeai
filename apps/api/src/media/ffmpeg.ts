import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 30_000;
const TRANSCODE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export async function runFfprobe(filePath: string): Promise<unknown> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
    { timeout: PROBE_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
  );
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`ffprobe の出力を解釈できません: ${filePath}`);
  }
}

const FRAME_PTS_TIMEOUT_MS = 5 * 60 * 1000;

/** 映像ストリームのフレーム PTS（秒）を昇順で返す。 */
export async function runFfprobeFramePts(filePath: string): Promise<number[]> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "frame=pts_time",
      "-of",
      "csv=p=0",
      filePath,
    ],
    { timeout: FRAME_PTS_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
  );
  const pts: number[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed === "N/A") {
      continue;
    }
    const value = Number(trimmed);
    if (Number.isFinite(value)) {
      pts.push(value);
    }
  }
  pts.sort((a, b) => a - b);
  return pts;
}

export async function runFfmpeg(args: readonly string[]): Promise<void> {
  await execFileAsync("ffmpeg", ["-v", "error", "-nostdin", ...args], {
    timeout: TRANSCODE_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
}
