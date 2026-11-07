import { lstat, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";
import { LiveExportError } from "./errors";

function fail(message: string): never {
  throw new LiveExportError(
    "LIVE_EXPORT_OUTPUT_UNAVAILABLE",
    "output",
    message,
  );
}

/**
 * The output directory must not exist yet, and its parent must exist. Using a
 * non-existent target makes the final rename atomic and prevents deleting or
 * overwriting a directory that another process populated after validation.
 */
export async function assertUsableOutputDir(outDir: string): Promise<void> {
  if (!isAbsolute(outDir)) {
    fail("--out には絶対パスを指定してください。");
  }
  if (outDir.includes("\0") || basename(outDir).length === 0) {
    fail("--out のパスが不正です。");
  }
  const exists = await lstat(outDir).catch(() => null);
  if (exists !== null) {
    fail("--out には存在しないディレクトリを指定してください。");
  }
  const parent = await stat(dirname(outDir)).catch(() => null);
  if (parent === null || !parent.isDirectory()) {
    fail("--out の親ディレクトリが存在しません。");
  }
}
