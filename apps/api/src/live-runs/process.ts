import { setTimeout as delay } from "node:timers/promises";

export interface LiveProcessController {
  isAlive(pid: number): boolean;
  stop(pid: number): Promise<void>;
}

function signal(pid: number, value: NodeJS.Signals): void {
  try {
    process.kill(pid, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function stopProcess(pid: number): Promise<void> {
  if (!isAlive(pid)) {
    return;
  }
  signal(pid, "SIGTERM");
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await delay(100);
    if (!isAlive(pid)) {
      return;
    }
  }
  signal(pid, "SIGKILL");
  await delay(200);
  if (isAlive(pid)) {
    throw new Error(`ライブアプリのプロセスを終了できません: ${pid}`);
  }
}

export const systemProcessController: LiveProcessController = {
  isAlive,
  stop: stopProcess,
};
