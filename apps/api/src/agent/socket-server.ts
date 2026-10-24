import { chmod, lstat, stat, unlink } from "node:fs/promises";
import { createServer, connect, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { AGENT_MAX_CONNECTIONS } from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { logger } from "../logger.ts";
import {
  getSharedPreviewRasterizer,
  type PreviewRasterizer,
} from "../media/preview-rasterize.ts";
import { agentSocketFilePath, ensureAgentDirectory } from "../storage/paths.ts";
import { CompositionService } from "../services/compositions.ts";
import { CompositionAuthoringService } from "../services/authoring-context.ts";
import {
  getSharedFontCatalogService,
  type FontCatalogService,
} from "../services/font-catalog.ts";
import { attachAgentProtocol, type AgentDispatch } from "./protocol.ts";
import {
  agentOperationKind,
  dispatchAgentOperation,
  type AgentOperationContext,
  type AgentOperationKind,
} from "./operations.ts";

export interface AgentSocketServer {
  socketPath: string;
  close: () => Promise<void>;
}

export interface ListenAgentProtocolOptions {
  socketPath: string;
  dispatch: AgentDispatch;
  operationKind: (operation: string) => AgentOperationKind | undefined;
  protocol?: {
    maxRequestBytes?: number;
    readTimeoutMs?: number;
    mutationTimeoutMs?: number;
    idleTimeoutMs?: number;
    maxPendingFramesPerConnection?: number;
    maxPendingBytesPerConnection?: number;
  };
  /**
   * Maximum number of concurrent connections. A connection above the cap is
   * closed before the handshake; the connections within the cap are not
   * affected.
   */
  maxConnections?: number;
}

export interface StartAgentSocketServerOptions {
  config: AppConfig;
  prisma: PrismaClient;
  fontCatalogService?: FontCatalogService;
  /** Tests inject a fake; production uses the shared headless rasterizer. */
  previewRasterizer?: PreviewRasterizer;
}

async function lstatOrNull(path: string) {
  return lstat(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  });
}

async function socketIsLive(path: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect(path);
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

/**
 * Only the app process may remove the socket file. A live socket belongs to a
 * running instance and is never unlinked; a dead socket file is stale.
 */
async function prepareSocketPath(socketPath: string): Promise<void> {
  await ensureAgentDirectory(dirname(socketPath));

  const current = await lstatOrNull(socketPath);
  if (current === null) {
    return;
  }
  if (!current.isSocket()) {
    throw new Error(`エージェントソケットのパスがソケットではありません: ${socketPath}`);
  }
  if (await socketIsLive(socketPath)) {
    throw new Error(`エージェントソケットは既に使用中です: ${socketPath}`);
  }
  await unlink(socketPath);
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      // A server-level error after startup (e.g. EMFILE on accept) must never
      // become an unhandled event; it would take down the HTTP app with it.
      server.on("error", (error: Error) => {
        logger.error("agent_socket_server_error", { message: error.message });
      });
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

export async function listenAgentProtocol(
  options: ListenAgentProtocolOptions,
): Promise<AgentSocketServer> {
  const { socketPath } = options;
  await prepareSocketPath(socketPath);

  const maxConnections = Math.max(1, options.maxConnections ?? AGENT_MAX_CONNECTIONS);
  const sockets = new Set<Socket>();
  let rejectedConnections = 0;
  const server = createServer((socket) => {
    if (sockets.size >= maxConnections) {
      // Over the cap: the connection is closed before the handshake, so the
      // client never gets a protocol session. The connections that are
      // already open are not affected.
      rejectedConnections += 1;
      // The rejection happens per connection attempt, so the log is sampled
      // instead of flooding the log of the app.
      if (rejectedConnections === 1 || rejectedConnections % 100 === 0) {
        logger.warn("agent_socket_connection_rejected", {
          socketPath,
          maxConnections,
          openConnections: sockets.size,
          rejectedConnections,
        });
      }
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    attachAgentProtocol(socket, {
      dispatch: options.dispatch,
      operationKind: options.operationKind,
      ...options.protocol,
    });
  });

  await listen(server, socketPath);
  let owned: Awaited<ReturnType<typeof stat>>;
  try {
    await chmod(socketPath, 0o600);
    owned = await stat(socketPath);
  } catch (error) {
    // The server is already listening but no handle was returned yet, so the
    // caller cannot close it. Clean up here before rethrowing.
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await unlink(socketPath).catch(() => undefined);
    throw error;
  }

  let closed = false;
  return {
    socketPath,
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          for (const socket of sockets) {
            socket.destroy();
          }
          resolve();
        }, 2000);
        timer.unref?.();
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      const current = await stat(socketPath).catch(() => null);
      if (current !== null && current.ino === owned.ino && current.isSocket()) {
        await unlink(socketPath).catch(() => undefined);
      }
    },
  };
}

export async function startAgentSocketServer(
  options: StartAgentSocketServerOptions,
): Promise<AgentSocketServer> {
  const { config, prisma } = options;
  const fontCatalogService =
    options.fontCatalogService ?? getSharedFontCatalogService();
  const previewRasterizer =
    options.previewRasterizer ?? getSharedPreviewRasterizer();
  const baseContext: Omit<AgentOperationContext, "agentId"> = {
    prisma,
    config,
    directories: config.directories,
    fontCatalogService,
    previewRasterizer,
    // The agent bindings call the same services as the HTTP routes; no
    // authoring logic lives in the dispatcher.
    compositions: new CompositionService({
      db: prisma,
      dataDir: config.directories.root,
    }),
    compositionAuthoring: new CompositionAuthoringService({
      db: prisma,
      fontCatalogService,
    }),
  };
  const socketPath = agentSocketFilePath(config.directories);
  const server = await listenAgentProtocol({
    socketPath,
    dispatch: (operation, input, agentId) =>
      dispatchAgentOperation(operation, input, { ...baseContext, agentId }),
    operationKind: agentOperationKind,
  });
  logger.info("agent_socket_listening", { socketPath });
  return server;
}
