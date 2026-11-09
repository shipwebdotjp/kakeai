import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  liveFixtureCommentsSchema,
  type CommentSourceKind,
  type LiveFixtureComment,
  type LiveRunConfig,
  type LiveRuntimeConfig,
  type LiveYouTubeConfig,
} from "@kakeai/contracts";
import {
  createYouTubeAuthProvider,
  OAuthYouTubeAuthProvider,
  type YouTubeAuthProvider,
} from "../auth/youtube-auth.ts";
import type { YouTubeAccessTokenProvider } from "../auth/youtube-token.ts";
import { isLocalLlmEndpoint } from "../llm/local-endpoint.ts";
import { FixtureCommentSource } from "./fixture-source.ts";
import type { CommentSource, CommentSourceScheduler } from "./source.ts";
import { YouTubeCommentSource } from "./youtube-source.ts";

export interface CreateCommentSourceOptions {
  /** v2 Run config. Comment source and fixture only come from the Run. */
  runConfig: LiveRunConfig;
  config: LiveRuntimeConfig;
  /** Fully built auth provider; wins over `tokenProvider` and the config. */
  auth?: YouTubeAuthProvider;
  /** Test seam; wrapped as an OAuth auth provider. */
  tokenProvider?: YouTubeAccessTokenProvider;
  fetch?: typeof fetch;
  scheduler?: CommentSourceScheduler;
  now?: () => Date;
  /** Test seam; production reads the fixture file from disk. */
  readFixtureBytes?: (absolutePath: string) => Promise<Uint8Array>;
}

interface FixtureFile {
  comments: LiveFixtureComment[];
  sha256: string;
}

const MAX_FIXTURE_BYTES = 10 * 1024 * 1024;

async function readFixtureFile(
  absolutePath: string,
  label: string,
  readBytes: (absolutePath: string) => Promise<Uint8Array>,
): Promise<FixtureFile> {
  let bytes: Uint8Array;
  try {
    bytes = await readBytes(absolutePath);
  } catch (error) {
    throw new Error(`fixture のコメントを読めません: ${label}`, { cause: error });
  }
  if (bytes.byteLength > MAX_FIXTURE_BYTES) {
    throw new Error(
      `fixture のコメントが大きすぎます（上限 ${MAX_FIXTURE_BYTES} バイト）: ${label}`,
    );
  }
  // Hash and parse the bytes from this single read. Hashing the path first and
  // reading it again would let the file change between the two (TOCTOU).
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error(`fixture のコメントが JSON ではありません: ${label}`);
  }
  const parsed = liveFixtureCommentsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`fixture のコメントが不正です: ${label}`);
  }
  return { comments: parsed.data, sha256 };
}

/** The effective comment source always comes from the Live Run config. */
export function resolveCommentSourceKind(
  runConfig: LiveRunConfig,
): CommentSourceKind {
  return runConfig.source.kind;
}

/**
 * The Run is authoritative for the YouTube target. Only credentials may come
 * from the local config; local videoUrl/liveChatId must never fill in a Run
 * that explicitly left them null.
 */
function youtubeConfigFor(
  config: LiveRuntimeConfig,
  runConfig: LiveRunConfig,
): LiveYouTubeConfig {
  // Missing auth is reported by createYouTubeAuthProvider so every path keeps
  // the same message.
  const local = config.youtube ?? {};
  const source = runConfig.source;
  if (source.kind !== "youtube") {
    return {};
  }
  return {
    ...(local.apiKey === undefined ? {} : { apiKey: local.apiKey }),
    ...(local.clientId === undefined ? {} : { clientId: local.clientId }),
    ...(local.clientSecret === undefined ? {} : { clientSecret: local.clientSecret }),
    ...(source.videoUrl === null ? {} : { videoUrl: source.videoUrl }),
    ...(source.liveChatId === null ? {} : { liveChatId: source.liveChatId }),
  };
}

/**
 * Chooses the comment supply without leaking the choice into the runtime.
 * A fixture source never contacts YouTube. A real YouTube source is rejected
 * when the LLM mode is not local.
 */
export async function createCommentSource(
  options: CreateCommentSourceOptions,
): Promise<CommentSource> {
  const { runConfig, config } = options;
  const sourceKind = resolveCommentSourceKind(runConfig);

  if (sourceKind === "fixture") {
    if (runConfig.source.kind !== "fixture") {
      throw new Error("fixture の Run 設定がありません。");
    }
    const fixture = runConfig.source;
    const file = await readFixtureFile(
      fixture.fixturePath,
      fixture.fixturePath,
      options.readFixtureBytes ?? readFile,
    );
    if (file.sha256 !== fixture.fixtureSha256) {
      throw new Error("fixture の SHA-256 が Run の記録と一致しません。");
    }
    return new FixtureCommentSource({
      comments: file.comments,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    });
  }

  if (!isLocalLlmEndpoint(config.llm)) {
    throw new Error(
      "実 YouTube の実行ではローカル LLM（mode: local かつループバック URL）を使ってください。外部 LLM は fixture の Run 設定だけで使えます。",
    );
  }
  const youtube = youtubeConfigFor(config, runConfig);
  if (youtube.videoUrl === undefined && youtube.liveChatId === undefined) {
    throw new Error("youtube 設定に videoUrl または liveChatId を指定してください。");
  }

  const auth =
    options.auth ??
    (options.tokenProvider !== undefined
      ? new OAuthYouTubeAuthProvider(options.tokenProvider)
      : await createYouTubeAuthProvider({
          ...(youtube.apiKey === undefined ? {} : { apiKey: youtube.apiKey }),
          ...(youtube.clientId === undefined ? {} : { clientId: youtube.clientId }),
          ...(youtube.clientSecret === undefined ? {} : { clientSecret: youtube.clientSecret }),
          dataDir: config.dataDir,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          ...(options.now === undefined ? {} : { now: options.now }),
        }));

  return new YouTubeCommentSource({
    auth,
    ...(youtube.liveChatId === undefined ? {} : { liveChatId: youtube.liveChatId }),
    ...(youtube.videoUrl === undefined ? {} : { videoUrl: youtube.videoUrl }),
    ...(youtube.pollingIntervalMs === undefined
      ? {}
      : { pollingIntervalMs: youtube.pollingIntervalMs }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
