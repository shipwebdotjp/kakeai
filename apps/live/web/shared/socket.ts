import {
  liveServerMessageSchema,
  type LiveClientMessage,
  type LiveServerMessage,
} from "@kakeai/contracts";

export type LiveSocketStatus = "connecting" | "open" | "closed";

export interface LiveSocketOptions {
  role: "stage" | "console";
  onMessage: (message: LiveServerMessage) => void;
  onStatus?: (status: LiveSocketStatus) => void;
}

export interface LiveSocket {
  /** Returns false when the socket is reconnecting; callers can surface it. */
  send(message: LiveClientMessage): boolean;
  close(): void;
}

function socketUrl(role: "stage" | "console"): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws?role=${role}`;
}

/**
 * Reconnecting live socket. A dropped connection retries with exponential
 * backoff; the server always replies to a new connection with `hello` and the
 * latest state, so callers do not need to resend anything.
 */
export function openLiveSocket(options: LiveSocketOptions): LiveSocket {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let reconnectTimer: number | null = null;

  const scheduleReconnect = () => {
    if (closed) {
      return;
    }
    const delay = Math.min(500 * 2 ** attempts, 8000);
    attempts += 1;
    options.onStatus?.("closed");
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (closed) {
      return;
    }
    options.onStatus?.("connecting");
    const next = new WebSocket(socketUrl(options.role));
    socket = next;
    next.addEventListener("open", () => {
      attempts = 0;
      options.onStatus?.("open");
    });
    next.addEventListener("message", (event) => {
      let value: unknown;
      try {
        value = JSON.parse(String(event.data)) as unknown;
      } catch {
        console.warn("[live] WebSocket メッセージを JSON として読めません。");
        return;
      }
      const parsed = liveServerMessageSchema.safeParse(value);
      if (parsed.success) {
        options.onMessage(parsed.data);
      } else {
        console.warn("[live] WebSocket メッセージが契約に一致しません。", parsed.error.issues);
      }
    });
    next.addEventListener("error", () => {
      next.close();
    });
    next.addEventListener("close", () => {
      if (socket === next) {
        socket = null;
      }
      scheduleReconnect();
    });
  };

  connect();

  return {
    send(message) {
      if (socket !== null && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return true;
      }
      return false;
    },
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
      socket = null;
    },
  };
}
