import { describe, expect, it } from "vitest";
import {
  abbreviateAgentId,
  buildVersionOutline,
  isAgentAuthored,
  lineDisplayText,
  type VersionOutlineSource,
} from "./versionHistory";

describe("isAgentAuthored", () => {
  it("classifies only the agent author as agent-authored", () => {
    expect(isAgentAuthored("agent")).toBe(true);
    expect(isAgentAuthored("human")).toBe(false);
  });
});

describe("abbreviateAgentId", () => {
  it("keeps short identifiers unchanged", () => {
    expect(abbreviateAgentId("mcp")).toBe("mcp");
    expect(abbreviateAgentId("cli")).toBe("cli");
  });

  it("truncates long identifiers and appends an ellipsis", () => {
    const longId = "claude-code-with-an-extremely-long-identifier";
    expect(abbreviateAgentId(longId)).toBe(`${longId.slice(0, 24)}…`);
    expect(abbreviateAgentId(longId, 4)).toBe("clau…");
  });

  it("respects the display limit", () => {
    expect(abbreviateAgentId("abcdefgh", 8)).toBe("abcdefgh");
    expect(abbreviateAgentId("abcdefghi", 8)).toBe("abcdefgh…");
  });
});

describe("lineDisplayText", () => {
  it("prefers the caption, then speech, then a placeholder", () => {
    expect(lineDisplayText({ captionText: "字幕", speechText: "読み上げ" })).toBe("字幕");
    expect(lineDisplayText({ captionText: "", speechText: "読み上げ" })).toBe("読み上げ");
    expect(lineDisplayText({ captionText: "", speechText: "" })).toBe("（セリフなし）");
  });
});

describe("buildVersionOutline", () => {
  const source: VersionOutlineSource = {
    locale: "ja-JP",
    template: { id: "explanation-scenes", version: 1 },
    visualTheme: { id: "theme-basic", version: 2 },
    scenes: [
      {
        id: "scene-intro",
        kind: "intro",
        label: "導入",
        lines: [{ id: "line-1", captionText: " 最初の字幕 ", speechText: "最初の読み上げ" }],
        visualCues: [{}, {}],
      },
      {
        id: "scene-point-1",
        kind: "point",
        label: "要点1",
        lines: [
          { id: "line-2", captionText: "二番目の字幕", speechText: "" },
          { id: "line-3", captionText: "", speechText: "三番目の読み上げ" },
        ],
        visualCues: [{}],
      },
      {
        id: "scene-insert-1",
        kind: "insert",
        label: "動画1",
        lines: [],
        visualCues: [{}],
      },
    ],
    audioTakes: [{}, {}],
    audioCues: [{}],
  };

  it("counts scenes, lines, takes, and cues", () => {
    const outline = buildVersionOutline(source);
    expect(outline.sceneCount).toBe(3);
    expect(outline.lineCount).toBe(3);
    expect(outline.audioTakeCount).toBe(2);
    expect(outline.visualCueCount).toBe(4);
    expect(outline.audioCueCount).toBe(1);
  });

  it("keeps scene labels, kinds, and trimmed line captions in order", () => {
    const outline = buildVersionOutline(source);
    expect(outline.scenes.map((scene) => scene.label)).toEqual(["導入", "要点1", "動画1"]);
    expect(outline.scenes.map((scene) => scene.kind)).toEqual(["intro", "point", "insert"]);
    expect(outline.scenes[1]?.lines.map((line) => line.captionText)).toEqual([
      "二番目の字幕",
      "",
    ]);
    expect(outline.scenes[0]?.lines[0]?.captionText).toBe("最初の字幕");
  });

  it("passes through locale, template, and visual theme references", () => {
    const outline = buildVersionOutline(source);
    expect(outline.locale).toBe("ja-JP");
    expect(outline.template).toEqual({ id: "explanation-scenes", version: 1 });
    expect(outline.visualTheme).toEqual({ id: "theme-basic", version: 2 });
  });
});
