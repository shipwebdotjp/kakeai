import { describe, expect, it } from "vitest";
import { StageLeaseManager } from "./lease.ts";

const START = Date.parse("2026-11-07T12:00:00.000Z");

describe("StageLeaseManager", () => {
  it("gives the first stage program and the next stage preview", () => {
    const manager = new StageLeaseManager("run-1", { now: () => new Date(START) });
    const first = manager.connect("stage-1");
    const second = manager.connect("stage-2");
    expect(first.role).toBe("program");
    expect(second.role).toBe("preview");
    expect(manager.list().map((entry) => entry.role)).toEqual(["program", "preview"]);
  });

  it("does not promote a preview when the program disconnects", () => {
    const manager = new StageLeaseManager("run-1", { now: () => new Date(START) });
    manager.connect("stage-1");
    manager.connect("stage-2");
    manager.disconnect("stage-1");
    expect(manager.roleOf("stage-1")).toBeNull();
    expect(manager.roleOf("stage-2")).toBe("preview");
    expect(manager.list()).toHaveLength(1);
  });

  it("moves program only through explicit takeover", () => {
    const manager = new StageLeaseManager("run-1", { now: () => new Date(START) });
    const first = manager.connect("stage-1");
    const second = manager.connect("stage-2");
    const result = manager.takeover("stage-2");
    expect(result).toEqual({ ok: true, previousProgramSessionId: "stage-1" });
    expect(manager.roleOf("stage-2")).toBe("program");
    expect(manager.roleOf("stage-1")).toBe("preview");
    expect(manager.leaseOf("stage-2")?.leaseId).not.toBe(second.leaseId);
    expect(manager.leaseOf("stage-1")?.leaseId).not.toBe(first.leaseId);
    expect(manager.takeover("missing")).toEqual({ ok: false, reason: "unknown_session" });
  });

  it("expires a program lease without promoting another stage", () => {
    let now = START;
    const expired: string[] = [];
    const manager = new StageLeaseManager("run-1", {
      ttlMs: 1000,
      now: () => new Date(now),
      onProgramExpired: (sessionId) => expired.push(sessionId),
    });
    manager.connect("stage-1");
    manager.connect("stage-2");
    now += 2000;
    manager.expireIfNeeded();
    expect(manager.roleOf("stage-1")).toBe("preview");
    expect(manager.roleOf("stage-2")).toBeNull();
    expect(manager.list().some((entry) => entry.role === "program")).toBe(false);
    expect(manager.takeover("stage-2")).toEqual({ ok: false, reason: "unknown_session" });
    expect(expired).toEqual(["stage-1"]);
  });
});
