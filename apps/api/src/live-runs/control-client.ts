import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  liveControlStatusSchema,
  liveControlStopResponseSchema,
  type LiveControlStatus,
} from "@kakeai/contracts";

export interface LiveControlTarget {
  url: string;
  /** Path to the 0600 control-token file. The token is never stored on the Run. */
  tokenFile: string;
  /** Run directory that owns the token file; the token must stay inside it. */
  logDir: string;
  /** The Run requested this port; the control endpoint must be on it. */
  expectedPort: number;
}

export interface LiveControlClient {
  status(target: LiveControlTarget): Promise<LiveControlStatus>;
  stop(target: LiveControlTarget): Promise<void>;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]"]);

/**
 * The control plane is local-only. Validate the URL and token location before
 * reading the token so it can never be sent to a non-loopback host.
 */
function validatedTarget(target: LiveControlTarget): {
  baseUrl: URL;
  tokenFile: string;
} {
  let baseUrl: URL;
  try {
    baseUrl = new URL(target.url);
  } catch {
    throw new Error(`control URL が不正です: ${target.url}`);
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("control URL は http(s) のループバック URL にしてください。");
  }
  if (!LOOPBACK_HOSTS.has(baseUrl.hostname)) {
    throw new Error(
      `control URL は 127.0.0.1 または ::1 にしてください: ${baseUrl.hostname}`,
    );
  }
  if (baseUrl.username !== "" || baseUrl.password !== "") {
    throw new Error("control URL に認証情報を含めないでください。");
  }
  if (baseUrl.port !== String(target.expectedPort)) {
    throw new Error(
      `control URL のポートが Run の requestedPort と一致しません: ${baseUrl.port}`,
    );
  }
  if (baseUrl.pathname !== "/" || baseUrl.search !== "" || baseUrl.hash !== "") {
    throw new Error("control URL にはパスやクエリを含めないでください。");
  }

  const root = resolve(target.logDir);
  const tokenFile = resolve(target.tokenFile);
  if (!tokenFile.startsWith(`${root}${sep}`)) {
    throw new Error("control token ファイルが Run ディレクトリの外にあります。");
  }
  return { baseUrl, tokenFile };
}

async function readToken(tokenFile: string): Promise<string> {
  const token = (await readFile(tokenFile, "utf8")).trim();
  if (token.length === 0) {
    throw new Error("control token ファイルが空です。");
  }
  return token;
}

async function callControl(
  target: LiveControlTarget,
  path: string,
  method: "GET" | "POST",
): Promise<unknown> {
  const { baseUrl, tokenFile } = validatedTarget(target);
  const token = await readToken(tokenFile);
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      // State-changing control requests pass the loopback Origin guard.
      ...(method === "GET" ? {} : { Origin: baseUrl.origin }),
    },
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) {
    throw new Error(`control endpoint が ${response.status} を返しました。`);
  }
  return response.json() as Promise<unknown>;
}

export const httpLiveControlClient: LiveControlClient = {
  async status(target: LiveControlTarget): Promise<LiveControlStatus> {
    const parsed = liveControlStatusSchema.safeParse(
      await callControl(target, "/control/status", "GET"),
    );
    if (!parsed.success) {
      throw new Error("control status の応答が契約に一致しません。");
    }
    return parsed.data;
  },

  async stop(target: LiveControlTarget): Promise<void> {
    const parsed = liveControlStopResponseSchema.safeParse(
      await callControl(target, "/control/stop", "POST"),
    );
    if (!parsed.success) {
      throw new Error("control stop の応答が契約に一致しません。");
    }
  },
};
