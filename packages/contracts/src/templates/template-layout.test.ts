import { describe, expect, it } from "vitest";
import {
  FIGURE_WIDTH_OPTIONS,
  FLOW_LABEL_BASE_FONT_PX,
  FLOW_LABEL_MIN_FONT_PX,
  chartBarInputSchema,
  deviceFrameInputSchema,
  fitFlowNodeLabel,
  flowNodeWidth,
  getTemplateInputFields,
  tableSimpleInputSchema,
} from "./index";

describe("flow label fit", () => {
  it("keeps short labels at the base size and shrinks wider ones", () => {
    expect(fitFlowNodeLabel("受付", 360)).toEqual({
      fontSizePx: FLOW_LABEL_BASE_FONT_PX,
      reduced: false,
      overflow: false,
    });
    const reduced = fitFlowNodeLabel("データ", 120);
    expect(reduced.reduced).toBe(true);
    expect(reduced.overflow).toBe(false);
    expect(reduced.fontSizePx).toBeLessThan(FLOW_LABEL_BASE_FONT_PX);
    expect(reduced.fontSizePx).toBeGreaterThanOrEqual(FLOW_LABEL_MIN_FONT_PX);
  });

  it("reports overflow at the minimum size instead of truncating", () => {
    const fit = fitFlowNodeLabel("とても長いノードラベル", 120);
    expect(fit.overflow).toBe(true);
    expect(fit.reduced).toBe(true);
    expect(fit.fontSizePx).toBe(FLOW_LABEL_MIN_FONT_PX);
  });

  it("applies the profile type scale to the measured font size", () => {
    const landscape = fitFlowNodeLabel("受付", 360, 1);
    const portrait = fitFlowNodeLabel("受付", 360, 0.75);
    expect(portrait.fontSizePx).toBe(landscape.fontSizePx * 0.75);
  });

  it("derives node width from orientation, count, and plot width", () => {
    expect(flowNodeWidth(8, "horizontal", 1320)).toBe(120);
    expect(flowNodeWidth(2, "horizontal", 1320)).toBe(360);
    expect(flowNodeWidth(8, "vertical", 1320)).toBe(600);
    expect(flowNodeWidth(8, "vertical", 480)).toBe(480);
  });
});

describe("figure width presets", () => {
  const table = {
    data: {
      columns: [{ key: "name", label: "項目", type: "text" }],
      rows: [{ name: "a" }],
    },
  };
  const chart = {
    data: {
      columns: [
        { key: "name", label: "項目", type: "text" },
        { key: "value", label: "値", type: "number" },
      ],
      rows: [{ name: "a", value: 1 }],
    },
  };

  it("accepts wide, medium, and narrow and rejects other widths", () => {
    for (const width of ["wide", "medium", "narrow"]) {
      expect(tableSimpleInputSchema.safeParse({ ...table, style: { width } }).success).toBe(
        true,
      );
      expect(chartBarInputSchema.safeParse({ ...chart, style: { width } }).success).toBe(
        true,
      );
    }
    expect(
      tableSimpleInputSchema.safeParse({ ...table, style: { width: "full" } }).success,
    ).toBe(false);
    expect(
      chartBarInputSchema.safeParse({ ...chart, style: { width: "full" } }).success,
    ).toBe(false);
  });

  it("keeps width optional", () => {
    expect(tableSimpleInputSchema.safeParse(table).success).toBe(true);
    expect(chartBarInputSchema.safeParse(chart).success).toBe(true);
  });

  it("exposes width as an omit-at-default select", () => {
    for (const id of ["table.simple", "chart.bar"]) {
      const field = getTemplateInputFields(id, 1)?.find(
        (entry) => entry.key === "style.width",
      );
      expect(field?.kind).toBe("select");
      if (field?.kind !== "select") {
        continue;
      }
      expect(field.defaultValue).toBe("wide");
      expect(field.options).toEqual(FIGURE_WIDTH_OPTIONS);
    }
  });
});

describe("scene.device-frame scale and placement", () => {
  const screen = { kind: "media", assetId: "asset-1" } as const;

  it("accepts the documented scale bounds and placement values", () => {
    expect(
      deviceFrameInputSchema.safeParse({ frame: "laptop", screen, scale: 0.6 }).success,
    ).toBe(true);
    expect(
      deviceFrameInputSchema.safeParse({ frame: "laptop", screen, scale: 1 }).success,
    ).toBe(true);
    for (const placement of ["left", "center", "right"]) {
      expect(
        deviceFrameInputSchema.safeParse({ frame: "laptop", screen, placement }).success,
      ).toBe(true);
    }
  });

  it("rejects out-of-range, non-finite, and unknown values", () => {
    for (const scale of [0.59, 1.01, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(
        deviceFrameInputSchema.safeParse({ frame: "laptop", screen, scale }).success,
      ).toBe(false);
    }
    expect(
      deviceFrameInputSchema.safeParse({ frame: "laptop", screen, placement: "top" })
        .success,
    ).toBe(false);
  });

  it("exposes a decimal scale and a placement select with defaults", () => {
    const fields = getTemplateInputFields("scene.device-frame", 1) ?? [];
    const scale = fields.find((field) => field.key === "scale");
    expect(scale?.kind).toBe("decimal");
    if (scale?.kind === "decimal") {
      expect(scale).toMatchObject({
        min: 0.6,
        max: 1,
        step: 0.05,
        optional: true,
        defaultValue: 1,
      });
    }
    const placement = fields.find((field) => field.key === "placement");
    expect(placement?.kind).toBe("select");
    if (placement?.kind === "select") {
      expect(placement.defaultValue).toBe("center");
      expect(placement.options.map((option) => option.value)).toEqual([
        "left",
        "center",
        "right",
      ]);
    }
  });
});
