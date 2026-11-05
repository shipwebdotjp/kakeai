import { describe, expect, it } from "vitest";
import {
  appendTerminalRevealEffect,
  firstUnusedTerminalLineId,
  remapTerminalEffectTargets,
} from "./terminal";

const effects = JSON.stringify([
  {
    target: { kind: "turn", index: 0 },
    trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
    effect: { kind: "reveal", mode: "type" },
  },
  {
    target: { kind: "turn", index: 2 },
    trigger: { kind: "cue" },
    effect: { kind: "reveal", mode: "instant" },
  },
]);

describe("terminal effect helpers", () => {
  it("drops and shifts turn targets when a turn is deleted", () => {
    const remapped = remapTerminalEffectTargets(effects, (index) =>
      index === 0 ? null : index > 0 ? index - 1 : index,
    );
    expect(remapped).not.toBeNull();
    const parsed = JSON.parse(remapped!) as { target: { index: number } }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.target.index).toBe(1);
  });

  it("returns null for unreadable effect JSON", () => {
    expect(remapTerminalEffectTargets("not json", (index) => index)).toBeNull();
  });

  it("finds the first line not already used by a trigger", () => {
    expect(
      firstUnusedTerminalLineId(effects, [
        { id: "l1" },
        { id: "l2" },
        { id: "l3" },
      ]),
    ).toBe("l2");
    expect(firstUnusedTerminalLineId("", [{ id: "l1" }])).toBe("l1");
  });

  it("appends a typed reveal effect for a new turn", () => {
    const appended = appendTerminalRevealEffect(effects, 3, "l3");
    expect(appended).not.toBeNull();
    const parsed = JSON.parse(appended!) as {
      target: { kind: string; index: number };
      trigger: { startLineId: string; endLineId: string };
      effect: { kind: string; mode: string };
    }[];
    expect(parsed).toHaveLength(3);
    expect(parsed[2]!.target).toEqual({ kind: "turn", index: 3 });
    expect(parsed[2]!.trigger.startLineId).toBe("l3");
    expect(parsed[2]!.trigger.endLineId).toBe("l3");
    expect(parsed[2]!.effect).toEqual({ kind: "reveal", mode: "type" });
  });
});
