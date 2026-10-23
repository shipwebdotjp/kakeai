import { describe, expect, it } from "vitest";
import {
  chartBarInputSchema,
  chatThreadInputSchema,
  chatThreadV1,
  deviceFrameInputSchema,
  flowDiagramInputSchema,
  getTemplateInputFields,
  getVisualTemplate,
  isEditableTemplate,
  listCalloutInputSchema,
  listVisualTemplateCatalog,
  mediaCardInputSchema,
  mediaFullBleedInputSchema,
  quoteInputSchema,
  statInputSchema,
  tableSimpleInputSchema,
} from "./index";

describe("visual template metadata", () => {
  it("registers scene.device-frame@1 with an animation field", () => {
    const fields = getTemplateInputFields("scene.device-frame", 1);
    expect(fields?.some((field) => field.kind === "animation")).toBe(true);
    expect(isEditableTemplate("scene.device-frame", 1)).toBe(true);
  });

  it("accepts optional status bar and keyboard chrome on scene.device-frame", () => {
    const screen = { kind: "media", assetId: "asset-1" } as const;
    expect(
      deviceFrameInputSchema.safeParse({ frame: "phone", statusBar: true, screen }).success,
    ).toBe(true);
    expect(
      deviceFrameInputSchema.safeParse({ frame: "laptop", keyboard: true, screen }).success,
    ).toBe(true);
    expect(
      deviceFrameInputSchema.safeParse({ frame: "phone", keyboard: "yes", screen }).success,
    ).toBe(false);
    const defaults = deviceFrameInputSchema.safeParse({ frame: "phone", screen });
    expect(defaults.success).toBe(true);
    if (defaults.success) {
      expect(defaults.data.statusBar).toBe(true);
      expect(defaults.data.keyboard).toBe(true);
    }
    const fields = getTemplateInputFields("scene.device-frame", 1);
    expect(fields?.some((field) => field.kind === "boolean" && field.key === "statusBar")).toBe(
      true,
    );
    expect(fields?.some((field) => field.kind === "boolean" && field.key === "keyboard")).toBe(
      true,
    );
  });

  it("marks the unified text template as editable via generic fields", () => {
    expect(isEditableTemplate("text.block", 1)).toBe(true);
    const fields = getTemplateInputFields("text.block", 1);
    expect(fields?.some((field) => field.kind === "number")).toBe(true);
    expect(fields?.some((field) => field.kind === "boolean")).toBe(true);
  });

  it("registers scene.site-mockup@1 as an editable card/overlay template", () => {
    const definition = getVisualTemplate("scene.site-mockup", 1);
    expect(definition?.layers).toEqual(["card", "overlay"]);
    expect(isEditableTemplate("scene.site-mockup", 1)).toBe(true);
    const fields = getTemplateInputFields("scene.site-mockup", 1);
    expect(fields?.some((field) => field.kind === "animation")).toBe(true);
    expect(fields?.some((field) => field.key === "logo")).toBe(true);
  });

  it("exposes an editable flag in the catalog", () => {
    const catalog = listVisualTemplateCatalog();
    const standing = catalog.find((entry) => entry.id === "character.standing");
    expect(standing?.editable).toBe(false);
    const deviceFrame = catalog.find(
      (entry) => entry.id === "scene.device-frame" && entry.version === 1,
    );
    expect(deviceFrame?.editable).toBe(true);
  });

  it("registers media.card@1 with an aspect ratio field defaulted to 16:9", () => {
    const fields = getTemplateInputFields("media.card", 1);
    const aspectRatio = fields?.find((field) => field.key === "aspectRatio");
    expect(aspectRatio?.kind).toBe("select");
    if (aspectRatio?.kind === "select") {
      expect(aspectRatio.options.map((option) => option.value)).toEqual([
        "16:9",
        "4:3",
        "1:1",
        "3:4",
        "9:16",
      ]);
    }
    const parsed = mediaCardInputSchema.safeParse({ assetId: "asset-1", heading: "見出し" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.aspectRatio).toBe("16:9");
    }
  });

  it("returns undefined for unknown template versions", () => {
    expect(getVisualTemplate("scene.device-frame", 99)).toBeUndefined();
    expect(getTemplateInputFields("scene.device-frame", 99)).toBeUndefined();
  });

  it("registers a mediaCrop field for focalPoint on full-bleed and card templates", () => {
    for (const id of ["media.full-bleed", "media.card"]) {
      const fields = getTemplateInputFields(id, 1);
      const crop = fields?.find((field) => field.kind === "mediaCrop");
      expect(crop?.kind).toBe("mediaCrop");
      if (crop?.kind === "mediaCrop") {
        expect(crop.key).toBe("focalPoint");
        expect(crop.zoomKey).toBe("zoom");
      }
    }
  });

  it("accepts an optional zoom on full-bleed and card inputs", () => {
    expect(
      mediaFullBleedInputSchema.safeParse({ assetId: "asset-1", fit: "cover", zoom: 1.5 }).success,
    ).toBe(true);
    expect(
      mediaCardInputSchema.safeParse({ assetId: "asset-1", heading: "h", zoom: 0.5 }).success,
    ).toBe(true);
    expect(
      mediaFullBleedInputSchema.safeParse({ assetId: "asset-1", fit: "cover", zoom: 4 }).success,
    ).toBe(false);
  });

  it("accepts an optional loop on full-bleed and card @1 inputs", () => {
    expect(
      mediaFullBleedInputSchema.safeParse({ assetId: "asset-1", fit: "cover", loop: true })
        .success,
    ).toBe(true);
    expect(
      mediaCardInputSchema.safeParse({ assetId: "asset-1", heading: "h", loop: false }).success,
    ).toBe(true);
    expect(
      mediaFullBleedInputSchema.safeParse({ assetId: "asset-1", fit: "cover", loop: "yes" })
        .success,
    ).toBe(false);
  });

  it("registers a loop field on the @1 media templates", () => {
    for (const id of ["media.full-bleed", "media.card"]) {
      expect(getTemplateInputFields(id, 1)?.some((field) => field.key === "loop")).toBe(true);
      expect(getVisualTemplate(id, 2)).toBeUndefined();
    }
  });

  it("registers table.simple@1 as an editable card/overlay template with a table field", () => {
    const definition = getVisualTemplate("table.simple", 1);
    expect(definition?.layers).toEqual(["card", "overlay"]);
    expect(isEditableTemplate("table.simple", 1)).toBe(true);
    const fields = getTemplateInputFields("table.simple", 1);
    expect(fields?.some((field) => field.kind === "grid" && field.key === "data")).toBe(true);
  });

  it("accepts a minimal table.simple input", () => {
    const parsed = tableSimpleInputSchema.safeParse({
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
    });
    expect(parsed.success).toBe(true);
  });

  it("registers chart.bar@1 as an editable card/overlay template with a grid field", () => {
    const definition = getVisualTemplate("chart.bar", 1);
    expect(definition?.layers).toEqual(["card", "overlay"]);
    expect(isEditableTemplate("chart.bar", 1)).toBe(true);
    const fields = getTemplateInputFields("chart.bar", 1);
    const grid = fields?.find((field) => field.kind === "grid");
    expect(grid?.kind).toBe("grid");
    if (grid?.kind === "grid") {
      expect(grid.key).toBe("data");
      expect(grid.dataKind).toBe("chart");
    }
  });

  it("accepts a multi-series chart.bar input", () => {
    const parsed = chartBarInputSchema.safeParse({
      title: "月別",
      data: {
        columns: [
          { key: "month", label: "月", type: "text" },
          { key: "sales", label: "売上", type: "number", format: "currency" },
          { key: "cost", label: "費用", type: "number" },
        ],
        rows: [{ month: "1月", sales: 120, cost: 80 }],
      },
      effects: [
        {
          target: { kind: "bars" },
          trigger: { kind: "cue" },
          effect: { kind: "appear", preset: "bounce", durationMs: 600, staggerMs: 120 },
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects chart.bar data whose first column is not a category or whose series is not numeric", () => {
    expect(
      chartBarInputSchema.safeParse({
        data: {
          columns: [
            { key: "a", label: "A", type: "number" },
            { key: "b", label: "B", type: "number" },
          ],
          rows: [{ a: 1, b: 2 }],
        },
      }).success,
    ).toBe(false);
    expect(
      chartBarInputSchema.safeParse({
        data: {
          columns: [
            { key: "a", label: "A", type: "text" },
            { key: "b", label: "B", type: "text" },
          ],
          rows: [{ a: "x", b: "y" }],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects chart.bar emphasis because the schema is strict", () => {
    expect(
      chartBarInputSchema.safeParse({
        data: {
          columns: [
            { key: "a", label: "A", type: "text" },
            { key: "b", label: "B", type: "number" },
          ],
          rows: [{ a: "x", b: 1 }],
          emphasis: [],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects non-numeric strings in chart.bar series cells", () => {
    expect(
      chartBarInputSchema.safeParse({
        data: {
          columns: [
            { key: "a", label: "A", type: "text" },
            { key: "b", label: "B", type: "number" },
          ],
          rows: [{ a: "x", b: "abc" }],
        },
      }).success,
    ).toBe(false);
    expect(
      chartBarInputSchema.safeParse({
        data: {
          columns: [
            { key: "a", label: "A", type: "text" },
            { key: "b", label: "B", type: "number" },
          ],
          rows: [{ a: "x", b: "12" }],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate column keys, unknown row keys, and text formatting on text columns", () => {
    const base = {
      data: {
        columns: [
          { key: "name", label: "プラン", type: "text" },
          { key: "price", label: "月額", type: "number" },
        ],
        rows: [{ name: "Free", price: 0 }],
      },
    };
    expect(tableSimpleInputSchema.safeParse(base).success).toBe(true);
    expect(
      tableSimpleInputSchema.safeParse({
        data: {
          ...base.data,
          columns: [
            { key: "name", label: "A", type: "text" },
            { key: "name", label: "B", type: "text" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      tableSimpleInputSchema.safeParse({
        data: { ...base.data, rows: [{ name: "Free", unknown: 1 }] },
      }).success,
    ).toBe(false);
    expect(
      tableSimpleInputSchema.safeParse({
        data: {
          ...base.data,
          columns: [{ key: "name", label: "A", type: "text", format: "currency" }],
        },
      }).success,
    ).toBe(false);
    expect(
      tableSimpleInputSchema.safeParse({
        data: { ...base.data, emphasis: [{ row: 0, tone: "primary" }] },
      }).success,
    ).toBe(false);
  });

  it("accepts line-triggered effects on table.simple", () => {
    const parsed = tableSimpleInputSchema.safeParse({
      data: {
        columns: [{ key: "name", label: "項目", type: "text" }],
        rows: [{ name: "a" }, { name: "b" }],
      },
      effects: [
        {
          target: { kind: "rows" },
          trigger: { kind: "cue" },
          effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 150 },
        },
        {
          target: { kind: "row", index: 1 },
          trigger: { kind: "lines", startLineId: "l1", endLineId: "l2" },
          effect: { kind: "emphasize", style: "frame", tone: "primary" },
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects table.simple effects with out-of-range targets", () => {
    const data = {
      columns: [{ key: "a", label: "A", type: "text" }],
      rows: [{ a: "x" }],
    };
    expect(
      tableSimpleInputSchema.safeParse({
        data,
        effects: [
          {
            target: { kind: "row", index: 5 },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 100 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      tableSimpleInputSchema.safeParse({
        data,
        effects: [
          {
            target: { kind: "cell", row: 0, key: "missing" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 100 },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts chart.bar appear and emphasize effects and rejects out-of-range targets", () => {    const data = {
      columns: [
        { key: "m", label: "月", type: "text" },
        { key: "s", label: "売上", type: "number" },
      ],
      rows: [{ m: "1月", s: 1 }],
    };
    expect(
      chartBarInputSchema.safeParse({
        data,
        effects: [
          {
            target: { kind: "bars" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 100, staggerMs: 100 },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      chartBarInputSchema.safeParse({
        data,
        effects: [
          {
            target: { kind: "series", index: 3 },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 100 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      chartBarInputSchema.safeParse({
        data,
        effects: [
          {
            target: { kind: "bars" },
            trigger: { kind: "cue" },
            effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("registers list.callout@1 as an editable card/overlay template", () => {
    const definition = getVisualTemplate("list.callout", 1);
    expect(definition?.layers).toEqual(["card", "overlay"]);
    expect(isEditableTemplate("list.callout", 1)).toBe(true);
    const fields = getTemplateInputFields("list.callout", 1);
    expect(fields?.some((field) => field.kind === "calloutItems")).toBe(true);
  });

  it("accepts a list.callout input and rejects mismatched trigger/effect", () => {
    expect(
      listCalloutInputSchema.safeParse({
        width: "medium",
        align: "center",
        items: [
          {
            text: "a",
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 100 },
          },
          { text: "b" },
        ],
      }).success,
    ).toBe(true);
    expect(
      listCalloutInputSchema.safeParse({ items: [{ text: "a", trigger: { kind: "cue" } }] }).success,
    ).toBe(false);
    expect(listCalloutInputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(
      listCalloutInputSchema.safeParse({ width: "huge", items: [{ text: "a" }] }).success,
    ).toBe(false);
    expect(
      listCalloutInputSchema.safeParse({ align: "justify", items: [{ text: "a" }] }).success,
    ).toBe(false);
  });

  it("exposes list.callout width and align as select fields", () => {
    const fields = getTemplateInputFields("list.callout", 1);
    const width = fields?.find((field) => field.key === "width");
    const align = fields?.find((field) => field.key === "align");
    expect(width).toMatchObject({
      kind: "select",
      label: "幅",
      options: [
        { value: "long", label: "長い" },
        { value: "medium", label: "中くらい" },
        { value: "short", label: "短い" },
      ],
    });
    expect(align).toMatchObject({
      kind: "select",
      label: "揃え",
      options: [
        { value: "left", label: "左揃え" },
        { value: "center", label: "中央揃え" },
        { value: "right", label: "右揃え" },
      ],
    });
  });
});

describe("flow.diagram@1", () => {
  const base = {
    diagram: {
      nodes: [{ label: "開始" }, { label: "審査", caption: "窓口" }, { label: "完了" }],
      edges: [
        { from: 0, to: 1, label: "書類" },
        { from: 1, to: 2 },
      ],
    },
  };

  it("registers flow.diagram@1 as an editable card/overlay template with a flow field", () => {
    const definition = getVisualTemplate("flow.diagram", 1);
    expect(definition?.layers).toEqual(["card", "overlay"]);
    expect(isEditableTemplate("flow.diagram", 1)).toBe(true);
    const fields = getTemplateInputFields("flow.diagram", 1);
    expect(fields?.some((field) => field.kind === "flow")).toBe(true);
    expect(fields?.some((field) => field.kind === "effects")).toBe(true);
  });

  it("accepts nodes, edges, style, and line-triggered effects", () => {
    const parsed = flowDiagramInputSchema.safeParse({
      ...base,
      title: "処理の流れ",
      style: { orientation: "vertical", preset: "boxed" },
      effects: [
        {
          target: { kind: "node", index: 1 },
          trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
          effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects out-of-range, self-looping, and empty diagrams", () => {
    expect(
      flowDiagramInputSchema.safeParse({
        diagram: { nodes: [{ label: "a" }], edges: [{ from: 0, to: 3 }] },
      }).success,
    ).toBe(false);
    expect(
      flowDiagramInputSchema.safeParse({
        diagram: { nodes: [{ label: "a" }, { label: "b" }], edges: [{ from: 1, to: 1 }] },
      }).success,
    ).toBe(false);
    expect(flowDiagramInputSchema.safeParse({ diagram: { nodes: [], edges: [] } }).success).toBe(
      false,
    );
  });

  it("rejects an effect targeting a node past the diagram", () => {
    expect(
      flowDiagramInputSchema.safeParse({
        ...base,
        effects: [
          {
            target: { kind: "node", index: 5 },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 400 },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("count-up value effects", () => {
  const tableData = {
    columns: [
      { key: "name", label: "項目", type: "text" },
      { key: "count", label: "件数", type: "number" },
    ],
    rows: [{ name: "a", count: 120 }],
  };

  it("accepts a value effect on a numeric table cell", () => {
    expect(
      tableSimpleInputSchema.safeParse({
        data: tableData,
        effects: [
          {
            target: { kind: "cell", row: 0, key: "count" },
            trigger: { kind: "cue" },
            effect: { kind: "value", durationMs: 1000 },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects a value effect on a non-cell or non-numeric target", () => {
    expect(
      tableSimpleInputSchema.safeParse({
        data: tableData,
        effects: [
          {
            target: { kind: "rows" },
            trigger: { kind: "cue" },
            effect: { kind: "value" },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      tableSimpleInputSchema.safeParse({
        data: tableData,
        effects: [
          {
            target: { kind: "cell", row: 0, key: "name" },
            trigger: { kind: "cue" },
            effect: { kind: "value" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts a value effect on chart.bar", () => {
    expect(
      chartBarInputSchema.safeParse({
        data: {
          columns: [
            { key: "m", label: "月", type: "text" },
            { key: "s", label: "売上", type: "number" },
          ],
          rows: [{ m: "1月", s: 100 }],
        },
        effects: [
          {
            target: { kind: "bars" },
            trigger: { kind: "cue" },
            effect: { kind: "value", durationMs: 800 },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects a chart.bar value effect when value labels are disabled", () => {
    expect(
      chartBarInputSchema.safeParse({
        data: {
          columns: [
            { key: "m", label: "月", type: "text" },
            { key: "s", label: "売上", type: "number" },
          ],
          rows: [{ m: "1月", s: 100 }],
        },
        style: { preset: "clean", orientation: "vertical", valueLabels: false },
        effects: [
          {
            target: { kind: "bars" },
            trigger: { kind: "cue" },
            effect: { kind: "value" },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("stat@1", () => {
  it("registers stat@1 as an editable card/overlay template with a decimal field", () => {
    const definition = getVisualTemplate("stat", 1);
    expect(definition?.layers).toEqual(["card", "overlay"]);
    expect(isEditableTemplate("stat", 1)).toBe(true);
    const fields = getTemplateInputFields("stat", 1);
    expect(fields?.some((field) => field.kind === "decimal")).toBe(true);
    expect(fields?.some((field) => field.kind === "effects")).toBe(true);
  });

  it("accepts a value, label, format, and a count-up effect", () => {
    expect(
      statInputSchema.safeParse({
        value: 1200,
        label: "導入社数",
        format: "integer",
        effects: [{ trigger: { kind: "cue" }, effect: { kind: "value", durationMs: 1000 } }],
      }).success,
    ).toBe(true);
    expect(statInputSchema.safeParse({ value: 1, format: "percent" }).success).toBe(true);
  });

  it("rejects an unknown format", () => {
    expect(statInputSchema.safeParse({ value: 1, format: "ratio" }).success).toBe(false);
  });
});

describe("quote@1", () => {
  it("registers quote@1 as an editable card/overlay template with an effects field", () => {
    const definition = getVisualTemplate("quote", 1);
    expect(definition?.layers).toEqual(["card", "overlay"]);
    expect(isEditableTemplate("quote", 1)).toBe(true);
    const fields = getTemplateInputFields("quote", 1);
    expect(fields?.some((field) => field.key === "quote")).toBe(true);
    expect(fields?.some((field) => field.kind === "effects")).toBe(true);
  });

  it("accepts a quote with author, source, and a line-triggered emphasize", () => {
    expect(
      quoteInputSchema.safeParse({
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
      }).success,
    ).toBe(true);
  });

  it("rejects a quote without the required text", () => {
    expect(quoteInputSchema.safeParse({ author: "山田太郎" }).success).toBe(false);
  });
});

describe("chat.thread@1", () => {
  it("registers chat.thread@1 as an editable card/overlay template with a messages field", () => {
    const definition = getVisualTemplate("chat.thread", 1);
    expect(definition?.layers).toEqual(["card", "overlay"]);
    expect(isEditableTemplate("chat.thread", 1)).toBe(true);
    const fields = getTemplateInputFields("chat.thread", 1);
    expect(fields?.some((field) => field.kind === "boolean" && field.key === "keyboard")).toBe(
      true,
    );
    const messages = fields?.find((field) => field.kind === "messages");
    expect(messages?.kind).toBe("messages");
    if (messages?.kind === "messages") {
      expect(messages.key).toBe("messages");
      expect(messages.maxMessages).toBe(6);
    }
  });

  it("defaults the frame to phone and accepts a conversation", () => {
    const parsed = chatThreadInputSchema.safeParse({
      title: "相談",
      messages: [
        { name: "リン", body: "どう思う？", side: "left", time: "12:30" },
        { body: "いいね", side: "right" },
      ],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.frame).toBe("phone");
      expect(parsed.data.statusBar).toBe(true);
      expect(parsed.data.keyboard).toBe(true);
    }
    for (const frame of ["phone", "laptop", "desktop", "none"]) {
      expect(chatThreadInputSchema.safeParse({ frame, messages: [{ body: "a" }] }).success).toBe(
        true,
      );
    }
    expect(
      chatThreadInputSchema.safeParse({ frame: "tablet", messages: [{ body: "a" }] }).success,
    ).toBe(false);
  });

  it("rejects an empty or over-long conversation", () => {
    expect(chatThreadInputSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(
      chatThreadInputSchema.safeParse({
        messages: Array.from({ length: 7 }, () => ({ body: "a" })),
      }).success,
    ).toBe(false);
  });

  it("accepts message-targeted effects and rejects an out-of-range message index", () => {
    const messages = [{ body: "a" }, { body: "b" }];
    expect(
      chatThreadInputSchema.safeParse({
        messages,
        effects: [
          {
            target: { kind: "message", index: 1 },
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
            effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      chatThreadInputSchema.safeParse({
        messages,
        effects: [
          {
            target: { kind: "message", index: 2 },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 400 },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("collects line references from message effects", () => {
    const refs = chatThreadV1.collectLineRefs?.(
      {
        messages: [{ body: "a" }],
        effects: [
          {
            target: { kind: "messages" },
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l2" },
            effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 100 },
          },
        ],
      },
      ["input"],
    );
    expect(refs?.map((ref) => ref.lineId)).toEqual(["l1", "l2"]);
    expect(refs?.[0]?.path).toEqual(["input", "effects", 0, "trigger", "startLineId"]);
  });

  it("collects icon asset references from every message", () => {
    const refs = chatThreadV1.collectAssetRefs(
      {
        messages: [
          { body: "a", icon: { kind: "media", assetId: "asset-1" } },
          { body: "b" },
          { body: "c", icon: { kind: "media", assetId: "asset-2" } },
        ],
      },
      ["input"],
    );
    expect(refs.map((ref) => ref.assetId)).toEqual(["asset-1", "asset-2"]);
  });
});
