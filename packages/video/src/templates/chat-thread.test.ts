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
    lineIntervals: [],
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
    expect(phone.html).toContain("kakeai-chatstatus-island");
    expect(phone.html).toContain("9:41");

    const laptop = renderChatThread({ ...baseInput, frame: "laptop" }, context());
    expect(laptop.html).not.toContain("kakeai-chatstatus");

    const none = renderChatThread({ ...baseInput, frame: "none" }, context());
    expect(none.html).not.toContain("kakeai-chatstatus");
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
});
