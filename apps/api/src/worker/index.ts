import type { WorkerStatus } from "@kakeai/contracts";

export interface Worker {
  status: () => WorkerStatus;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createWorker(): Worker {
  let status: WorkerStatus = "notReady";
  return {
    status: () => status,
    async start() {
      status = "notReady";
    },
    async stop() {
      status = "notReady";
    },
  };
}
