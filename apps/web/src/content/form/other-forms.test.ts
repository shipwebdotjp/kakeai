import { describe, expect, it } from "vitest";
import {
  contentDocumentSchema,
  createInitialContentDocument,
  createPointScene,
  type Composition,
  type ContentDocument,
  type PointScene,
  type VisualCue,
} from "@kakeai/contracts";
import {
  buildContentDocument,
  cloneSceneFormValue,
  collectLineIds,
  collectSceneIds,
  compositionVersionOptions,
  countAppearanceReferences,
  countCharacterReferences,
  createCueFormValue,
  createEmptyLine,
  createInsertSceneFormValue,
  createPointSceneFormValue,
  defaultOffsetEndMs,
  defaultVideoGate,
  duplicateCueFormValue,
  initialVideoGateLineId,
  newSceneId,
  pruneDraftCueForLines,
  toFormValues,
  NESTED_COMPOSITION_FIT_SUFFIX,
  NESTED_COMPOSITION_POS_X_SUFFIX,
  NESTED_COMPOSITION_POS_Y_SUFFIX,
  NESTED_COMPOSITION_VERSION_SUFFIX,
  NESTED_COMPOSITION_ZOOM_SUFFIX,
  NESTED_MODE_COMPOSITION,
  NESTED_MODE_SUFFIX,
  type LineFormValue,
  type SceneFormValue,
} from "../form";
import { transition, vc, pointScenes, sceneTextCue, setSceneText, readSceneText, standingInput, standingCue } from "./test-helpers";

