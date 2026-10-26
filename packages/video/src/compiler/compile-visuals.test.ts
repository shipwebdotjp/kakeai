import { describe, expect, it } from "vitest";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { ONSET_PRESETS, createInsertScene, getVisualTheme, type SnapshotFaceSet, type VisualCue } from "@kakeai/contracts";
import type { AssetResolver, FaceSetResolver } from "../resolver";
import type { CompositionVersionResolver } from "../composition-resolver";
import { CompositionCompileError } from "../compile-error";
import { compileDocument } from "../compiler";
import { cueScope } from "../scope";
import { mixHex } from "../theme";
import { resolver, videoResolver, videoResolverWithDuration, compositionResolver, compositionResolverWithDuration, transition, cue, clipId } from "./test-helpers";

describe("compileDocument", () => {
  it("renders a device-frame composition with nested media at background and card", () => {
    for (const [layer, assetId] of [
      ["background", "asset-screen-image"],
      ["card", "asset-screen-video"],
    ] as const) {
      const document = validContentDocument();
      document.scenes[0]!.visualCues = [
        cue({
          id: `vc-device-${layer}`,
          template: { id: "scene.device-frame", version: 1 },
          layer,
          input: {
            frame: "laptop",
            screen: { kind: "media", assetId, fit: "cover" },
          },
        }),
      ];
      const compiled = compileDocument({ document, assetResolver: resolver });
      expect(compiled.assetIds).toContain(assetId);
      expect(compiled.html).toContain("kakeai-deviceframe");
      expect(compiled.html).toContain(`src="/preview/${assetId}"`);
      const nestedId = cueScope(`vc-device-${layer}`).child("screen").id("media");
      expect(compiled.html).toContain(`id="${nestedId}"`);
    }
  });

  it("shows device-frame chrome by default and hides it when disabled", () => {
    const compileDevice = (id: string, input: Record<string, unknown>) => {
      const document = validContentDocument();
      document.scenes[0]!.visualCues = [
        cue({ id, template: { id: "scene.device-frame", version: 1 }, layer: "background", input }),
      ];
      return compileDocument({ document, assetResolver: resolver });
    };
    const screen = { kind: "media", assetId: "asset-screen-image", fit: "cover" } as const;

    const phone = compileDevice("vc-device-status", { frame: "phone", screen });
    expect(phone.html).toContain('class="kakeai-deviceframe-status kakeai-statusbar"');
    expect(phone.html).toContain("kakeai-statusbar-island");
    expect(phone.html).not.toContain('class="kakeai-laptopbase"');

    const phoneOff = compileDevice("vc-device-status-off", {
      frame: "phone",
      statusBar: false,
      screen,
    });
    expect(phoneOff.html).not.toContain('class="kakeai-deviceframe-status');

    const laptop = compileDevice("vc-device-keyboard", { frame: "laptop", screen });
    expect(laptop.html).toContain("kakeai-deviceframe-keyboard");
    expect(laptop.html).toContain('class="kakeai-laptopbase"');
    expect(laptop.html).not.toContain('class="kakeai-deviceframe-status');

    const laptopOff = compileDevice("vc-device-keyboard-off", {
      frame: "laptop",
      keyboard: false,
      screen,
    });
    expect(laptopOff.html).not.toContain('class="kakeai-laptopbase"');
  });

  it("renders a nested composition in a device-frame screen with contain fit", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-comp",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "composition", compositionVersionId: "ver-nested", fit: "contain" },
        },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver,
    });
    const zoomId = cueScope("vc-device-comp").child("screen").id("compzoom");
    expect(compiled.html).toContain("kakeai-compslot");
    expect(compiled.html).toContain(`id="${zoomId}"`);
    expect(compiled.html).toContain(
      "--kakeai-s:min(tan(atan2(100cqw,1920px)),tan(atan2(100cqh,1080px)))",
    );
    expect(compiled.html).toContain('data-composition-src="/preview/composition"');
    expect(compiled.compositionVersions).toHaveLength(1);
    expect(compiled.compositionVersions[0]!.id).toBe("ver-nested");
  });

  it("renders a portrait composition in a phone screen at default contain without letterbox", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-portrait",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "phone",
          screen: { kind: "composition", compositionVersionId: "ver-portrait", fit: "contain" },
        },
      }),
    ];
    const portraitResolver: CompositionVersionResolver = (versionId) => ({
      id: versionId,
      runtimeCompositionId: "cmp.portrait",
      entrypoint: "index.html",
      bundleHash: "bundle-portrait",
      storageKey: "compositions/portrait",
      previewUrl: "/preview/portrait",
      manifest: {
        entrypoint: "index.html",
        runtimeCompositionId: "cmp.portrait",
        canvasProfile: "portrait",
        width: 1080,
        height: 1920,
        durationMs: 5000,
        dependencies: [],
      },
    });
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver: portraitResolver,
    });
    expect(compiled.html).toContain("aspect-ratio:9/16");
    expect(compiled.html).toContain("--kakeai-cw:1080px;--kakeai-ch:1920px");
    expect(compiled.html).toContain(
      "--kakeai-s:min(tan(atan2(100cqw,1080px)),tan(atan2(100cqh,1920px)))",
    );
    expect(compiled.html).toContain('data-width="1080"');
    expect(compiled.html).toContain('data-height="1920"');
    expect(compiled.compositionVersions[0]!.manifest.canvasProfile).toBe("portrait");
  });

  it("rejects a portrait composition in composition.full-bleed", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-fullbleed-portrait",
        template: { id: "composition.full-bleed", version: 1 },
        layer: "background",
        input: { compositionVersionId: "ver-portrait" },
      }),
    ];
    const portraitResolver: CompositionVersionResolver = (versionId) => ({
      id: versionId,
      runtimeCompositionId: "cmp.portrait",
      entrypoint: "index.html",
      bundleHash: "bundle-portrait",
      storageKey: "compositions/portrait",
      previewUrl: "/preview/portrait",
      manifest: {
        entrypoint: "index.html",
        runtimeCompositionId: "cmp.portrait",
        canvasProfile: "portrait",
        width: 1080,
        height: 1920,
        durationMs: 5000,
        dependencies: [],
      },
    });
    expect(() =>
      compileDocument({
        document,
        assetResolver: resolver,
        compositionResolver: portraitResolver,
      }),
    ).toThrow(/composition\.full-bleed/);
  });

  it("applies cover fit, zoom and position to a nested composition", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-comp-cover",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "phone",
          screen: {
            kind: "composition",
            compositionVersionId: "ver-nested",
            fit: "cover",
            zoom: 1.5,
            position: { x: 0.2, y: 0.8 },
          },
        },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver,
    });
    expect(compiled.html).toContain(
      "--kakeai-s:calc(max(tan(atan2(100cqw,1920px)),tan(atan2(100cqh,1080px))) * 1.5)",
    );
    expect(compiled.html).toContain("--kakeai-posx:0.2");
    expect(compiled.html).toContain("--kakeai-posy:0.8");
  });

  it("hides a nested composition at its own end when shorter than the cue", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-comp-short",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "composition", compositionVersionId: "ver-nested", fit: "contain" },
        },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver: compositionResolverWithDuration(1000),
    });
    const zoomId = cueScope("vc-device-comp-short").child("screen").id("compzoom");
    expect(compiled.html).toContain(
      `tl.set(document.getElementById("${zoomId}"),{opacity:0},1);`,
    );
  });

  it("does not hide a nested composition that covers the whole cue", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device-comp-full",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "composition", compositionVersionId: "ver-nested", fit: "contain" },
        },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver: compositionResolverWithDuration(5000),
    });
    const zoomId = cueScope("vc-device-comp-full").child("screen").id("compzoom");
    expect(compiled.html).not.toContain(
      `tl.set(document.getElementById("${zoomId}"),{opacity:0}`,
    );
  });

  it("places the same CompositionVersion in two device screens (R2)", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-screen-a",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        order: 0,
        input: {
          frame: "laptop",
          screen: { kind: "composition", compositionVersionId: "ver-nested", fit: "contain" },
        },
      }),
      cue({
        id: "vc-screen-b",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        order: 1,
        input: {
          frame: "phone",
          screen: { kind: "composition", compositionVersionId: "ver-nested", fit: "cover" },
        },
      }),
    ];
    const compiled = compileDocument({
      document,
      assetResolver: resolver,
      compositionResolver,
    });
    const hostA = cueScope("vc-screen-a").child("screen").id("comp-host");
    const hostB = cueScope("vc-screen-b").child("screen").id("comp-host");
    expect(compiled.html).toContain(`id="${hostA}"`);
    expect(compiled.html).toContain(`id="${hostB}"`);
    expect(hostA).not.toBe(hostB);
    expect(compiled.compositionVersions).toHaveLength(1);
  });

  it("applies non-fade cue transition presets", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues[0]!.transition = {
      enter: { preset: "slide-up", durationMs: 300 },
      exit: { preset: "none", durationMs: 0 },
    };
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("y:60");
  });

  it("animates the device-frame screen for scene.device-frame@1", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-device2",
        template: { id: "scene.device-frame", version: 1 },
        layer: "background",
        input: {
          frame: "laptop",
          screen: { kind: "media", assetId: "asset-screen", fit: "cover" },
          animation: { preset: "scale-in", durationMs: 400 },
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const screenId = cueScope("vc-device2").id("screen");
    expect(compiled.html).toContain(`document.getElementById("${screenId}")`);
    expect(compiled.html).toContain("scale:0.9");
  });

  it("renders a site-mockup with chrome, nested media and logo", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-mockup",
        template: { id: "scene.site-mockup", version: 1 },
        layer: "card",
        input: {
          variant: "github",
          theme: "dark",
          name: "kakeai",
          handle: "@kakeai",
          caption: "README",
          screen: { kind: "media", assetId: "asset-screen", fit: "cover" },
          logo: { kind: "media", assetId: "asset-logo", fit: "contain" },
          animation: { preset: "slide-up", durationMs: 300 },
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.assetIds).toContain("asset-screen");
    expect(compiled.assetIds).toContain("asset-logo");
    expect(compiled.html).toContain("kakeai-mockup-github");
    expect(compiled.html).toContain("kakeai-mockup-theme-dark");
    const screenId = cueScope("vc-mockup").id("screen");
    expect(compiled.html).toContain(`id="${screenId}"`);
    expect(compiled.html).toContain(`document.getElementById("${screenId}")`);
    expect(compiled.html).toContain("y:60");
  });

  it("keeps two site-mockups from colliding", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-a",
        template: { id: "scene.site-mockup", version: 1 },
        layer: "card",
        order: 0,
        input: { variant: "x", screen: { kind: "media", assetId: "asset-a", fit: "cover" } },
      }),
      cue({
        id: "vc-b",
        template: { id: "scene.site-mockup", version: 1 },
        layer: "card",
        order: 1,
        input: { variant: "x", screen: { kind: "media", assetId: "asset-b", fit: "cover" } },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const a = cueScope("vc-a").id("screen");
    const b = cueScope("vc-b").id("screen");
    expect(a).not.toBe(b);
    expect(compiled.html).toContain(`id="${a}"`);
    expect(compiled.html).toContain(`id="${b}"`);
  });

  it("rejects a nested-template screen in scene.site-mockup", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-bad",
        template: { id: "scene.site-mockup", version: 1 },
        layer: "card",
        input: {
          variant: "x",
          screen: {
            kind: "template",
            template: { id: "text.block", version: 1 },
            input: { text: "b", role: "body" },
          },
        },
      }),
    ];
    expect(() => compileDocument({ document, assetResolver: resolver })).toThrow(
      CompositionCompileError,
    );
  });

  it("renders a table.simple cue with staggered row tweens", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-table",
        template: { id: "table.simple", version: 1 },
        layer: "overlay",
        input: {
          caption: "料金プラン",
          data: {
            columns: [
              { key: "name", label: "プラン", type: "text" },
              { key: "price", label: "月額", type: "number", format: "currency" },
            ],
            rows: [
              { name: "Free", price: 0 },
              { name: "Pro", price: 1500 },
            ],
          },
          effects: [
            {
              target: { kind: "rows" },
              trigger: { kind: "cue" },
              effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 150 },
            },
          ],
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("kakeai-table");
    expect(compiled.html).toContain("1,500");
    const firstRow = cueScope("vc-table").id("row-0");
    const secondRow = cueScope("vc-table").id("row-1");
    expect(compiled.html).toContain(`document.getElementById("${firstRow}")`);
    expect(compiled.html).toContain(`document.getElementById("${secondRow}")`);
    expect(compiled.html).toContain("opacity:0");
  });

  it("keeps two table.simple cues from colliding", () => {
    const document = validContentDocument();
    const input = {
      data: {
        columns: [{ key: "name", label: "項目", type: "text" }],
        rows: [{ name: "a" }],
      },
    };
    document.scenes[0]!.visualCues = [
      cue({ id: "vc-table-a", template: { id: "table.simple", version: 1 }, layer: "overlay", order: 0, input }),
      cue({ id: "vc-table-b", template: { id: "table.simple", version: 1 }, layer: "overlay", order: 1, input }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const a = cueScope("vc-table-a").id("row-0");
    const b = cueScope("vc-table-b").id("row-0");
    expect(a).not.toBe(b);
    expect(compiled.html).toContain(`id="${a}"`);
    expect(compiled.html).toContain(`id="${b}"`);
  });

  it("renders a list.callout cue with line-triggered emphasis", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues = [
      cue({
        id: "vc-callout",
        template: { id: "list.callout", version: 1 },
        layer: "overlay",
        input: {
          items: [
            {
              text: "再利用できる",
              trigger: { kind: "lines", startLineId: "line-p1-1", endLineId: "line-p1-1" },
              effect: { kind: "emphasize", style: "frame", tone: "primary" },
            },
            { text: "常時表示" },
          ],
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    expect(compiled.html).toContain("再利用できる");
    const item = cueScope("vc-callout").id("item-0");
    expect(compiled.html).toContain(`document.getElementById("${item}")`);
    expect(compiled.html).toContain("boxShadow");
  });

  it("renders a chart.bar cue with growing bars", () => {
    const document = validContentDocument();
    document.scenes[0]!.visualCues = [
      cue({
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        layer: "overlay",
        input: {
          title: "月別売上",
          data: {
            columns: [
              { key: "month", label: "月", type: "text" },
              { key: "sales", label: "売上", type: "number", format: "currency" },
            ],
            rows: [
              { month: "1月", sales: 100 },
              { month: "2月", sales: 200 },
            ],
          },
          effects: [
            {
              target: { kind: "bars" },
              trigger: { kind: "cue" },
              effect: { kind: "appear", preset: "bounce", durationMs: 600, staggerMs: 120 },
            },
          ],
        },
      }),
    ];
    const compiled = compileDocument({ document, assetResolver: resolver });
    const firstBar = cueScope("vc-chart").id("bar-0-0");
    const secondBar = cueScope("vc-chart").id("bar-1-0");
    expect(compiled.html).toContain("kakeai-chart");
    expect(compiled.html).toContain("￥200");
    expect(compiled.html).toContain(`document.getElementById("${firstBar}")`);
    expect(compiled.html).toContain(`document.getElementById("${secondBar}")`);
    expect(compiled.html).toContain("scaleY:0");
    expect(compiled.html).toContain('ease:"back.out(1.6)"');
  });
});
