import { randomUUID } from "node:crypto";
import { copyFile, link, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveStoragePath } from "../storage/asset-store.ts";
import { runFfmpeg } from "../media/ffmpeg.ts";
import type { DataDirectories } from "../storage/paths.ts";

/**
 * miniaudio が拡張子で直接読めるメディア型とその拡張子。
 * mlx-audio の参照音声読み取りは拡張子で形式を判定するため、
 * 拡張子のない Asset ストアパスはそのままでは渡せない。
 */
const DIRECT_EXTENSIONS: Record<string, string> = {
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/ogg": ".ogg",
};

export interface PreparedRefAudio {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * エンジンへ渡す参照音声パスを用意する。直接読める形式は tmp へ
 * 拡張子付きのハードリンク（失敗時はコピー）を作り、それ以外は
 * WAV へ変換した実体を作る。呼び出し側は利用後に cleanup を呼ぶ。
 */
export async function prepareRefAudioPath(
  directories: DataDirectories,
  storageKey: string,
  mediaType: string,
): Promise<PreparedRefAudio> {
  const source = resolveStoragePath(directories, storageKey);
  const direct = DIRECT_EXTENSIONS[mediaType];
  if (direct !== undefined) {
    const target = join(directories.tmp, `tts-ref-${randomUUID()}${direct}`);
    try {
      await link(source, target);
    } catch {
      await copyFile(source, target);
    }
    return { path: target, cleanup: () => rm(target, { force: true }) };
  }
  const target = join(directories.tmp, `tts-ref-${randomUUID()}.wav`);
  await runFfmpeg(["-i", source, "-vn", "-map", "0:a:0", "-c:a", "pcm_s16le", target]);
  return { path: target, cleanup: () => rm(target, { force: true }) };
}
