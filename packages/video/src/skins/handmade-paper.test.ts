import { describe, expect, it } from "vitest";
import {
  HANDMADE_PAPER_SKIN_REF,
  getVisualTheme,
  visualThemeDefinitionSchema,
  type ContentDocument,
  type VisualCue,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { compileDocument } from "../compiler";
import { CompositionCompileError } from "../compile-error";
import type { AssetResolver } from "../resolver";
import { cueScope } from "../scope";
import { handmadePaperSkin } from "./handmade-paper";

const baseTheme = getVisualTheme("soft-editorial", 1)!;
const paperTheme: VisualThemeDefinition = visualThemeDefinitionSchema.parse({
  ...baseTheme,
  themeDefinitionSchemaVersion: 2,
  skin: HANDMADE_PAPER_SKIN_REF,
});

const resolver: AssetResolver = (assetId) => {
  if (assetId.includes("audio") || assetId.includes("bgm")) {
    return { url: `/preview/${assetId}`, kind: "audio", durationMs: 3000 };
  }
  return { url: `/preview/${assetId}`, kind: "image" };
};

const transition = {
  enter: { preset: "none", durationMs: 0 },
  exit: { preset: "none", durationMs: 0 },
} as const;

function documentWithCues(cues: VisualCue[]): ContentDocument {
  const document = validContentDocument();
  document.audioTakes = [];
  document.audioCues = [];
  document.scenes = [
    {
      id: "scene-skin",
      kind: "point",
      label: "スキン",
      accent: { kind: "theme", token: "primary" },
      timing: { mode: "fixed", durationMs: 6000 },
      lines: [],
      visualCues: cues,
    },
  ];
  return document;
}

function textCue(id: string, role: string, text: string, input: Record<string, unknown> = {}): VisualCue {
  return {
    id,
    template: { id: "text.block", version: 1 },
    range: { kind: "scene" },
    layer: "overlay",
    order: 0,
    transition,
    input: { text, role, ...input },
  };
}

function compile(cues: VisualCue[]) {
  return compileDocument({
    document: documentWithCues(cues),
    resolvedTheme: paperTheme,
    assetResolver: resolver,
  });
}

describe("handmade-paper@1", () => {
  it("renders a title as a paper slip with tape and a settle motion", () => {
    const compiled = compile([textCue("vc-title", "title", "紙のタイトル")]);
    expect(compiled.html).toContain('class="kakeai-textblock"');
    expect(compiled.html).toContain("kakeai-paper-slip");
    expect(compiled.html).toContain("kakeai-paper-tape");
    expect(compiled.html).toContain("紙のタイトル");

    const slipId = cueScope("vc-title").id("slip");
    expect(compiled.html).toContain(`document.getElementById("${slipId}")`);
    expect(compiled.html).toContain("opacity:0,y:60");
  });

  it("keeps a cue-explicit surface instead of the paper piece", () => {
    const compiled = compile([
      textCue("vc-title", "title", "明示サーフェス", {
        surface: {
          enabled: true,
          backgroundColor: "#123456",
          backgroundOpacity: 1,
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 2,
        },
      }),
    ]);
    expect(compiled.html).toContain("rgba(18,52,86,1)");
    expect(compiled.html).not.toContain("kakeai-paper-slip");
  });

  it("keeps a cue-explicit color over the theme token", () => {
    const compiled = compile([textCue("vc-body", "body", "色の上書き", { color: "#112233" })]);
    expect(compiled.html).toContain("color:#112233");
    expect(compiled.html).not.toContain("kakeai-paper-slip");
  });

  it("renders body text plainly without decoration motion", () => {
    const compiled = compile([textCue("vc-body", "body", "本文は紙の上に直接置く")]);
    expect(compiled.html).toContain("本文は紙の上に直接置く");
    expect(compiled.html).not.toContain("kakeai-paper-slip");
  });

  it("renders a media card as a taped photo with notes", () => {
    const compiled = compile([
      {
        id: "vc-photo",
        template: { id: "media.card", version: 1 },
        range: { kind: "scene" },
        layer: "card",
        order: 0,
        transition,
        input: {
          assetId: "asset-photo",
          heading: "写真の見出し",
          caption: "補足のメモ",
        },
      },
    ]);
    expect(compiled.html).toContain("kakeai-paper-photo");
    expect(compiled.html).toContain("kakeai-paper-tape");
    expect(compiled.html).toContain('src="/preview/asset-photo"');
    expect(compiled.html).toContain("写真の見出し");
    expect(compiled.html).toContain("補足のメモ");
    expect(compiled.assetIds).toContain("asset-photo");

    const frameId = cueScope("vc-photo").id("photo");
    expect(compiled.html).toContain(`document.getElementById("${frameId}")`);
    expect(compiled.html).toContain("scale:0.9");
  });

  it("renders callout items as paper slips and keeps cue effects", () => {
    const compiled = compile([
      {
        id: "vc-points",
        template: { id: "list.callout", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 0,
        transition,
        input: {
          title: "3つの要点",
          items: [
            { text: "ひとつめ" },
            { text: "ふたつめ" },
            { text: "みっつめ" },
          ],
          appear: {
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 300, staggerMs: 90 },
          },
        },
      },
    ]);
    expect(compiled.html).toContain("kakeai-paper-listitem");
    expect(compiled.html).toContain("kakeai-paper-slip");
    expect(compiled.html).toContain("ひとつめ");
    expect(compiled.html).toContain("3つの要点");

    const itemId = cueScope("vc-points").id("item-0");
    expect(compiled.html).toContain(`document.getElementById("${itemId}")`);
    expect(compiled.html).not.toContain("y:60");
  });

  it("adds staggered settle motions only when the cue has no effects", () => {
    const compiled = compile([
      {
        id: "vc-points",
        template: { id: "list.callout", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 0,
        transition,
        input: { items: [{ text: "ひとつめ" }, { text: "ふたつめ" }] },
      },
    ]);
    const firstSlip = cueScope("vc-points").id("slip-0");
    const secondSlip = cueScope("vc-points").id("slip-1");
    expect(compiled.html).toContain(`document.getElementById("${firstSlip}")`);
    expect(compiled.html).toContain(`document.getElementById("${secondSlip}")`);
    expect(compiled.html).toContain("opacity:0,y:60");
  });

  it("renders a quote as a taped paper card with attribution", () => {
    const compiled = compile([
      {
        id: "vc-quote",
        template: { id: "quote", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 0,
        transition,
        input: { quote: "引用の言葉", author: "著者名", source: "出典" },
      },
    ]);
    expect(compiled.html).toContain("kakeai-paper-quotecard");
    expect(compiled.html).toContain("kakeai-paper-quotemark");
    expect(compiled.html).toContain("引用の言葉");
    expect(compiled.html).toContain("著者名");
    expect(compiled.html).toContain("出典");
  });

  it("falls back to the neutral renderer for unsupported templates", () => {
    const compiled = compile([
      {
        id: "vc-table",
        template: { id: "table.simple", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 0,
        transition,
        input: {
          data: {
            columns: [{ key: "a", label: "A", type: "text" }],
            rows: [{ a: "x" }],
          },
        },
      },
      {
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 1,
        transition,
        input: {
          data: {
            columns: [
              { key: "cat", label: "分類", type: "text" },
              { key: "value", label: "値", type: "number" },
            ],
            rows: [{ cat: "A", value: 10 }],
          },
        },
      },
      {
        id: "vc-flow",
        template: { id: "flow.diagram", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 2,
        transition,
        input: { diagram: { nodes: [{ label: "開始" }, { label: "終了" }], edges: [{ from: 0, to: 1 }] } },
      },
      {
        id: "vc-stat",
        template: { id: "stat", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 3,
        transition,
        input: { value: 42, format: "integer" },
      },
      {
        id: "vc-frame",
        template: { id: "scene.device-frame", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 4,
        transition,
        input: { frame: "laptop", screen: { kind: "media", assetId: "asset-photo" } },
      },
    ]);
    expect(compiled.html).toContain("kakeai-tableframe");
    expect(compiled.html).toContain("kakeai-chartframe");
    expect(compiled.html).toContain("kakeai-flowwrap");
    expect(compiled.html).toContain("kakeai-statcard");
    expect(compiled.html).toContain("kakeai-deviceframe");
    expect(compiled.html).not.toContain("kakeai-paper-slip");
  });

  it("draws the scene background with paper fibers instead of the neutral gradient", () => {
    const paper = compile([textCue("vc-body", "body", "背景")]);
    const neutral = compileDocument({
      document: documentWithCues([textCue("vc-body", "body", "背景")]),
      resolvedTheme: baseTheme,
      assetResolver: resolver,
    });
    expect(paper.html).toContain("repeating-linear-gradient");
    expect(paper.html).toContain(baseTheme.canvas.base);
    expect(paper.html).not.toBe(neutral.html);
    expect(handmadePaperSkin.ref).toEqual(HANDMADE_PAPER_SKIN_REF);
  });

  it("keeps the template input error contract", () => {
    expect(() =>
      compile([
        {
          id: "vc-photo",
          template: { id: "media.card", version: 1 },
          range: { kind: "scene" },
          layer: "card",
          order: 0,
          transition,
          input: { assetId: "asset-photo", heading: 1 },
        } as unknown as VisualCue,
      ]),
    ).toThrow(CompositionCompileError);
  });
});
