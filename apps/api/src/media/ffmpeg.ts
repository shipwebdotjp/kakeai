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

export async function runFfmpeg(args: readonly string[]): Promise<void> {
  await execFileAsync("ffmpeg", ["-v", "error", "-nostdin", ...args], {
    timeout: TRANSCODE_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
}
