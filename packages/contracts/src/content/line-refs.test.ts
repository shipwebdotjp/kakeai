import { describe, expect, it } from "vitest";
import { validContentDocument } from "../testing/fixtures";
import { collectLineReferences } from "./line-refs";

const transition = {
  enter: { preset: "fade", durationMs: 350 },
  exit: { preset: "none", durationMs: 0 },
} as const;

describe("collectLineReferences", () => {
  it("collects effect triggers with their scene and input path", () => {
    const doc = validContentDocument();
    const lineId = doc.scenes[1]!.lines[0]!.id;
    doc.scenes[1]!.visualCues.push({
      id: "vc-table",
      template: { id: "table.simple", version: 1 },
      range: { kind: "scene" },
      layer: "overlay",
      order: 5,
      transition,
      input: {
        data: {
          columns: [{ key: "a", label: "A", type: "text" }],
          rows: [{ a: "x" }],
        },
        effects: [
          {
            target: { kind: "row", index: 0 },
            trigger: { kind: "lines", startLineId: lineId, endLineId: lineId },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
          {
            target: { kind: "rows" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 400 },
          },
        ],
      },
    });

    const references = collectLineReferences(doc);

    expect(references).toEqual([
      {
        sceneId: "scene-point-1",
        lineId,
        path: ["scenes", 1, "visualCues", 2, "input", "effects", 0, "trigger", "startLineId"],
      },
      {
        sceneId: "scene-point-1",
        lineId,
        path: ["scenes", 1, "visualCues", 2, "input", "effects", 0, "trigger", "endLineId"],
      },
    ]);
  });

  it("collects inline item and appear triggers for list.callout", () => {
    const doc = validContentDocument();
    const lineId = doc.scenes[1]!.lines[0]!.id;
    doc.scenes[1]!.visualCues.push({
      id: "vc-callout",
      template: { id: "list.callout", version: 1 },
      range: { kind: "scene" },
      layer: "overlay",
      order: 5,
      transition,
      input: {
        items: [
          {
            text: "a",
            trigger: { kind: "lines", startLineId: lineId, endLineId: lineId },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
          { text: "b" },
        ],
        appear: {
          trigger: { kind: "lines", startLineId: lineId, endLineId: lineId },
          effect: { kind: "appear", preset: "fade", durationMs: 400 },
        },
      },
    });

    const references = collectLineReferences(doc);

    expect(references.map((reference) => reference.path)).toEqual([
      ["scenes", 1, "visualCues", 2, "input", "items", 0, "trigger", "startLineId"],
      ["scenes", 1, "visualCues", 2, "input", "items", 0, "trigger", "endLineId"],
      ["scenes", 1, "visualCues", 2, "input", "appear", "trigger", "startLineId"],
      ["scenes", 1, "visualCues", 2, "input", "appear", "trigger", "endLineId"],
    ]);
  });

  it("collects flow.diagram effect triggers", () => {
    const doc = validContentDocument();
    const lineId = doc.scenes[1]!.lines[0]!.id;
    doc.scenes[1]!.visualCues.push({
      id: "vc-flow",
      template: { id: "flow.diagram", version: 1 },
      range: { kind: "scene" },
      layer: "overlay",
      order: 5,
      transition,
      input: {
        diagram: { nodes: [{ label: "A" }, { label: "B" }], edges: [{ from: 0, to: 1 }] },
        effects: [
          {
            target: { kind: "node", index: 1 },
            trigger: { kind: "lines", startLineId: lineId, endLineId: lineId },
            effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
          },
        ],
      },
    });

    const references = collectLineReferences(doc);

    expect(references.map((reference) => reference.path)).toEqual([
      ["scenes", 1, "visualCues", 2, "input", "effects", 0, "trigger", "startLineId"],
      ["scenes", 1, "visualCues", 2, "input", "effects", 0, "trigger", "endLineId"],
    ]);
  });
});
