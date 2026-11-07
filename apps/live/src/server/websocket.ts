import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import {
  liveClientMessageSchema,
  type ConsoleSnapshot,
  type LiveServerHelloMessage,
  type LiveServerMessage,
} from "@kakeai/contracts";
import { WebSocket, WebSocketServer } from "ws";
import type { LiveController, LiveControllerChange } from "../runtime/controller.ts";
import { evaluateWebSocketAccess } from "./security.ts";

type ConnectionRole = "stage" | "console";

interface ClientBase {
  sessionId: string;
  role: ConnectionRole;
  socket: WebSocket;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(socket: WebSocket, message: LiveServerMessage): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    socket.send(JSON.stringify(message));
  } catch {
    socket.terminate();
  }
}

function denyUpgrade(socket: Duplex): void {
  socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  socket.destroy();
}

export interface LiveSocketHubOptions {
  server: HttpServer;
  controller: LiveController;
  port: number;
}

/**
 * WebSocket transport for `/ws?role=stage|console`. Host and Origin are
 * checked during the HTTP upgrade, so a page from another origin cannot open
 * a control socket.
 */
export class LiveSocketHub {
  private readonly wss: WebSocketServer;
  private readonly clients = new Map<WebSocket, ClientBase>();
  private readonly alive = new Map<WebSocket, boolean>();
  private readonly stageRoles = new Map<string, "program" | "preview">();
  private readonly pingTimer: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;
  private readonly onUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

  constructor(private readonly options: LiveSocketHubOptions) {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    this.unsubscribe = options.controller.subscribe((change) => this.broadcast(change));
    this.onUpgrade = (req, socket, head) => this.handleUpgrade(req, socket, head);
    options.server.on("upgrade", this.onUpgrade);
    this.pingTimer = setInterval(() => this.checkLiveness(), 10_000);
  }

  private checkLiveness(): void {
    for (const socket of this.clients.keys()) {
      if (this.alive.get(socket) !== true) {
        socket.terminate();
        continue;
      }
      this.alive.set(socket, false);
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (req.method !== "GET") {
      denyUpgrade(socket);
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      denyUpgrade(socket);
      return;
    }
    if (url.pathname !== "/ws") {
      denyUpgrade(socket);
      return;
    }
    const role = url.searchParams.get("role");
    if (role !== "stage" && role !== "console") {
      denyUpgrade(socket);
      return;
    }
    // `/stage?preview=1` opens `/ws?role=stage&preview=1`. The console embeds
    // that URL, so its preview iframe never becomes program even when OBS has
    // not connected yet.
    const requestedRole = url.searchParams.get("preview") === "1" ? "preview" : undefined;
    const denied = evaluateWebSocketAccess(
      {
        host: headerValue(req.headers.host),
        origin: headerValue(req.headers.origin),
      },
      this.options.port,
    );
    if (denied !== null) {
      denyUpgrade(socket);
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.register(ws, role, requestedRole);
    });
  }

  private register(
    socket: WebSocket,
    role: ConnectionRole,
    requestedRole?: "program" | "preview",
  ): void {
    const sessionId = `session-${randomUUID()}`;
    const client: ClientBase = { sessionId, role, socket };
    this.clients.set(socket, client);
    this.alive.set(socket, true);
    socket.on("pong", () => {
      this.alive.set(socket, true);
      if (role === "stage") {
        // Previews send no stage events. Keep only their lease alive from the
        // transport; a frozen program must still expire so playback pauses.
        this.options.controller.touchPreviewStage(sessionId);
      }
    });

    if (role === "stage") {
      const { lease, state } = this.options.controller.connectStage(
        sessionId,
        requestedRole === undefined ? {} : { requestedRole },
      );
      const hello: LiveServerHelloMessage = {
        type: "hello",
        runId: this.options.controller.runId,
        sessionId,
        role: "stage",
        lease,
        state,
        showMeta: this.options.controller.getShowMeta(),
      };
      sendJson(socket, hello);
      sendJson(socket, {
        type: "preload",
        cues: this.options.controller.getPreloadCues(),
      });
      this.stageRoles.set(sessionId, lease.role);
    } else {
      const hello: LiveServerHelloMessage = {
        type: "hello",
        runId: this.options.controller.runId,
        sessionId,
        role: "console",
        lease: null,
        state: this.options.controller.getState(),
        showMeta: this.options.controller.getShowMeta(),
      };
      sendJson(socket, hello);
      sendJson(socket, { type: "snapshot", snapshot: this.options.controller.getSnapshot() });
    }

    socket.on("message", (data) => this.handleMessage(client, data.toString()));
    socket.on("close", () => this.handleClose(client));
    socket.on("error", () => {
      socket.terminate();
    });
  }

