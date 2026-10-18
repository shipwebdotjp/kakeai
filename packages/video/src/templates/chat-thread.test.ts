import { describe, expect, it } from "vitest";
import { getVisualTheme, type NestedVisual } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import type { RenderContext } from "../render-context";
import { neutralVisualSkin } from "../skins/neutral";
import { cueScope, type RenderScope } from "../scope";
import type { AssetResolver } from "../resolver";
import { CompositionCompileError } from "../compile-error";
import { renderChatThread } from "./chat-thread";

const theme = getVisualTheme("soft-editorial", 1)!;

const assetResolver: AssetResolver = (assetId) => ({ url: `/preview/${assetId}`, kind: "image" });

function context(
  scopeId = "chat-1",
  nestedScopes: RenderScope[] = [],
  nestedNodes: NestedVisual[] = [],
): RenderContext {
  return {
    document: validContentDocument(),
    theme,
    skin: neutralVisualSkin,
    assetResolver,
    scope: cueScope(scopeId),
    path: ["scenes", 1, "visualCues", 0, "input"],
    cueTiming: { startMs: 0, spanMs: 9000 },
    lineIntervals: [
      { lineId: "l1", startMs: 500, endMs: 1500 },
      { lineId: "l2", startMs: 1500, endMs: 2500 },
    ],
    renderNested: (node: NestedVisual, scope: RenderScope) => {
      nestedScopes.push(scope);
      nestedNodes.push(node);
      const assetId = node.kind === "media" ? node.assetId : "";
      return {
        html: `<img class="kakeai-nestedmedia" src="/preview/${assetId}" alt="">`,
        assetIds: [assetId],
        animation: [],
      };
    },
  };
}

const baseInput = {
  title: "相談のやりとり",
  messages: [
    { name: "リン", body: "これどう思う？", side: "left", time: "12:30" },
    { body: "いいと思う", side: "right" },
    { body: "ありがとう" },
  ],
};

