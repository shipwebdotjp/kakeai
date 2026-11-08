import { readFile } from "node:fs/promises";
import {
  liveFixtureCommentsSchema,
  type LiveFixtureComment,
  type LivePackageShow,
  type LiveRuntimeConfig,
} from "@kakeai/contracts";
import {
  createYouTubeAuthProvider,
  OAuthYouTubeAuthProvider,
  type YouTubeAuthProvider,
} from "../auth/youtube-auth.ts";
import type { YouTubeAccessTokenProvider } from "../auth/youtube-token.ts";
import { resolveContainedPath } from "../package/paths.ts";
import { isLocalLlmEndpoint } from "../llm/local-endpoint.ts";
import { FixtureCommentSource } from "./fixture-source.ts";
import type { CommentSource, CommentSourceScheduler } from "./source.ts";
import { YouTubeCommentSource } from "./youtube-source.ts";

export interface CreateCommentSourceOptions {
  show: LivePackageShow;
  /** Validated package root; fixture paths are resolved inside it. */
  packageRoot: string;
  testMode?: boolean;
  config: LiveRuntimeConfig;
  /** Fully built auth provider; wins over `tokenProvider` and the config. */
  auth?: YouTubeAuthProvider;
  /** Test seam; wrapped as an OAuth auth provider. */
  tokenProvider?: YouTubeAccessTokenProvider;
  fetch?: typeof fetch;
  scheduler?: CommentSourceScheduler;
  now?: () => Date;
}

async function loadFixtureComments(
  show: LivePackageShow,
  packageRoot: string,
): Promise<LiveFixtureComment[]> {
  const relativePath = show.test?.fixture;
  if (relativePath === undefined) {
    return [];
  }
  const absolutePath = resolveContainedPath(packageRoot, relativePath);
  let text: string;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`fixture のコメントを読めません: ${relativePath}`, { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`fixture のコメントが JSON ではありません: ${relativePath}`);
  }
  const parsed = liveFixtureCommentsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`fixture のコメントが不正です: ${relativePath}`);
  }
  return parsed.data;
}

/**
 * Chooses the comment supply without leaking the choice into the runtime.
 * Test mode always uses the fixture and never contacts YouTube. A real
 * YouTube source is rejected when the LLM mode is not local.
 */
export async function createCommentSource(
  options: CreateCommentSourceOptions,
): Promise<CommentSource> {
  const { show, packageRoot, config } = options;
  const useFixture = options.testMode === true || show.commentSource.kind === "fixture";

  if (useFixture) {
    const comments = await loadFixtureComments(show, packageRoot);
    return new FixtureCommentSource({
      comments,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    });
  }

  if (!isLocalLlmEndpoint(config.llm)) {
    throw new Error(
      "実 YouTube の実行ではローカル LLM（mode: local かつループバック URL）を使ってください。外部 LLM は --test の fixture だけで使えます。",
    );
  }
  const youtube = config.youtube;
  if (youtube === undefined) {
    throw new Error(
      "実 YouTube の実行には設定の youtube（apiKey、または OAuth の clientId と clientSecret、および videoUrl または liveChatId）が必要です。",
    );
  }
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