  private handleMessage(client: ClientBase, text: string): void {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      this.sendNotice(client, "warning", "WebSocket メッセージを JSON として読めません。");
      return;
    }
    const parsed = liveClientMessageSchema.safeParse(value);
    if (!parsed.success) {
      this.sendNotice(client, "warning", "WebSocket メッセージが契約に一致しません。");
      return;
    }
    if (parsed.data.type === "stage_event") {
      if (client.role !== "stage") {
        this.sendNotice(client, "warning", "コンソールからステージイベントは送れません。");
        return;
      }
      this.options.controller.handleStageEvent(client.sessionId, parsed.data.event);
      return;
    }
    if (client.role !== "console") {
      this.sendNotice(client, "warning", "ステージからコマンドは送れません。");
      return;
    }
    const result = this.options.controller.handleCommand(parsed.data.command);
    if (!result.ok) {
      this.sendNotice(client, "warning", result.message);
    }
  }

  private sendNotice(
    client: ClientBase,
    level: "info" | "warning" | "error",
    message: string,
  ): void {
    sendJson(client.socket, { type: "notice", level, message });
  }

  private handleClose(client: ClientBase): void {
    this.clients.delete(client.socket);
    this.alive.delete(client.socket);
    if (client.role === "stage") {
      this.stageRoles.delete(client.sessionId);
      this.options.controller.disconnectStage(client.sessionId);
    }
  }

  /**
   * A takeover or lease expiry changes roles without a reconnect. Send the new
   * lease to the affected stage so its audio output follows program.
   */
  private syncStageRoles(stages: ConsoleSnapshot["stages"]): void {
    const seen = new Set<string>();
    for (const stage of stages) {
      seen.add(stage.sessionId);
      const previous = this.stageRoles.get(stage.sessionId);
      this.stageRoles.set(stage.sessionId, stage.role);
      if (previous === undefined || previous === stage.role) {
        continue;
      }
      const lease = this.options.controller.getStageLease(stage.sessionId);
      if (lease === null) {
        continue;
      }
      for (const client of this.clients.values()) {
        if (client.sessionId === stage.sessionId) {
          sendJson(client.socket, { type: "lease", lease });
        }
      }
    }
    for (const sessionId of [...this.stageRoles.keys()]) {
      if (!seen.has(sessionId)) {
        this.stageRoles.delete(sessionId);
      }
    }
  }

  private broadcast(change: LiveControllerChange): void {
    switch (change.type) {
      case "state":
        for (const client of this.clients.values()) {
          if (client.role === "stage") {
            sendJson(client.socket, { type: "state", state: change.state });
          }
        }
        return;
      case "snapshot":
        this.syncStageRoles(change.snapshot.stages);
        for (const client of this.clients.values()) {
          if (client.role === "console") {
            sendJson(client.socket, { type: "snapshot", snapshot: change.snapshot });
          }
        }
        return;
      case "preload":
        for (const client of this.clients.values()) {
          if (client.role === "stage") {
            sendJson(client.socket, { type: "preload", cues: change.cues });
          }
        }
        return;
      case "event":
        for (const client of this.clients.values()) {
          if (client.role === "console") {
            sendJson(client.socket, { type: "event", event: change.event });
          }
        }
        return;
      case "notice":
        for (const client of this.clients.values()) {
          if (client.role === "console") {
            sendJson(client.socket, {
              type: "notice",
              level: change.level,
              message: change.message,
            });
          }
        }
        return;
      default: {
        const exhaustive: never = change;
        console.warn(`Unsupported controller change: ${JSON.stringify(exhaustive)}`);
        return;
      }
    }
  }

  close(): void {
    this.unsubscribe();
    clearInterval(this.pingTimer);
    this.options.server.off("upgrade", this.onUpgrade);
    for (const socket of this.clients.keys()) {
      socket.terminate();
    }
    this.clients.clear();
    this.alive.clear();
    this.stageRoles.clear();
    this.wss.close();
  }
}