describe("scene accent", () => {
  it("reads theme and custom accents into the form", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.accent = { kind: "theme", token: "secondary" };
    base.scenes[2]!.accent = { kind: "custom", color: "#123ABC" };
    const values = toFormValues(base);
    expect(values.scenes[1]).toMatchObject({
      accentKind: "theme",
      accentToken: "secondary",
      accentColor: "",
    });
    expect(values.scenes[2]).toMatchObject({
      accentKind: "custom",
      accentColor: "#123ABC",
    });
  });

  it("round-trips a theme token accent", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[1]!.accentKind = "theme";
    values.scenes[1]!.accentToken = "tertiary";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.accent).toEqual({ kind: "theme", token: "tertiary" });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("normalizes a custom accent color to uppercase", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[1]!.accentKind = "custom";
    values.scenes[1]!.accentColor = "#abcdef";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.accent).toEqual({ kind: "custom", color: "#ABCDEF" });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("falls back to the theme default for an empty custom color", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    values.scenes[1]!.accentKind = "custom";
    values.scenes[1]!.accentColor = "";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.accent).toEqual({ kind: "theme", token: "primary" });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("keeps explicit text cue styles through a form round-trip", () => {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const cue = values.scenes[1]!.cues[0]!;
    cue.fields.text = "見出し";
    cue.fields.role = "heading";
    cue.fields.font = "serif";
    cue.fields.fontSize = "80";
    cue.fields.color = "#FF0000";
    cue.fields["decoration.bold"] = "true";
    cue.fields["decoration.italic"] = "";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual({
      text: "見出し",
      role: "heading",
      font: "serif",
      fontSize: 80,
      color: "#FF0000",
      decoration: { bold: true },
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });
});

describe("table.simple form", () => {
  const tableInput = {
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
    style: { preset: "clean", zebra: true, headerAccent: "primary" },
    effects: [
      {
        target: { kind: "rows" },
        trigger: { kind: "cue" },
        effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 150 },
      },
    ],
  };

  function tableCue() {
    return vc({
      id: "vc-table",
      template: { id: "table.simple", version: 1 },
      layer: "overlay",
      input: structuredClone(tableInput),
    });
  }

  it("round-trips table data and nested style/effects fields", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [tableCue()];
    const values = toFormValues(base);
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(tableInput);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("reads nested select fields with defaults and writes them back", () => {
    const base = createInitialContentDocument();
    const input = structuredClone(tableInput) as Record<string, unknown>;
    delete (input as { style?: unknown }).style;
    delete (input as { effects?: unknown }).effects;
    base.scenes[1]!.visualCues = [vc({
      id: "vc-table",
      template: { id: "table.simple", version: 1 },
      layer: "overlay",
      input,
    })];
    const values = toFormValues(base);
    const cue = values.scenes[1]!.cues[0]!;
    expect(cue.fields["style.preset"]).toBe("clean");
    expect(cue.fields["style.headerAccent"]).toBe("");
    expect(cue.fields["style.zebra"]).toBe("");
    cue.fields["style.headerAccent"] = "secondary";
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual({
      caption: tableInput.caption,
      data: tableInput.data,
      style: { preset: "clean", headerAccent: "secondary" },
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("rejects malformed table data on save", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [tableCue()];
    const values = toFormValues(base);
    values.scenes[1]!.cues[0]!.fields.data = JSON.stringify({ columns: [], rows: [] });
    expect(() => buildContentDocument(base, values)).toThrow();
  });

  it("creates new table cues with starter data", () => {
    const cue = createCueFormValue({
      sceneId: "scene-point-1",
      templateId: "table.simple",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    const parsed = JSON.parse(cue.fields.data ?? "") as { columns: unknown[]; rows: unknown[] };
    expect(parsed.columns).toHaveLength(2);
    expect(parsed.rows).toHaveLength(1);
  });

  it("round-trips a spotlight emphasis with an onset", () => {
    const base = createInitialContentDocument();
    const input = {
      ...structuredClone(tableInput),
      effects: [
        {
          target: { kind: "row", index: 1 },
          trigger: { kind: "cue" },
          effect: {
            kind: "emphasize",
            style: "spotlight",
            tone: "warning",
            onset: { preset: "sweep", durationMs: 600 },
          },
        },
      ],
    };
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-table",
        template: { id: "table.simple", version: 1 },
        layer: "overlay",
        input,
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(input);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });
});

describe("chart.bar form", () => {
  const chartInput = {
    title: "月別",
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
    style: { preset: "grid", orientation: "vertical", valueLabels: true, colorBy: "category" },
    effects: [
      {
        target: { kind: "bars" },
        trigger: { kind: "cue" },
        effect: { kind: "appear", preset: "grow", durationMs: 600, staggerMs: 120 },
      },
    ],
  };

  it("round-trips chart data and nested fields", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        layer: "overlay",
        input: structuredClone(chartInput),
      }),
    ];
    const values = toFormValues(base);
    const rebuilt = buildContentDocument(base, values);
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(chartInput);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("reads grid data into a json field and writes it back", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        layer: "overlay",
        input: structuredClone(chartInput),
      }),
    ];
    const values = toFormValues(base);
    const cue = values.scenes[1]!.cues[0]!;
    const parsed = JSON.parse(cue.fields.data ?? "") as { rows: unknown[] };
    expect(parsed.rows).toHaveLength(2);
    cue.fields["style.orientation"] = "horizontal";
    const rebuilt = buildContentDocument(base, values);
    expect(
      (rebuilt.scenes[1]!.visualCues[0]!.input as { style: { orientation: string } }).style
        .orientation,
    ).toBe("horizontal");
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("normalizes legacy chart effect presets on read", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        layer: "overlay",
        input: {
          data: {
            columns: [
              { key: "month", label: "月", type: "text" },
              { key: "sales", label: "売上", type: "number" },
            ],
            rows: [{ month: "1月", sales: 1 }],
          },
          effects: [
            {
              target: { kind: "bars" },
              trigger: { kind: "cue" },
              effect: { kind: "appear", preset: "slide-up", durationMs: 400 },
            },
          ],
        },
      }),
    ];
    const values = toFormValues(base);
    const parsed = JSON.parse(values.scenes[1]!.cues[0]!.fields.effects!) as {
      effect: { preset: string };
    }[];
    expect(parsed[0]!.effect.preset).toBe("fade");
    const rebuilt = buildContentDocument(base, values);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("creates new chart cues with a valid starter grid", () => {
    const cue = createCueFormValue({
      sceneId: "scene-point-1",
      templateId: "chart.bar",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    const parsed = JSON.parse(cue.fields.data ?? "") as {
      columns: { type: string }[];
      rows: unknown[];
    };
    expect(parsed.columns).toHaveLength(2);
    expect(parsed.columns[0]!.type).toBe("text");
    expect(parsed.columns[1]!.type).toBe("number");
    expect(parsed.rows).toHaveLength(1);
  });

  it("round-trips a chart emphasize effect", () => {
    const base = createInitialContentDocument();
    const input = {
      ...structuredClone(chartInput),
      effects: [
        {
          target: { kind: "category", index: 1 },
          trigger: { kind: "cue" },
          effect: { kind: "emphasize", style: "spotlight", tone: "info" },
        },
      ],
    };
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-chart",
        template: { id: "chart.bar", version: 1 },
        layer: "overlay",
        input,
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(input);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });
});

describe("flow.diagram form", () => {
  const flowInput = {
    title: "処理の流れ",
    diagram: {
      nodes: [{ label: "受付" }, { label: "審査", caption: "窓口" }, { label: "完了" }],
      edges: [
        { from: 0, to: 1, label: "書類" },
        { from: 1, to: 2 },
      ],
    },
    style: { orientation: "vertical", preset: "boxed" },
    effects: [
      {
        target: { kind: "nodes" },
        trigger: { kind: "cue" },
        effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 120 },
      },
    ],
  };

  it("round-trips the flow diagram and effects", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-flow",
        template: { id: "flow.diagram", version: 1 },
        layer: "overlay",
        input: structuredClone(flowInput),
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(flowInput);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("creates new flow cues with a starter diagram", () => {
    const cue = createCueFormValue({
      sceneId: "scene-point-1",
      templateId: "flow.diagram",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    const parsed = JSON.parse(cue.fields.diagram ?? "") as {
      nodes: unknown[];
      edges: unknown[];
    };
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
  });
});

describe("stat form", () => {
  const statInput = {
    value: 1200,
    label: "導入社数",
    format: "integer",
    style: { tone: "primary", preset: "card" },
    effects: [{ trigger: { kind: "cue" }, effect: { kind: "value", durationMs: 1000 } }],
  };

  it("round-trips the stat value, format, and count-up effect", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-stat",
        template: { id: "stat", version: 1 },
        layer: "overlay",
        input: structuredClone(statInput),
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(statInput);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("creates new stat cues with a starter value and count-up effect", () => {
    const cue = createCueFormValue({
      sceneId: "scene-point-1",
      templateId: "stat",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    expect(cue.fields.value).toBe("100");
    const effects = JSON.parse(cue.fields.effects ?? "") as { effect: { kind: string } }[];
    expect(effects[0]!.effect.kind).toBe("value");
  });

  it("round-trips a count-up value effect on a numeric table cell", () => {
    const base = createInitialContentDocument();
    const input = {
      data: {
        columns: [
          { key: "name", label: "項目", type: "text" },
          { key: "count", label: "件数", type: "number" },
        ],
        rows: [{ name: "a", count: 120 }],
      },
      style: { preset: "clean" },
      effects: [
        {
          target: { kind: "cell", row: 0, key: "count" },
          trigger: { kind: "cue" },
          effect: { kind: "value", durationMs: 800 },
        },
      ],
    };
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-table",
        template: { id: "table.simple", version: 1 },
        layer: "overlay",
        input,
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(input);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });
});

describe("quote form", () => {
  const quoteInput = {
    quote: "再利用できる",
    author: "山田太郎",
    source: "設計資料",
    style: { tone: "secondary", preset: "card" },
    effects: [
      {
        trigger: { kind: "lines", startLineId: "line-1", endLineId: "line-1" },
        effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
      },
    ],
  };

  it("round-trips the quote, author, source, and a line-triggered effect", () => {
    const base = createInitialContentDocument();
    base.scenes[1]!.lines = [
      {
        id: "line-1",
        speakerId: null,
        captionText: "a",
        speechText: "a",
        selectedAudioTakeId: null,
        expressionId: null,
      },
    ];
    base.scenes[1]!.visualCues = [
      vc({
        id: "vc-quote",
        template: { id: "quote", version: 1 },
        layer: "overlay",
        input: structuredClone(quoteInput),
      }),
    ];
    const rebuilt = buildContentDocument(base, toFormValues(base));
    expect(rebuilt.scenes[1]!.visualCues[0]!.input).toEqual(quoteInput);
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);
  });

  it("creates new quote cues with a card-appear effect", () => {
    const cue = createCueFormValue({
      sceneId: "scene-point-1",
      templateId: "quote",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    const effects = JSON.parse(cue.fields.effects ?? "") as { effect: { kind: string } }[];
    expect(effects[0]!.effect.kind).toBe("appear");
  });
});

describe("compositionVersionOptions", () => {
  const landscape = {
    id: "cmp-1",
    name: "Landscape",
    runtimeCompositionId: "cmp.landscape",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    versions: [
      {
        id: "ver-landscape",
        compositionId: "cmp-1",
        versionNumber: 1,
        bundleHash: "hash-l",
        storageKey: "compositions/bundles/hash-l",
        manifest: {
          entrypoint: "index.html",
          runtimeCompositionId: "cmp.landscape",
          width: 1920,
          height: 1080,
          durationMs: 5000,
          dependencies: [],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  } satisfies Composition;

  const portrait = {
    id: "cmp-2",
    name: "Portrait",
    runtimeCompositionId: "cmp.portrait",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    versions: [
      {
        id: "ver-portrait",
        compositionId: "cmp-2",
        versionNumber: 2,
        bundleHash: "hash-p",
        storageKey: "compositions/bundles/hash-p",
        manifest: {
          entrypoint: "index.html",
          runtimeCompositionId: "cmp.portrait",
          canvasProfile: "portrait",
          width: 1080,
          height: 1920,
          durationMs: 5000,
          dependencies: [],
        },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  } satisfies Composition;

  it("labels versions with their canvas profile", () => {
    const options = compositionVersionOptions([landscape, portrait]);
    expect(options.map((option) => option.value)).toEqual(["ver-landscape", "ver-portrait"]);
    expect(options[0]!.label).toContain("横長");
    expect(options[1]!.label).toContain("縦長");
  });

  it("filters to the requested profiles", () => {
    const options = compositionVersionOptions([landscape, portrait], ["landscape"]);
    expect(options.map((option) => option.value)).toEqual(["ver-landscape"]);
  });

  it("treats a legacy manifest without a profile as landscape", () => {
    const options = compositionVersionOptions([landscape], ["landscape"]);
    expect(options).toHaveLength(1);
  });
});

describe("video playback form fields", () => {
  function gatedScene() {
    const base = createInitialContentDocument();
    const values = toFormValues(base);
    const scene = values.scenes[1]!;
    const line = createEmptyLine(scene.id, collectLineIds(values.scenes));
    line.captionText = "セリフ";
    scene.lines = [line];
    const cue = createCueFormValue({
      sceneId: scene.id,
      templateId: "media.full-bleed",
      templateVersion: 1,
      layer: "background",
      order: 0,
    });
    cue.fields.assetId = "asset-video";
    cue.fields["assetId__videoPlayback"] = JSON.stringify({
      mode: "gated",
      sourceEndMs: 4000,
      gates: [
        {
          narrationSegmentId: line.id,
          sourceMs: 0,
          audio: { enabled: true, gainDb: -6, fadeInMs: 200, fadeOutMs: 200 },
        },
      ],
    });
    scene.cues = [cue];
    return { base, values, scene, line };
  }

  it("round-trips videoPlayback through the form", () => {
    const { base, values, line } = gatedScene();
    const rebuilt = buildContentDocument(base, values);
    const rebuiltScene = rebuilt.scenes[1]!;
    expect(rebuiltScene.visualCues[0]!.input).toMatchObject({
      assetId: "asset-video",
      videoPlayback: {
        mode: "gated",
        sourceEndMs: 4000,
        gates: [{ narrationSegmentId: line.id, sourceMs: 0 }],
      },
    });
    expect(contentDocumentSchema.safeParse(rebuilt).success).toBe(true);

    const reread = toFormValues(rebuilt);
    const rereadCue = reread.scenes[1]!.cues[0]!;
    expect(rereadCue.fields["assetId__videoPlayback"]).toContain("\"mode\":\"gated\"");
  });

  it("omits videoPlayback when the gated field is cleared", () => {
    const { base, values, scene } = gatedScene();
    scene.cues[0]!.fields["assetId__videoPlayback"] = "";
    const rebuilt = buildContentDocument(base, values);
    expect(
      (rebuilt.scenes[1]!.visualCues[0]!.input as { videoPlayback?: unknown }).videoPlayback,
    ).toBeUndefined();
  });

  it("drops gates that reference a removed line", () => {
    const { scene, line } = gatedScene();
    const second = createEmptyLine(scene.id, collectLineIds([scene]));
    second.captionText = "2つ目";
    scene.lines = [line, second];
    scene.cues[0]!.fields["assetId__videoPlayback"] = JSON.stringify({
      mode: "gated",
      gates: [
        { narrationSegmentId: line.id, sourceMs: 0 },
        { narrationSegmentId: second.id, sourceMs: 1000 },
      ],
    });

    const pruned = pruneDraftCueForLines(
      scene.cues[0]!,
      new Set([line.id]),
    );
    const playback = pruned.fields["assetId__videoPlayback"] ?? "";
    expect(playback).toContain(line.id);
    expect(playback).not.toContain(second.id);
  });
});

describe("defaultVideoGate", () => {
  function lines(count: number): LineFormValue[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `line-${index + 1}`,
    }) as LineFormValue);
  }

  it("appends after the last gate without touching existing sourceMs", () => {
    const next = defaultVideoGate(
      [
        { narrationSegmentId: "line-2", sourceMs: 0 },
        { narrationSegmentId: "line-4", sourceMs: 17000 },
      ],
      lines(6),
    );
    // 最終ゲート（4つ目）より後ろの未使用セリフの先頭
    expect(next).toEqual({ narrationSegmentId: "line-5", sourceMs: 18000 });
  });

  it("falls back to the first unused line when nothing is free after the last gate", () => {
    const next = defaultVideoGate(
      [
        { narrationSegmentId: "line-4", sourceMs: 0 },
        { narrationSegmentId: "line-12", sourceMs: 17000 },
      ],
      lines(12),
    );
    // 先頭への挿入では次ゲートの直前に収める（ここでは0）
    expect(next).toEqual({ narrationSegmentId: "line-1", sourceMs: 0 });
  });

  it("fits between neighboring gates", () => {
    const next = defaultVideoGate(
      [
        { narrationSegmentId: "line-1", sourceMs: 0 },
        { narrationSegmentId: "line-8", sourceMs: 17000 },
      ],
      lines(8),
    );
    expect(next).toEqual({ narrationSegmentId: "line-2", sourceMs: 8500 });
  });

  it("returns null when every line is used", () => {
    const next = defaultVideoGate(
      [
        { narrationSegmentId: "line-1", sourceMs: 0 },
        { narrationSegmentId: "line-2", sourceMs: 1000 },
      ],
      lines(2),
    );
    expect(next).toBeNull();
  });
});

describe("initialVideoGateLineId", () => {
  function gateLines(count: number): LineFormValue[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `line-${index + 1}`,
    }) as LineFormValue);
  }

  it("prefers the display range start line", () => {
    expect(initialVideoGateLineId(gateLines(6), "line-4")).toBe("line-4");
  });

  it("falls back to the first line when the range start is unknown", () => {
    expect(initialVideoGateLineId(gateLines(6), "line-99")).toBe("line-1");
    expect(initialVideoGateLineId(gateLines(6), null)).toBe("line-1");
  });

  it("returns null when there are no lines", () => {
    expect(initialVideoGateLineId([], "line-1")).toBeNull();
    expect(initialVideoGateLineId([], null)).toBeNull();
  });
});


describe("defaultOffsetEndMs", () => {
  it("returns 3000ms when the scene duration is unknown", () => {
    expect(defaultOffsetEndMs(null)).toBe(3000);
  });

  it("returns 3000ms for long scenes", () => {
    expect(defaultOffsetEndMs(221556)).toBe(3000);
  });

  it("clamps to the scene duration for short scenes", () => {
    expect(defaultOffsetEndMs(1200)).toBe(1200);
  });

  it("returns at least 1ms", () => {
    expect(defaultOffsetEndMs(0)).toBe(1);
  });
});
