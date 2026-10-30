import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { VisualCue } from "@kakeai/contracts";
import { compileDocument } from "../compiler";
import { LANDSCAPE_CANVAS, PORTRAIT_CANVAS } from "../canvas";
import { resolver } from "./test-helpers";

function cue(
  id: string,
  template: { id: string; version: number },
  input: unknown,
): VisualCue {
  return {
    id,
    template,
    range: { kind: "scene" },
    layer: "overlay",
    order: 0,
    transition: {
      enter: { preset: "none", durationMs: 0 },
      exit: { preset: "none", durationMs: 0 },
    },
    input,
  };
}

/**
 * Every inline `width` / `max-width` in pixels must fit the canvas. Fixed
 * widths larger than the canvas are the failure mode the portrait migration
 * avoids (a 1280px chart on a 1080px canvas), so this audit is the automatic
 * replacement for pixel golden frames, which would depend on installed fonts.
 */
function oversizedInlineWidths(html: string, canvasWidth: number): string[] {
  const oversized: string[] = [];
  for (const styleMatch of html.matchAll(/style="([^"]*)"/g)) {
    for (const declaration of styleMatch[1]!.split(";")) {
      const width = /^\s*(max-)?width\s*:\s*(\d+)px\s*$/.exec(declaration);
      if (width === null) {
        continue;
      }
      const value = Number(width[2]);
      if (value > canvasWidth) {
        oversized.push(declaration.trim());
      }
    }
  }
  return oversized;
}

function documentWithWideTemplates() {
  const document = validContentDocument();
  const scene = document.scenes[1]!;
  scene.visualCues.push(
    cue("vc-chart-golden", { id: "chart.bar", version: 1 }, {
      title: "月別売上",
      data: {
        columns: [
          { key: "month", label: "月", type: "text" },
          { key: "sales", label: "売上", type: "number" },
        ],
        rows: [
          { month: "1月", sales: 100 },
          { month: "2月", sales: 200 },
        ],
      },
    }),
    cue("vc-table-golden", { id: "table.simple", version: 1 }, {
      caption: "料金プラン",
      data: {
        columns: [
          { key: "name", label: "プラン", type: "text" },
          { key: "price", label: "月額", type: "number" },
        ],
        rows: [
          { name: "Free", price: 0 },
          { name: "Pro", price: 1500 },
        ],
      },
    }),
    cue("vc-list-golden", { id: "list.callout", version: 1 }, {
      title: "要点",
      items: [{ text: "再利用できる" }, { text: "表記ゆれを防ぐ" }],
      width: "long",
      align: "center",
    }),
  );
  return document;
}

describe("canvas layout audit", () => {
  it("keeps every inline pixel width inside the landscape canvas", () => {
    const compiled = compileDocument({
      document: documentWithWideTemplates(),
      assetResolver: resolver,
    });
    expect(oversizedInlineWidths(compiled.html, LANDSCAPE_CANVAS.width)).toEqual([]);
  });

  it("keeps every inline pixel width inside the portrait canvas", () => {
    const compiled = compileDocument({
      document: documentWithWideTemplates(),
      assetResolver: resolver,
      outputProfile: "portrait",
    });
    expect(oversizedInlineWidths(compiled.html, PORTRAIT_CANVAS.width)).toEqual([]);
  });
});
