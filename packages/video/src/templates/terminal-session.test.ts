import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { LANDSCAPE_CANVAS } from "../canvas";
import { CompositionCompileError } from "../compile-error";
import type { RenderContext } from "../render-context";
import { cueScope } from "../scope";
import { neutralVisualSkin } from "../skins/neutral";
import { renderTerminalSession } from "./terminal-session";

const theme = getVisualTheme("soft-editorial", 1)!;

function context(): RenderContext {
  return {
    document: validContentDocument(),
    theme,
    skin: neutralVisualSkin,
    canvas: LANDSCAPE_CANVAS,
    assetResolver: () => ({ url: "/preview/asset", kind: "image" }),
    scope: cueScope("terminal-1"),
    path: ["scenes", 1, "visualCues", 0, "input"],
    cueTiming: { startMs: 0, spanMs: 9000 },
    lineIntervals: [
      { lineId: "l1", startMs: 0, endMs: 1000 },
      { lineId: "l2", startMs: 1500, endMs: 2500 },
      { lineId: "l3", startMs: 3000, endMs: 4000 },
    ],
    renderNested: () => ({ html: "", assetIds: [], animation: [] }),
  };
}

describe("renderTerminalSession", () => {
  it("renders the macOS window chrome, prompt, input, and output", () => {
    const rendered = renderTerminalSession(
      {
        title: "~/project — zsh",
        turns: [
          { input: "npm test", output: ["PASS src/example.test.ts", "Tests 12 passed"] },
        ],
      },
      context(),
    );
    expect(rendered.assetIds).toEqual([]);
    expect(rendered.html).toContain("kakeai-terminalwindow");
    expect(rendered.html).toContain("kakeai-terminaldot");
    expect(rendered.html).toContain("~/project — zsh");
    expect(rendered.html).toContain("kakeai-terminalprompt");
    expect(rendered.html).toContain("PASS src/example.test.ts");
    expect(rendered.html).toContain("Tests 12 passed");
    expect(rendered.html).not.toMatch(/<(input|textarea|script)/);
    expect(rendered.html).not.toContain("contenteditable");
  });

  it("shows turns without effects from the start", () => {
    const rendered = renderTerminalSession(
      { turns: [{ input: "pwd", output: ["/tmp"] }] },
      context(),
    );
    const scope = cueScope("terminal-1");
    expect(rendered.html).toContain(`id="${scope.id("turn-0")}"`);
    expect(rendered.html).not.toContain('style="display:none"');
    expect(
      rendered.stateIntervals?.some((state) => state.targetId === scope.id("turn-0")),
    ).toBe(false);
  });

  it("hides a typed turn until its line and reveals characters at the fixed speed", () => {
    const rendered = renderTerminalSession(
      {
        turns: [
          { input: "pwd" },
          { input: "abc", output: ["out"] },
        ],
        effects: [
          {
            target: { kind: "turn", index: 1 },
            trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
            effect: { kind: "reveal", mode: "type" },
          },
        ],
      },
      context(),
    );
    const scope = cueScope("terminal-1");
    const turn = rendered.stateIntervals?.find(
      (state) => state.targetId === scope.id("turn-1") && state.on.display === "none",
    );
    expect(turn?.intervals).toEqual([{ startMs: 0, endMs: 1500 }]);
    const secondChar = rendered.stateIntervals?.find(
      (state) =>
        state.targetId === scope.id("char-1-1") && state.on.opacity === 0,
    );
    expect(secondChar?.intervals).toEqual([{ startMs: 1500, endMs: 1525 }]);
    expect(secondChar?.off).toEqual({ opacity: 1 });
    const output = rendered.stateIntervals?.find(
      (state) =>
        state.targetId === scope.id("out-1") && state.on.display === "none",
    );
    expect(output?.intervals).toEqual([{ startMs: 0, endMs: 1670 }]);
    expect(rendered.html).toContain(`id="${scope.id("out-1")}"`);
    expect(rendered.html).toContain('style="display:none"');
  });

  it("pops the remaining characters before the line end so the output fits", () => {
    const rendered = renderTerminalSession(
      {
        typing: { charsPerSecond: 1 },
        turns: [{ input: "abcdefghij", output: ["done"] }],
        effects: [
          {
            target: { kind: "turn", index: 0 },
            trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
            effect: { kind: "reveal", mode: "type" },
          },
        ],
      },
      context(),
    );
    const scope = cueScope("terminal-1");
    const tail = rendered.stateIntervals?.find(
      (state) => state.targetId === scope.id("tail-0") && state.on.opacity === 0,
    );
    expect(tail?.intervals).toEqual([{ startMs: 1500, endMs: 2380 }]);
    const output = rendered.stateIntervals?.find(
      (state) =>
        state.targetId === scope.id("out-0") && state.on.display === "none",
    );
    expect(output?.intervals).toEqual([{ startMs: 0, endMs: 2500 }]);
  });

  it("reveals an instant turn at the trigger without typing", () => {
    const rendered = renderTerminalSession(
      {
        turns: [{ input: "pwd", output: ["/tmp"] }],
        effects: [
          {
            target: { kind: "turn", index: 0 },
            trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
            effect: { kind: "reveal", mode: "instant" },
          },
        ],
      },
      context(),
    );
    const scope = cueScope("terminal-1");
    const turn = rendered.stateIntervals?.find(
      (state) => state.targetId === scope.id("turn-0"),
    );
    expect(turn?.intervals).toEqual([{ startMs: 0, endMs: 1500 }]);
    expect(
      rendered.stateIntervals?.some((state) => state.targetId === scope.id("char-0-0")),
    ).toBe(false);
    expect(
      rendered.stateIntervals?.some((state) => state.targetId === scope.id("out-0")),
    ).toBe(false);
    expect(rendered.html).not.toContain('style="display:none"');
  });

  it("types from the cue start for a cue trigger and draws a caret", () => {
    const rendered = renderTerminalSession(
      {
        turns: [{ input: "ab" }],
        effects: [
          {
            target: { kind: "turn", index: 0 },
            trigger: { kind: "cue" },
            effect: { kind: "reveal", mode: "type" },
          },
        ],
      },
      context(),
    );
    const scope = cueScope("terminal-1");
    const secondChar = rendered.stateIntervals?.find(
      (state) => state.targetId === scope.id("char-0-1") && state.on.opacity === 0,
    );
    expect(secondChar?.intervals).toEqual([{ startMs: 0, endMs: 25 }]);
    const caret = rendered.stateIntervals?.find(
      (state) =>
        state.targetId === scope.id("caret-0-1") && state.on.opacity === 1,
    );
    expect(caret?.intervals).toEqual([{ startMs: 25, endMs: 145 }]);
  });

  it("escapes terminal text", () => {
    const rendered = renderTerminalSession(
      { turns: [{ input: "<b>x</b>", output: ["<i>y</i>"] }] },
      context(),
    );
    expect(rendered.html).toContain("&lt;");
    expect(rendered.html).toContain("&gt;");
    expect(rendered.html).not.toContain("<b>");
    expect(rendered.html).not.toContain("<i>");
  });

  it("rejects invalid input", () => {
    expect(() => renderTerminalSession({ turns: [] }, context())).toThrow(
      CompositionCompileError,
    );
  });
});
