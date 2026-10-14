import { describe, expect, it } from "vitest";
import {
  chartBarInputSchema,
  getTemplateInputFields,
  getVisualTemplate,
  isEditableTemplate,
  listVisualTemplateCatalog,
  mediaCardInputSchema,
  tableSimpleInputSchema,
} from "./index";

describe("visual template metadata", () => {
  it("registers scene.device-frame@2 with an animation field", () => {
    const fields = getTemplateInputFields("scene.device-frame", 2);
    expect(fields?.some((field) => field.kind === "animation")).toBe(true);
    expect(isEditableTemplate("scene.device-frame", 2)).toBe(true);
  });

  it("keeps scene.device-frame@1 free of an animation field", () => {
    const fields = getTemplateInputFields("scene.device-frame", 1);
    expect(fields?.some((field) => field.kind === "animation")).toBe(false);
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
      (entry) => entry.id === "scene.device-frame" && entry.version === 2,
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

  it("registers table.simple@1 as an editable overlay template with a table field", () => {
    const definition = getVisualTemplate("table.simple", 1);
    expect(definition?.layers).toEqual(["overlay"]);
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

  it("registers chart.bar@1 as an editable overlay template with a grid field", () => {
    const definition = getVisualTemplate("chart.bar", 1);
    expect(definition?.layers).toEqual(["overlay"]);
    expect(isEditableTemplate("chart.bar", 1)).toBe(true);
    const fields = getTemplateInputFields("chart.bar", 1);
    const grid = fields?.find((field) => field.kind === "grid");
    expect(grid?.kind).toBe("grid");
    if (grid?.kind === "grid") {
      expect(grid.key).toBe("data");
      expect(grid.emphasis).toBe(false);
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
      reveal: { mode: "bars", preset: "bounce", durationMs: 600, staggerMs: 120 },
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

  it("rejects duplicate column keys, unknown row keys, and out-of-range emphasis", () => {
    const base = {
      data: {
        columns: [
          { key: "name", label: "プラン", type: "text" },
          { key: "price", label: "月額", type: "number" },
        ],
        rows: [{ name: "Free", price: 0 }],
        emphasis: [{ row: 0, key: "price", tone: "primary" }],
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
        data: { ...base.data, emphasis: [{ row: 5, tone: "primary" }] },
      }).success,
    ).toBe(false);
    expect(
      tableSimpleInputSchema.safeParse({
        data: { ...base.data, emphasis: [{ row: 0, key: "missing", tone: "primary" }] },
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
  });
});