describe("renderChatThread", () => {
  it("renders the title and every message body", () => {
    const rendered = renderChatThread(baseInput, context());
    expect(rendered.assetIds).toEqual([]);
    expect(rendered.html).toContain("相談のやりとり");
    expect(rendered.html).toContain("これどう思う？");
    expect(rendered.html).toContain("いいと思う");
    expect(rendered.html).toContain("ありがとう");
    expect(rendered.html).toContain("kakeai-chatrow-right");
    expect(rendered.html).toContain("12:30");
  });

  it("shows the phone status bar by default and hides it for other frames", () => {
    const phone = renderChatThread({ ...baseInput, frame: "phone" }, context());
    expect(phone.html).toContain("kakeai-chatstatus");
    expect(phone.html).toContain("kakeai-statusbar-island");
    expect(phone.html).toContain("9:41");

    const laptop = renderChatThread({ ...baseInput, frame: "laptop" }, context());
    expect(laptop.html).toContain("kakeai-chatpanel-laptop");
    expect(laptop.html).not.toContain("kakeai-chatstatus");

    const desktop = renderChatThread({ ...baseInput, frame: "desktop" }, context());
    expect(desktop.html).toContain("kakeai-chatpanel-desktop");
    expect(desktop.html).not.toContain("kakeai-chatstatus");

    const none = renderChatThread({ ...baseInput, frame: "none" }, context());
    expect(none.html).toContain("kakeai-chatpanel-none");
    expect(none.html).not.toContain("kakeai-chatstatus");
  });

  it("shows a keyboard base on the laptop frame by default and hides it when disabled", () => {
    const defaultLaptop = renderChatThread({ ...baseInput, frame: "laptop" }, context());
    expect(defaultLaptop.html).toContain("kakeai-chatwrap-keyboard");
    expect(defaultLaptop.html).toContain("kakeai-laptopbase");

    const off = renderChatThread({ ...baseInput, frame: "laptop", keyboard: false }, context());
    expect(off.html).not.toContain("kakeai-laptopbase");

    const phoneKeyboard = renderChatThread(
      { ...baseInput, frame: "phone", keyboard: true },
      context(),
    );
    expect(phoneKeyboard.html).not.toContain("kakeai-laptopbase");
  });

  it("honors statusBar off and a custom status time", () => {
    const off = renderChatThread({ ...baseInput, frame: "phone", statusBar: false }, context());
    expect(off.html).not.toContain("kakeai-chatstatus");

    const custom = renderChatThread(
      { ...baseInput, frame: "phone", statusTime: "21:07" },
      context(),
    );
    expect(custom.html).toContain("21:07");
    expect(custom.html).not.toContain("9:41");
  });

  it("collects icon assets, forces cover, and gives each icon its own scope", () => {
    const scopes: RenderScope[] = [];
    const nodes: NestedVisual[] = [];
    const rendered = renderChatThread(
      {
        frame: "phone",
        messages: [
          { body: "a", icon: { kind: "media", assetId: "asset-1", fit: "contain" } },
          { body: "b", icon: { kind: "media", assetId: "asset-2" } },
        ],
      },
      context("chat-1", scopes, nodes),
    );
    expect(rendered.assetIds).toEqual(["asset-1", "asset-2"]);
    expect(rendered.html).toContain("kakeai-chaticon");
    expect(scopes).toHaveLength(2);
    expect(scopes[0]!.id("media")).not.toBe(scopes[1]!.id("media"));
    expect(nodes.map((node) => (node.kind === "media" ? node.fit : undefined))).toEqual([
      "cover",
      "cover",
    ]);
  });

  it("escapes message text", () => {
    const rendered = renderChatThread(
      { messages: [{ body: "<b>危険</b>" }] },
      context(),
    );
    expect(rendered.html).toContain("&lt;b&gt;危険&lt;/b&gt;");
    expect(rendered.html).not.toContain("<b>危険</b>");
  });

  it("rejects an empty conversation", () => {
    expect(() => renderChatThread({ messages: [] }, context())).toThrow(CompositionCompileError);
  });

  it("hides a message before its line trigger and reveals it at the window", () => {
    const rendered = renderChatThread(
      {
        messages: [{ body: "a" }, { body: "b" }],
        effects: [
          {
            target: { kind: "message", index: 1 },
            trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
            effect: { kind: "appear", preset: "fade", durationMs: 400 },
          },
        ],
      },
      context("chat-1"),
    );
    const row1 = cueScope("chat-1").id("msg-1");
    const hidden = rendered.stateIntervals?.find(
      (state) => state.targetId === row1 && state.on.opacity === 0,
    );
    expect(hidden?.intervals).toEqual([{ startMs: 0, endMs: 1500 }]);
    expect(
      rendered.animation?.some((item) => item.targetId === row1 && item.action === "fade"),
    ).toBe(true);
  });

  it("staggers an appear across all messages", () => {
    const rendered = renderChatThread(
      {
        messages: [{ body: "a" }, { body: "b" }],
        effects: [
          {
            target: { kind: "messages" },
            trigger: { kind: "cue" },
            effect: { kind: "appear", preset: "fade", durationMs: 400, staggerMs: 200 },
          },
        ],
      },
      context("chat-1"),
    );
    const starts = rendered.animation
      ?.filter((item) => item.action === "fade")
      .map((item) => item.startMs);
    expect(starts).toEqual([0, 200]);
  });

  it("emphasizes the targeted bubble and dims the others with spotlight", () => {
    const rendered = renderChatThread(
      {
        messages: [{ body: "a" }, { body: "b" }, { body: "c" }],
        effects: [
          {
            target: { kind: "message", index: 1 },
            trigger: { kind: "lines", startLineId: "l2", endLineId: "l2" },
            effect: { kind: "emphasize", style: "spotlight", tone: "primary" },
          },
        ],
      },
      context("chat-1"),
    );
    const scope = cueScope("chat-1");
    const emphasized = rendered.stateIntervals?.find(
      (state) => state.targetId === scope.id("bubble-1") && typeof state.on.boxShadow === "string",
    );
    expect(emphasized?.intervals).toEqual([{ startMs: 1500, endMs: 2500 }]);
    expect(
      rendered.stateIntervals?.find((state) => state.targetId === scope.id("msg-0"))?.on,
    ).toEqual({ filter: "brightness(0.4)" });
    expect(
      rendered.stateIntervals?.some((state) => state.targetId === scope.id("msg-1")),
    ).toBe(false);
  });

  it("renders an onset overlay inside the emphasized bubble", () => {
    const rendered = renderChatThread(
      {
        messages: [{ body: "a" }],
        effects: [
          {
            target: { kind: "message", index: 0 },
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
            effect: {
              kind: "emphasize",
              style: "frame",
              tone: "primary",
              onset: { preset: "flash", durationMs: 300 },
            },
          },
        ],
      },
      context("chat-1"),
    );
    const bubble0 = cueScope("chat-1").id("bubble-0");
    expect(rendered.html).toContain(`id="${bubble0}-onset"`);
    expect(rendered.html).toContain("kakeai-onset-flash");
    expect(rendered.animation?.some((item) => item.targetId === `${bubble0}-onset`)).toBe(true);
  });

  it("restores the bubble background after a background emphasize", () => {
    const rendered = renderChatThread(
      {
        messages: [{ body: "a", side: "right" }],
        effects: [
          {
            target: { kind: "message", index: 0 },
            trigger: { kind: "lines", startLineId: "l1", endLineId: "l1" },
            effect: { kind: "emphasize", style: "background", tone: "primary" },
          },
        ],
      },
      context("chat-1"),
    );
    const state = rendered.stateIntervals?.find(
      (entry) => entry.targetId === cueScope("chat-1").id("bubble-0"),
    );
    expect(state?.off?.backgroundColor).toBe(theme.accents.primary);
  });
});
