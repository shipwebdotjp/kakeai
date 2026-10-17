import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { RenderContext } from "../render-context";
import { neutralVisualSkin } from "../skins/neutral";
import { cueScope } from "../scope";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { renderQuote } from "./quote";

const theme = getVisualTheme("soft-editorial", 1)!;

const assetResolver: AssetResolver = (assetId) => ({ url: `/preview/${assetId}`, kind: "image" });

function context(): RenderContext {
  return {
    document: validContentDocument(),
    theme,
    skin: neutralVisualSkin,
    assetResolver,
    scope: cueScope("visual-quote-1"),
    path: ["scenes", 1, "visualCues", 2, "input"],
    renderNested: () => {
      throw new Error("nested visuals are not used by quote");
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
  quote: "テンプレートは再利用の契約である",
  author: "山田太郎",
  source: "設計資料 第3版",
  style: { tone: "primary" as const, preset: "card" as const },
};

describe("renderQuote", () => {
  it("renders the quote, author, and source", () => {
    const rendered = renderQuote(baseInput, context());
    expect(rendered.assetIds).toEqual([]);
    expect(rendered.html).toContain("テンプレートは再利用の契約である");
    expect(rendered.html).toContain("山田太郎");
    expect(rendered.html).toContain("設計資料 第3版");
  });

  it("rejects a quote without the required text", () => {
    expect(() => renderQuote({ author: "山田太郎" }, context())).toThrow(CompositionCompileError);
  });

  it("renders deterministically and keeps two cues from colliding", () => {
    const first = renderQuote(baseInput, context());
    const second = renderQuote(baseInput, context());
    expect(first.html).toBe(second.html);
    const other = renderQuote(baseInput, { ...context(), scope: cueScope("vc-other") });
    expect(first.html).not.toBe(other.html);
  });

  it("emphasizes the quote and appears the card", () => {
    const scope = cueScope("visual-quote-1");
    const rendered = renderQuote(
      {
        ...baseInput,
        effects: [
          {
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
          { trigger: { kind: "cue" }, effect: { kind: "appear", preset: "fade", durationMs: 400 } },
        ],
      },
      timedContext(),
    );
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("quote"),
      intervals: [{ startMs: 500, endMs: 1500 }],
      on: { boxShadow: expect.stringContaining("inset") },
      off: { boxShadow: "none" },
    });
    expect(rendered.animation).toContainEqual({
      targetId: scope.id("card"),
      action: "fade",
      startMs: 0,
      durationMs: 400,
    });
  });

  it("rings the spotlighted quote and dims the author and source", () => {
    const scope = cueScope("visual-quote-1");
    const rendered = renderQuote(
      {
        ...baseInput,
        effects: [
          {
            trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
            effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
          },
        ],
      },
      timedContext(),
    );
    expect(rendered.stateIntervals).toContainEqual({
      targetId: scope.id("quote"),
      intervals: [{ startMs: 1500, endMs: 2500 }],
      on: { boxShadow: expect.stringContaining("inset") },
      off: { boxShadow: "none" },
    });
    for (const siblingId of [scope.id("author"), scope.id("source")]) {
      expect(rendered.stateIntervals).toContainEqual({
        targetId: siblingId,
        intervals: [{ startMs: 1500, endMs: 2500 }],
        on: { filter: "brightness(0.4)" },
        off: { filter: "none" },
      });
    }
  });

  it("sweeps an onset overlay on the quote", () => {
    const scope = cueScope("visual-quote-1");
    const rendered = renderQuote(
      {
        ...baseInput,
        effects: [
          {
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
    const overlayId = `${scope.id("quote")}-onset`;
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
