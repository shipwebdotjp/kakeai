import { describe, expect, it } from "vitest";
import { moveDiagramNode, remapFlowEffectTargets, type FlowDiagramJson } from "./flow";

const diagram: FlowDiagramJson = {
  nodes: [{ label: "受付" }, { label: "審査" }, { label: "完了" }],
  edges: [
    { from: 0, to: 1, label: "書類" },
    { from: 1, to: 2 },
    { from: 0, to: 2, label: "特例" },
  ],
};

describe("moveDiagramNode", () => {
  it("swaps a node with the next one and remaps edge indices", () => {
    const moved = moveDiagramNode(diagram, 0, 1);
    expect(moved.nodes.map((node) => node.label)).toEqual(["審査", "受付", "完了"]);
    expect(moved.edges).toEqual([
      { from: 1, to: 0, label: "書類" },
      { from: 0, to: 2 },
      { from: 1, to: 2, label: "特例" },
    ]);
  });

  it("keeps labels and captions attached to their node", () => {
    const withCaption: FlowDiagramJson = {
      nodes: [{ label: "受付", caption: "窓口" }, { label: "完了" }],
      edges: [{ from: 0, to: 1 }],
    };
    const moved = moveDiagramNode(withCaption, 0, 1);
    expect(moved.nodes[1]).toEqual({ label: "受付", caption: "窓口" });
    expect(moved.edges).toEqual([{ from: 1, to: 0 }]);
  });

  it("ignores moves outside the node list", () => {
    expect(moveDiagramNode(diagram, 0, -1)).toBe(diagram);
    expect(moveDiagramNode(diagram, 2, 1)).toBe(diagram);
    expect(moveDiagramNode(diagram, -1, 1)).toBe(diagram);
  });
});

describe("remapFlowEffectTargets", () => {
  const effects = JSON.stringify([
    { target: { kind: "node", index: 0 }, trigger: { kind: "cue" }, effect: { kind: "appear" } },
    { target: { kind: "node", index: 2 }, trigger: { kind: "cue" }, effect: { kind: "emphasize" } },
    { target: { kind: "nodes" }, trigger: { kind: "cue" }, effect: { kind: "appear" } },
  ]);

  it("swaps node indexes for a reorder", () => {
    const remapped = remapFlowEffectTargets(effects, (index) =>
      index === 0 ? 1 : index === 1 ? 0 : index,
    );
    expect(JSON.parse(remapped ?? "[]")).toEqual([
      { target: { kind: "node", index: 1 }, trigger: { kind: "cue" }, effect: { kind: "appear" } },
      { target: { kind: "node", index: 2 }, trigger: { kind: "cue" }, effect: { kind: "emphasize" } },
      { target: { kind: "nodes" }, trigger: { kind: "cue" }, effect: { kind: "appear" } },
    ]);
  });

  it("drops an effect whose node was removed and shifts later indexes", () => {
    const remapped = remapFlowEffectTargets(effects, (index) =>
      index === 0 ? null : index > 0 ? index - 1 : index,
    );
    expect(JSON.parse(remapped ?? "[]")).toEqual([
      { target: { kind: "node", index: 1 }, trigger: { kind: "cue" }, effect: { kind: "emphasize" } },
      { target: { kind: "nodes" }, trigger: { kind: "cue" }, effect: { kind: "appear" } },
    ]);
  });

  it("ignores empty or malformed effects", () => {
    expect(remapFlowEffectTargets("", (index) => index)).toBeNull();
    expect(remapFlowEffectTargets("not json", (index) => index)).toBeNull();
  });
});
