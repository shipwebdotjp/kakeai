import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AGENT_SOCKET_DIRECTORY, AGENT_SOCKET_FILENAME } from "@kakeai/contracts";

/**
 * Mirrors the app data-root rule so CLI and MCP clients can locate the socket
 * without importing the API/prisma package.
 */
export function defaultAgentDataRoot(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env.KAKEAI_DATA_DIR;
  if (override !== undefined && override.trim().length > 0) {
    return resolve(override.trim());
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Kakeai");
  }
  if (platform === "win32") {
    const appData =
      env.APPDATA !== undefined && env.APPDATA.trim().length > 0
        ? env.APPDATA.trim()
        : join(home, "AppData", "Roaming");
    return join(appData, "Kakeai");
  }
  const xdg =
    env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME.trim().length > 0
      ? env.XDG_DATA_HOME.trim()
      : join(home, ".local", "share");
  return join(xdg, "kakeai");
}

export function resolveAgentSocketPath(dataRoot: string): string {
  return join(dataRoot, AGENT_SOCKET_DIRECTORY, AGENT_SOCKET_FILENAME);
}
