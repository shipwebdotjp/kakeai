import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import type { Duplex } from "node:stream";
import type {
  CommentSourceKind,
  LiveRunConfig,
  LiveRunFailure,
  LiveRuntimeConfig,
} from "@kakeai/contracts";
import type { Express } from "express";
import { CommentFilter } from "../comments/filter.ts";
import { createCommentSource } from "../comments/factory.ts";
import { createDirector, type Director } from "../director/director.ts";
import { GeneratedCueService } from "../director/generation-service.ts";
import {
  DirectorResponder,
  type DirectorResponseHost,
} from "../director/response-responder.ts";
import { createCommentAnalyst } from "../llm/comment-analyst.ts";
import type { LoadedLivePackage } from "../package/loader.ts";
import { CommentCorner } from "../runtime/comment-corner.ts";
import type { CommentCornerResponder } from "../runtime/comment-responder.ts";
import { LiveController } from "../runtime/controller.ts";
import { DirectorRuntime } from "../runtime/director-runtime.ts";
import { RunStore, type RunLogEventInput } from "../runs/run-store.ts";
import { createLiveApp } from "./app.ts";
import { LOCAL_BIND_ADDRESS } from "./security.ts";
import { LiveSocketHub } from "./websocket.ts";

export interface CreateLiveServerOptions {
  package: LoadedLivePackage;
  config: LiveRuntimeConfig;
  /** v2 Run config; also supplies the effective comment source and startAt. */
  runConfig?: LiveRunConfig;
  /** One-time control token. Omit to disable /control (manual runs). */
  controlToken?: string;
  onStopRequested?: () => void;
  failure?: () => LiveRunFailure | null;
  /** Overrides config.port; 0 asks the OS for a free port (tests). */
  port?: number;
  /** Defaults to apps/live/dist; tests point this at a temp build. */
  distDir?: string;
  runStore?: RunStore;
  now?: () => Date;
  leaseTtlMs?: number;
  /** Tests inject a prepared corner with a fake source and analyst. */
  commentCorner?: CommentCorner;
  /** Tests inject a director without changing the rest of the wiring. */
  director?: Director;
  /** Tests replace the whole response responder (no director runtime then). */
  responder?: CommentCornerResponder;
}

export interface LiveServer {
  url: string;
  port: number;
  close(): Promise<void>;
  controller: LiveController;
  app: Express;
  runStore: RunStore;
  /** Present when the default generated-response wiring was built. */
  directorRuntime: DirectorRuntime | null;
}

const DEFAULT_DIST_DIR = resolve(import.meta.dirname, "..", "..", "dist");

async function listen(server: HttpServer, port: number): Promise<number> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      rejectPromise(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolvePromise();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, LOCAL_BIND_ADDRESS);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("ライブサーバのポートを取得できません。");
  }
  return address.port;
}

interface CommentCornerBuild {
  corner: CommentCorner;
  responder: CommentCornerResponder;
  director: Director | null;
  /** False when a test supplied its own responder; no runtime is needed. */
  ownsResponder: boolean;
}

