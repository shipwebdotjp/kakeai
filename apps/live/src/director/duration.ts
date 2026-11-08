import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Reads the duration from a RIFF/WAVE header. Chunks are walked rather than
 * assuming a canonical 44-byte layout because TTS engines append metadata.
 */
export function wavDurationMs(data: Uint8Array): number | null {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (buffer.byteLength < 12) {
    return null;
  }
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let byteRate: number | null = null;
  let dataSize: number | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (id === "fmt " && payload + 16 <= buffer.byteLength) {
      byteRate = buffer.readUInt32LE(payload + 8);
      if (byteRate <= 0) {
        byteRate = null;
      }
    }
    if (id === "data") {
      dataSize =
        size === 0xffffffff || payload + size > buffer.byteLength
          ? buffer.byteLength - payload
          : size;
      break;
    }
    offset = payload + size + (size % 2);
  }
  if (byteRate === null || dataSize === null || dataSize <= 0) {
    return null;
  }
  return Math.round((dataSize / byteRate) * 1000);
}

/** Best-effort MP3 duration. Returns null when ffprobe is unavailable. */
export async function probeMp3DurationMs(path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
      { timeout: 5_000 },
    );
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
  } catch {
    return null;
  }
}

/** Deliberately slow estimate so a missing probe does not cut speech short. */
export function estimateSpeechDurationMs(text: string): number {
  return Math.max(1_000, Math.ceil(text.length * 200) + 500);
}
