import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  liveFixtureCommentsSchema,
  type LiveRunConfigSource,
  type LiveRunSource,
  type LiveRunSourceInput,
} from "@kakeai/contracts";
import { ApiError } from "../http/errors.ts";

export interface PreparedRunSource {
  stored: LiveRunSource;
  config: LiveRunConfigSource;
}

function invalidFixture(message: string): never {
  throw new ApiError(422, "LIVE_RUN_FIXTURE_INVALID", message);
}

const MAX_FIXTURE_BYTES = 10 * 1024 * 1024;

/**
 * Kakeai is a local-only desktop app, so fixture paths are not confined to the
 * data root. They must still be a regular file of bounded size: a directory or
 * a 10GB file must fail as a 422, not hang or 500. The bytes are read once and
 * then validated, written and hashed from that same buffer, so a file changed
 * between the size check and the copy cannot slip unvalidated bytes through.
 */
async function readFixtureBytes(path: string): Promise<Buffer> {
  let info;
  try {
    // Follow symlinks: a fixture symlink to a regular file is usable, while a
    // symlink to a directory or device still fails the regular-file check.
    info = await stat(path);
  } catch (error) {
    invalidFixture(
      `fixture ファイルを読めません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!info.isFile()) {
    invalidFixture("fixture には通常ファイルを指定してください。");
  }
  if (info.size > MAX_FIXTURE_BYTES) {
    invalidFixture(
      `fixture ファイルが大きすぎます（上限 ${MAX_FIXTURE_BYTES} バイト）: ${path}`,
    );
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    invalidFixture(
      `fixture ファイルを読めません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // The file may have grown between stat and read; enforce the cap again.
  if (bytes.byteLength > MAX_FIXTURE_BYTES) {
    invalidFixture(
      `fixture ファイルが大きすぎます（上限 ${MAX_FIXTURE_BYTES} バイト）: ${path}`,
    );
  }
  return bytes;
}

function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Copies a fixture into the Run directory at creation. The Program, version and
 * package remain untouched; the Run records the hash of the copied bytes.
 */
export async function prepareRunSource(
  input: LiveRunSourceInput,
  runDir: string,
): Promise<PreparedRunSource> {
  if (input.kind === "youtube") {
    const stored: LiveRunSource = {
      kind: "youtube",
      videoUrl: input.videoUrl ?? null,
      liveChatId: input.liveChatId ?? null,
    };
    return { stored, config: stored };
  }

  const fixtureDir = join(runDir, "fixtures");
  await mkdir(fixtureDir, { recursive: true });
  const destination = join(fixtureDir, "comments.json");

  let bytes: Buffer;
  if (input.fixturePath !== undefined) {
    const sourceBytes = await readFixtureBytes(input.fixturePath);
    let raw: unknown;
    try {
      raw = JSON.parse(sourceBytes.toString("utf8")) as unknown;
    } catch {
      invalidFixture("fixture ファイルが JSON ではありません。");
    }
    const parsed = liveFixtureCommentsSchema.safeParse(raw);
    if (!parsed.success) {
      invalidFixture("fixture ファイルがコメント契約に一致しません。");
    }
    // Write the validated bytes, not a second read of the source path.
    bytes = sourceBytes;
  } else {
    const parsed = liveFixtureCommentsSchema.safeParse(input.comments ?? []);
    if (!parsed.success) {
      invalidFixture("fixture コメントが契約に一致しません。");
    }
    bytes = Buffer.from(`${JSON.stringify(parsed.data, null, 2)}\n`, "utf8");
  }

  try {
    await writeFile(destination, bytes, { mode: 0o600 });
    await chmod(destination, 0o600);
  } catch (error) {
    invalidFixture(
      `fixture を Run ディレクトリへコピーできません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const digest = sha256Of(bytes);
  const stored: LiveRunSource = {
    kind: "fixture",
    fixtureFile: "fixtures/comments.json",
    fixtureSha256: digest,
  };
  return {
    stored,
    config: {
      kind: "fixture",
      fixturePath: destination,
      fixtureSha256: digest,
    },
  };
}
