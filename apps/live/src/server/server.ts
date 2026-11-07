import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import type { Duplex } from "node:stream";
import type { LiveRuntimeConfig } from "@kakeai/contracts";
import type { Express } from "express";
import type { LoadedLivePackage } from "../package/loader.ts";
import { LiveController } from "../runtime/controller.ts";
import { RunStore } from "../runs/run-store.ts";
import { createLiveApp } from "./app.ts";
import { LOCAL_BIND_ADDRESS } from "./security.ts";
import { LiveSocketHub } from "./websocket.ts";

export interface CreateLiveServerOptions {
  package: LoadedLivePackage;
  config: LiveRuntimeConfig;
  testMode?: boolean;
  /** Overrides config.port; 0 asks the OS for a free port (tests). */
  port?: number;
  /** Defaults to apps/live/dist; tests point this at a temp build. */
  distDir?: string;
  runStore?: RunStore;
  now?: () => Date;
  leaseTtlMs?: number;
}

export interface LiveServer {
  url: string;
  port: number;
  close(): Promise<void>;
  controller: LiveController;
  app: Express;
  runStore: RunStore;
  testMode: boolean;
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
  const controller = new LiveController({
    runId: runStore.runId,
    show: options.package.show,
    characters: options.package.characters,
    runStore,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.leaseTtlMs === undefined ? {} : { leaseTtlMs: options.leaseTtlMs }),
  });

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
  const app = createLiveApp({
    loaded: options.package,
    distDir: options.distDir ?? DEFAULT_DIST_DIR,
    port: actualPort,
  });
  httpServer.off("request", startingHandler);
  httpServer.off("upgrade", startingUpgrade);
  httpServer.on("request", app);
  const hub = new LiveSocketHub({ server: httpServer, controller, port: actualPort });

  let closed = false;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    controller,
    app,
    runStore,
    testMode: options.testMode === true,
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
