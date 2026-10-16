import { describe, expect, it } from "vitest";
import { stateIntervalTweenLines } from "./compiler";

describe("stateIntervalTweenLines", () => {
  it("emits on and off sets at the absolute interval bounds", () => {
    const lines = stateIntervalTweenLines(
      [
        {
          targetId: "t",
          intervals: [{ startMs: 1000, endMs: 2000 }],
          on: { opacity: 1, backgroundColor: "#FF0000" },
          off: { opacity: 0 },
        },
      ],
      4000,
      6000,
    );
    expect(lines).toEqual([
      'tl.set(document.getElementById("t"),{opacity:1,backgroundColor:"#FF0000"},5);',
      'tl.set(document.getElementById("t"),{opacity:0},6);',
    ]);
  });

  it("emits only the on set when no off is given", () => {
    const lines = stateIntervalTweenLines(
      [{ targetId: "t", intervals: [{ startMs: 0, endMs: 500 }], on: { opacity: 0 } }],
      0,
      5000,
    );
    expect(lines).toEqual(['tl.set(document.getElementById("t"),{opacity:0},0);']);
  });

  it("clamps intervals to the span and skips empty ones", () => {
    const lines = stateIntervalTweenLines(
      [
        {
          targetId: "t",
          intervals: [
            { startMs: -500, endMs: 100 },
            { startMs: 500, endMs: 500 },
            { startMs: 800, endMs: 1200 },
          ],
          on: { opacity: 1 },
          off: { opacity: 0 },
        },
      ],
      0,
      1000,
    );
    expect(lines).toEqual([
      'tl.set(document.getElementById("t"),{opacity:1},0);',
      'tl.set(document.getElementById("t"),{opacity:0},0.1);',
      'tl.set(document.getElementById("t"),{opacity:1},0.8);',
      'tl.set(document.getElementById("t"),{opacity:0},1);',
    ]);
  });
});
