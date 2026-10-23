import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { RenderContext } from "../render-context";
import { neutralVisualSkin } from "../skins/neutral";
import { cueScope } from "../scope";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { renderFlowDiagram } from "./flow-diagram";

const theme = getVisualTheme("soft-editorial", 1)!;

const assetResolver: AssetResolver = (assetId) => ({ url: `/preview/${assetId}`, kind: "image" });

function context(): RenderContext {
  return {
    document: validContentDocument(),
    theme,
    skin: neutralVisualSkin,
    assetResolver,
    scope: cueScope("visual-flow-1"),
    path: ["scenes", 1, "visualCues", 2, "input"],
    renderNested: () => {
      throw new Error("nested visuals are not used by flow.diagram");
    },
  };
}

function timedContext(): RenderContext {
  return {
    ...context(),
    cueTiming: { startMs: 0, spanMs: 9000 },
    lineIntervals: [
      { lineId: "l1", startMs: 500, endMs: 1500 },
      { lineId: "l2", startMs: 1500, endMs: 2500 },
    ],
  };
}

const baseInput = {
  title: "処理の流れ",
  diagram: {
    nodes: [{ label: "受付" }, { label: "審査", caption: "窓口" }, { label: "完了" }],
    edges: [
      { from: 0, to: 1, label: "書類" },
      { from: 1, to: 2 },
    ],
  },
};

describe("renderFlowDiagram", () => {
  it("renders the title, node labels, and edge connectors", () => {
    const rendered = renderFlowDiagram(baseInput, context());
    expect(rendered.assetIds).toEqual([]);
    expect(rendered.html).toContain("処理の流れ");
    expect(rendered.html).toContain("受付");
    expect(rendered.html).toContain("窓口");
    expect(rendered.html).toContain("kakeai-flowered");
    expect(rendered.html).toContain("marker-end");
    expect(rendered.html).toContain("書類");
  });

  it("lays nodes out differently for horizontal and vertical orientations", () => {
    const horizontal = renderFlowDiagram(baseInput, context());
    const vertical = renderFlowDiagram(
      { ...baseInput, style: { orientation: "vertical", preset: "clean" } },
      context(),
    );
    expect(horizontal.html).toContain("kakeai-flow-horizontal");
    expect(vertical.html).toContain("kakeai-flow-vertical");
    expect(horizontal.html).not.toBe(vertical.html);
  });

  it("keeps every node inside the plot at the maximum node count", () => {
    const nodes = Array.from({ length: 8 }, (_value, index) => ({ label: `N${index}` }));
    const rendered = renderFlowDiagram(
      {
        diagram: { nodes, edges: [] },
        style: { orientation: "vertical", preset: "clean" },
      },
      context(),
    );
    const tops = [...rendered.html.matchAll(/top:(-?[0-9.]+)px/g)].map((match) =>
      Number(match[1]),
    );
    expect(tops).toHaveLength(8);
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(0);
  });

  it("straightens adjacent edges and routes skipped edges outside the nodes", () => {
    const rendered = renderFlowDiagram(
      {
        ...baseInput,
        diagram: {
          ...baseInput.diagram,
          edges: [
            { from: 0, to: 1, label: "書類" },
            { from: 0, to: 2, label: "特例" },
          ],
        },
        style: { orientation: "vertical", preset: "clean" },
      },
      context(),
    );
    const paths = [...rendered.html.matchAll(/class="kakeai-flowered" d="([^"]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain(" L ");
    expect(paths[1]).toContain(" C ");
    expect(rendered.html).toContain('style="text-anchor:start">書類</text>');
    expect(rendered.html).toContain('style="text-anchor:end">特例</text>');
    for (const path of paths) {
      const numbers = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      expect(numbers.length).toBeGreaterThan(0);
      for (let index = 0; index + 1 < numbers.length; index += 2) {
        expect(numbers[index]).toBeGreaterThanOrEqual(0);
        expect(numbers[index]).toBeLessThanOrEqual(1320);
        expect(numbers[index + 1]).toBeGreaterThanOrEqual(0);
        expect(numbers[index + 1]).toBeLessThanOrEqual(760);
      }
    }
  });

  it("rejects invalid input", () => {
    expect(() =>
      renderFlowDiagram({ diagram: { nodes: [], edges: [] } }, context()),
    ).toThrow(CompositionCompileError);
  });

  it("renders deterministically for the same input", () => {
    const first = renderFlowDiagram(baseInput, context());
    const second = renderFlowDiagram(baseInput, context());
    expect(first.html).toBe(second.html);
    expect(first.animation).toEqual(second.animation);
  });

  it("keeps two flow cues from colliding", () => {
    const a = renderFlowDiagram(baseInput, { ...context(), scope: cueScope("vc-a") });
    const b = renderFlowDiagram(baseInput, { ...context(), scope: cueScope("vc-b") });
    expect(a.html).not.toBe(b.html);
  });
});

describe("renderFlowDiagram effects", () => {
  it("appears all nodes with a stagger and hides later ones until their turn", () => {
    const scope = cueScope("visual-flow-1");
    const rendered = renderFlowDiagram(
      {
        ...baseInput,
        effects: [
          {
            target: { kind: "nodes" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 300, staggerMs: 100 },
          },
        ],
      },
      timedContext(),
    );
    expect(rendered.animation).toEqual([
      { targetId: scope.id("node-0"), action: "fade", startMs: 0, durationMs: 300 },
      { targetId: scope.id("node-1"), action: "fade", startMs: 100, durationMs: 300 },
      { targetId: scope.id("node-2"), action: "fade", startMs: 200, durationMs: 300 },
    ]);
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("node-2"),
      intervals: [{ startMs: 0, endMs: 200 }],
      on: { opacity: 0 },
      off: { opacity: 1 },
    });
  });

  it("rings the spotlighted node and dims the other nodes", () => {
    const scope = cueScope("visual-flow-1");
    const rendered = renderFlowDiagram(
      {
        ...baseInput,
        effects: [
          {
            target: { kind: "node", index: 1 },
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
            effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
          },
        ],
      },
      timedContext(),
    );
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("node-1"),
      intervals: [{ startMs: 500, endMs: 1500 }],
      on: { boxShadow: expect.stringContaining("inset") },
      off: { boxShadow: "none" },
    });
    for (const nodeId of [scope.id("node-0"), scope.id("node-2")]) {
      expect(rendered.stateIntervals).toContainEqual({
        targetId: nodeId,
        intervals: [{ startMs: 500, endMs: 1500 }],
        on: { filter: "brightness(0.4)" },
        off: { filter: "none" },
      });
    }
  });

  it("sweeps an onset overlay on a highlighted node", () => {
    const scope = cueScope("visual-flow-1");
    const rendered = renderFlowDiagram(
      {
        ...baseInput,
        effects: [
          {
            target: { kind: "node", index: 0 },
            trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
            effect: {
              kind: "emphasize",
              style: "frame",
              tone: "info",
              onset: { preset: "sweep", durationMs: 600 },
            },
          },
        ],
      },
      timedContext(),
    );
    const overlayId = `${scope.id("node-0")}-onset`;
    expect(rendered.animation).toContainEqual({
      targetId: overlayId,
      action: "sweep",
      ease: "normal",
      startMs: 1500,
      durationMs: 600,
    });
    expect(rendered.html).toContain(`id="${overlayId}"`);
    expect(rendered.html).toContain("kakeai-onset-sweep");
  });
});
