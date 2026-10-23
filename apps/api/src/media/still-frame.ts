import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runFfmpeg, runFfprobeFramePts } from "./ffmpeg.ts";

/**
 * 静止フレーム抽出の互換バージョン。抽出方法やPNG正規化を変えたら上げる。
 * キャッシュキー（renditionSha256 + 解決PTS + extractorVersion）に含める。
 */
export const STILL_FRAME_EXTRACTOR_VERSION = 1;

export interface StillFrameSource {
  filePath: string;
  /** rendition（またはAsset本体）の SHA-256。 */
  sha256: string;
}

const MAX_PTS_CACHE = 16;
const ptsCache = new Map<string, number[]>();

/** 目的 PTS の手前から入力シークする幅（ms）。GOP 長より十分大きく取る。 */
const SEEK_BACKOFF_MS = 2000;
/** select フィルタ閾値の余裕（ms）。フレーム間隔より十分小さく取る。 */
const SELECT_EPSILON_MS = 5;

async function framePtsList(source: StillFrameSource): Promise<number[]> {
  const cached = ptsCache.get(source.sha256);
  if (cached !== undefined) {
    return cached;
  }
  const pts = await runFfprobeFramePts(source.filePath);
  if (ptsCache.size >= MAX_PTS_CACHE) {
    const oldest = ptsCache.keys().next().value;
    if (oldest !== undefined) {
      ptsCache.delete(oldest);
    }
  }
  ptsCache.set(source.sha256, pts);
  return pts;
}

/**
 * sourceMs 以下で最後のフレーム PTS を返す（ms、整数）。
 * 先頭より前を指す場合は先頭フレームに丸める。
 */
export async function resolveStillFramePtsMs(
  source: StillFrameSource,
  sourceMs: number,
): Promise<number> {
  const pts = await framePtsList(source);
  const first = pts[0];
  if (first === undefined) {
    throw new Error("映像フレームを取得できません。");
  }
  const targetSec = sourceMs / 1000;
  let chosen = first;
  for (const value of pts) {
    if (value <= targetSec + 1e-6) {
      chosen = value;
    } else {
      break;
    }
  }
  return Math.round(chosen * 1000);
}

export function stillFrameCacheFileName(sha256: string, ptsMs: number): string {
  return `${sha256.slice(0, 24)}-${ptsMs}-v${STILL_FRAME_EXTRACTOR_VERSION}.png`;
}

/**
 * sourceMs に対応する正規化PNGをキャッシュへ用意し、そのパスを返す。
 * 既に同じキーのPNGがあれば再利用する。
 */
export async function ensureStillFramePng(
  source: StillFrameSource,
  sourceMs: number,
  cacheDir: string,
): Promise<string> {
  const ptsMs = await resolveStillFramePtsMs(source, sourceMs);
  return ensureStillFramePngAtPts(source, ptsMs, cacheDir);
}

/** 解決済み PTS(ms) から正規化PNGをキャッシュへ用意する。 */
export async function ensureStillFramePngAtPts(
  source: StillFrameSource,
  ptsMs: number,
  cacheDir: string,
): Promise<string> {
  const target = join(cacheDir, stillFrameCacheFileName(source.sha256, ptsMs));
  const existing = await stat(target).catch(() => null);
  if (existing !== null && existing.isFile()) {
    return target;
  }
  await extractStillFramePng(source, ptsMs, target);
  return target;
}

/** 解決済み PTS(ms) のフレームを指定パスへPNG抽出する。一時ファイルへ書いてから rename する。 */
export async function extractStillFramePng(
  source: StillFrameSource,
  ptsMs: number,
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    // 入力シーク（-ss を -i の前）を解決済み PTS ちょうどに置くと、その時刻より前の
    // フレームがすべて捨てられるため、末尾フレーム等では出力が0件になる。
    // その場合 ffmpeg は終了コード0でファイルを生成せず、後続の rename が
    // ENOENT で失敗する。少し手前からシークし、select フィルタで目的の
    // フレームを選び直す（入力シーク後はタイムスタンプがシーク起点になる）。
    const seekMs = Math.max(0, ptsMs - SEEK_BACKOFF_MS);
    const thresholdSec = (ptsMs - seekMs - SELECT_EPSILON_MS) / 1000;
    await runFfmpeg([
      "-ss",
      String(seekMs / 1000),
      "-i",
      source.filePath,
      "-vf",
      `select='gte(t,${thresholdSec})'`,
      "-frames:v",
      "1",
      "-f",
      "image2",
      "-c:v",
      "png",
      "-y",
      temporaryPath,
    ]);
    const produced = await stat(temporaryPath).catch(() => null);
    if (produced === null || !produced.isFile()) {
      throw new Error(`静止フレームを抽出できませんでした（ptsMs=${ptsMs}）。`);
    }
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function stillFrameCacheDir(tmpDir: string): string {
  return join(tmpDir, "still-frames");
}
