import { describe, expect, it } from "vitest";
import { Semaphore } from "./semaphore.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Semaphore", () => {
  it("limits active tasks, queues waiters and releases on failure", async () => {
    const semaphore = new Semaphore(2);
    let active = 0;
    let maxActive = 0;
    const run = async (fail = false): Promise<string> => {
      return semaphore.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(10);
        active -= 1;
        if (fail) {
          throw new Error("failed");
        }
        return "ok";
      });
    };

    const settled = await Promise.allSettled([
      run(),
      run(true),
      run(),
      run(),
    ]);
    expect(maxActive).toBe(2);
    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(3);
    expect(semaphore.activeCount).toBe(0);
  });

  it("rejects invalid limits", () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(1.5)).toThrow();
  });
});
