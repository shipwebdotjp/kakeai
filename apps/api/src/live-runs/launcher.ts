import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface LiveRunLaunchInput {
  runId: string;
  packagePath: string;
  runDir: string;
  port: number;
  controlTokenFile: string;
  runConfigPath: string;
  /** Local LLM/TTS/YouTube settings file; never copied into the Run. */
  configPath?: string;
}

export interface LiveRunLauncher {
  launch(input: LiveRunLaunchInput): Promise<{ pid: number }>;
}

function repoRoot(): string {
  // apps/api/src/live-runs -> repository root
  return resolve(import.meta.dirname, "../../../..");
}

/**
 * Spawns `apps/live` detached with the Run id, package, port, control-token
 * file and run-config path. The control token itself is only in the 0600 file.
 */
export const detachedLiveRunLauncher: LiveRunLauncher = {
  async launch(input: LiveRunLaunchInput): Promise<{ pid: number }> {
    const root = repoRoot();
    const tsxBin = join(root, "node_modules", ".bin", "tsx");
    const binPath = join(root, "apps", "live", "src", "bin.ts");
    const logPath = join(input.runDir, "live.log");
    const logFd = openSync(logPath, "a", 0o600);
    const args = [
      binPath,
      "--package",
      input.packagePath,
      "--run-id",
      input.runId,
      "--run-dir",
      input.runDir,
      "--port",
      String(input.port),
      "--control-token-file",
      input.controlTokenFile,
      "--run-config",
      input.runConfigPath,
      ...(input.configPath === undefined ? [] : ["--config", input.configPath]),
    ];
    try {
      const child = spawn(tsxBin, args, {
        cwd: root,
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: process.env,
      });
      await new Promise<void>((resolvePromise, rejectPromise) => {
        child.once("spawn", () => resolvePromise());
        // Keep the error listener after spawn: a later child error must not
        // become an unhandled 'error' event.
        child.on("error", (error) => rejectPromise(error));
      });
      if (child.pid === undefined) {
        throw new Error("ライブアプリの PID を取得できませんでした。");
      }
      // A bad argument or a missing module exits immediately. Do not report a
      // launch that never had a chance to listen; the token itself is only in
      // the 0600 file and never appears in argv or the log.
      await delay(250);
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `ライブアプリが起動直後に終了しました (code: ${String(child.exitCode)}, signal: ${String(child.signalCode)})。`,
        );
      }
      child.unref();
      return { pid: child.pid };
    } finally {
      closeSync(logFd);
    }
  },
};