async function buildCommentCorner(
  options: CreateLiveServerOptions,
  hooks: {
    log: (input: RunLogEventInput) => void;
    appendComment: (entry: Record<string, unknown>) => void;
    runDir: string;
    host: () => DirectorResponseHost | null;
  },
): Promise<CommentCornerBuild> {
  const runConfig = options.runConfig;
  if (runConfig === undefined) {
    throw new Error("コメントソースを使うには Run 設定が必要です。");
  }
  const show = options.package.show;
  const source = await createCommentSource({
    runConfig,
    config: options.config,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const analyst = createCommentAnalyst({
    llm: options.config.llm,
    sourceKind: source.getStatus().kind,
    commentsConfig: options.config.comments,
  });
  const filter = new CommentFilter({
    ngWords: options.config.comments.ngWords,
    blockedTopics: show.safety.blockedTopics,
    maxLength: options.config.comments.maxLength,
    maxPerAuthorPerMinute: options.config.comments.maxPerAuthorPerMinute,
  });
  const sourceKind = source.getStatus().kind;
  const fallbackCue = show.cues.find((cue) => cue.id === show.safety.fallbackCueId);
  if (fallbackCue === undefined) {
    throw new Error(`退避キューが見つかりません: ${show.safety.fallbackCueId}`);
  }
  const ownsResponder = options.responder === undefined;
  let responder: CommentCornerResponder;
  let director: Director | null = options.director ?? null;
  if (options.responder !== undefined) {
    responder = options.responder;
  } else {
    director =
      options.director ??
      createDirector({
        llm: options.config.llm,
        sourceKind,
      });
    responder = new DirectorResponder({
      director,
      config: options.config,
      show,
      packageRoot: options.package.rootDir,
      runDir: hooks.runDir,
      fallbackCue,
      host: hooks.host,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }
  const corner = new CommentCorner({
    source,
    analyst,
    filter,
    commentsConfig: options.config.comments,
    policy: show.commentPolicy,
    safety: show.safety,
    ...(options.now === undefined ? {} : { now: options.now }),
    responder,
    log: hooks.log,
    appendComment: hooks.appendComment,
  });
  return { corner, responder, director, ownsResponder };
}

/**
 * Starts the loopback-only live server. The Kakeai API is not involved: the
 * immutable package, the run directory and the local config are the only
 * inputs.
 */
export async function createLiveServer(
  options: CreateLiveServerOptions,
): Promise<LiveServer> {
  const runStore =
    options.runStore ??
    (await RunStore.create({
      dataDir: options.config.dataDir,
      showTitle: options.package.show.show.title,
      packageId: options.package.manifest.packageId,
      packagePath: options.package.rootDir,
      ...(options.now === undefined ? {} : { now: options.now }),
    }));
  const controllerHolder: { current: LiveController | null } = { current: null };
  const directorRuntimeHolder: { current: DirectorResponseHost | null } = { current: null };
  let commentCorner = options.commentCorner;
  let build: CommentCornerBuild | null = null;
  if (commentCorner === undefined) {
    try {
      build = await buildCommentCorner(options, {
        log: (input) => controllerHolder.current?.recordEvent(input),
        appendComment: (entry) => runStore.appendComment(entry),
        runDir: runStore.dir,
        host: () => directorRuntimeHolder.current,
      });
      commentCorner = build.corner;
    } catch (error) {
      await runStore.finish({ status: "failed", phase: "pre_show" });
      throw error;
    }
  }
  const startAt = options.runConfig?.startAt ?? null;
  // A v2 Run always has a run config. When a test injects a prepared corner,
  // derive the source kind from that corner instead of silently assuming
  // YouTube. Without either there is nothing to start.
  const commentSourceKind: CommentSourceKind =
    options.runConfig?.source.kind ??
    commentCorner?.getSnapshot().source.kind ??
    (() => {
      throw new Error("コメントソースを決めるには Run 設定が必要です。");
    })();
  const controller = new LiveController({
    runId: runStore.runId,
    show: options.package.show,
    characters: options.package.characters,
    startAt,
    commentSourceKind,
    runStore,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.leaseTtlMs === undefined ? {} : { leaseTtlMs: options.leaseTtlMs }),
    ...(commentCorner === undefined ? {} : { comments: commentCorner }),
  });
  controllerHolder.current = controller;

  let directorRuntime: DirectorRuntime | null = null;
  if (
    build !== null &&
    build.ownsResponder &&
    build.director !== null &&
    commentCorner !== undefined
  ) {
    directorRuntime = new DirectorRuntime({
      controller,
      runStore,
      show: options.package.show,
      characters: options.package.characters,
      comments: commentCorner,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    directorRuntimeHolder.current = directorRuntime;
    const runtime = directorRuntime;
    controller.setGeneratedCueCommands(
      new GeneratedCueService({
        show: options.package.show,
        config: options.config,
        packageRoot: options.package.rootDir,
        runDir: runStore.dir,
        director: build.director,
        host: {
          getCue: (cueId) => controller.getCue(cueId),
          updateCue: (cueId, patch) => controller.updateCue(cueId, patch),
          setGeneration: (status) => controller.setGeneration(status),
          log: (input) => {
            controller.recordEvent(input);
            const message = input.data?.message;
            if (input.type === "error" && typeof message === "string") {
              runStore.appendError(message);
            }
          },
          notice: (level, message) => controller.notify(level, message),
          appendGeneratedText: (entry) => runStore.appendGeneratedText(entry),
          contextFor: (candidate) => runtime.contextFor(candidate),
          candidateFor: (commentId) => commentCorner?.getCandidate(commentId) ?? null,
        },
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    );
  }

  const httpServer = createServer();
  // Serve an explicit 503 until the app needs the actual port. Without these
  // placeholders a connection during startup would have no handler and hang.
  const startingHandler = (_req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = 503;
    res.setHeader("Connection", "close");
    res.end("starting");
  };
  const startingUpgrade = (_req: IncomingMessage, socket: Duplex) => {
    socket.destroy();
  };
  httpServer.on("request", startingHandler);
  httpServer.on("upgrade", startingUpgrade);
  const requestedPort = options.port ?? options.config.port;
  const actualPort = await listen(httpServer, requestedPort);
  const startedAt = new Date().toISOString();
  let stopping = false;
  const url = `http://127.0.0.1:${actualPort}`;
  const app = createLiveApp({
    loaded: options.package,
    distDir: options.distDir ?? DEFAULT_DIST_DIR,
    port: actualPort,
    runDir: runStore.dir,
    ...(options.controlToken === undefined
      ? {}
      : {
          control: {
            token: options.controlToken,
            runId: runStore.runId,
            stageUrl: `${url}/stage`,
            consoleUrl: `${url}/console`,
            startedAt,
            lifecycle: () => controller.getLifecycle(),
            isStopping: () => stopping,
            failure: options.failure ?? (() => null),
            requestStop: () => {
              stopping = true;
              options.onStopRequested?.();
            },
          },
        }),
  });
  httpServer.off("request", startingHandler);
  httpServer.off("upgrade", startingUpgrade);
  httpServer.on("request", app);
  const hub = new LiveSocketHub({ server: httpServer, controller, port: actualPort });

  let closed = false;
  return {
    url,
    port: actualPort,
    controller,
    app,
    runStore,
    directorRuntime,
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      hub.close();
      controller.dispose();
      await new Promise<void>((resolvePromise) => {
        httpServer.close(() => resolvePromise());
        httpServer.closeAllConnections();
      });
      const phase = controller.getState().phase;
      await runStore.finish({
        status: phase === "post_show" ? "completed" : "stopped",
        phase,
      });
    },
  };
}
