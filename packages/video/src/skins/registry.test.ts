import { describe, expect, it } from "vitest";
import {
  getVisualTheme,
  listVisualSkinDefinitions,
  visualTemplateDefinitions,
  visualThemeDefinitionSchema,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { compileDocument } from "../compiler";
import { CompositionCompileError } from "../compile-error";
import type { AssetResolver } from "../resolver";
import type { RenderContext } from "../render-context";
import { neutralVisualSkin } from "./neutral";
import { getResolvedVisualSkin, listResolvedVisualSkins, resolveVisualSkin } from "./registry";
import type { ResolvedVisualSkin } from "./types";

const resolver: AssetResolver = (assetId) => {
  if (assetId.includes("audio") || assetId.includes("bgm")) {
    return { url: `/preview/${assetId}`, kind: "audio", durationMs: 3000 };
  }
  return { url: `/preview/${assetId}`, kind: "image" };
};

describe("visualSkinRendererRegistry", () => {
  it("registers a resolved renderer for every published skin definition", () => {
    for (const definition of listVisualSkinDefinitions()) {
      const resolved = getResolvedVisualSkin(definition);
      expect(resolved, `${definition.id}@${definition.version}`).toBeDefined();
      expect(resolved?.ref).toEqual({ id: definition.id, version: definition.version });
    }
    expect(listResolvedVisualSkins().length).toBe(listVisualSkinDefinitions().length);
  });

  it("covers every visual template with the neutral renderers", () => {
    for (const template of visualTemplateDefinitions) {
      const key = `${template.id}@${template.version}`;
      expect(neutralVisualSkin.templateRenderers.has(key), key).toBe(true);
    }
  });

  it("rejects an unknown skin ref", () => {
    expect(() => resolveVisualSkin({ id: "no-such-skin", version: 1 })).toThrow(
      CompositionCompileError,
    );
    try {
      resolveVisualSkin({ id: "no-such-skin", version: 1 });
    } catch (error) {
      expect((error as CompositionCompileError).issues[0]?.code).toBe("unknown_skin");
    }
  });

  it("resolves the neutral skin from a v1 theme definition", () => {
    const theme = getVisualTheme("soft-editorial", 1)!;
    expect(resolveVisualSkin({ id: "neutral", version: 1 })).toBe(neutralVisualSkin);
    expect(theme.themeDefinitionSchemaVersion).toBe(1);
    const neutralV2: VisualThemeDefinition = visualThemeDefinitionSchema.parse({
      ...theme,
      themeDefinitionSchemaVersion: 2,
      skin: { id: "neutral", version: 1 },
    });
    const withSkin = compileDocument({
      document: validContentDocument(),
      resolvedTheme: neutralV2,
      assetResolver: resolver,
    });
    const withoutSkin = compileDocument({
      document: validContentDocument(),
      resolvedTheme: theme,
      assetResolver: resolver,
    });
    expect(withSkin.html).toBe(withoutSkin.html);
  });

  it("falls back to the neutral renderer for templates a skin does not register", () => {
    let capturedContext: RenderContext | undefined;
    const fakeSkin: ResolvedVisualSkin = {
      ref: { id: "test-skin", version: 1 },
      templateRenderers: new Map([
        [
          "text.block@1",
          (input, context) => {
            capturedContext = context;
            return { html: '<div data-skin="test-skin"></div>', assetIds: [], animation: [] };
          },
        ],
      ]),
      sceneBackground: neutralVisualSkin.sceneBackground,
    };

    const compiled = compileDocument({
      document: validContentDocument(),
      resolvedTheme: getVisualTheme("soft-editorial", 1),
      resolvedSkin: fakeSkin,
      assetResolver: resolver,
    });

    expect(compiled.html).toContain('data-skin="test-skin"');
    expect(compiled.html).toContain('src="/preview/asset-bg"');
    expect(capturedContext?.skin).toBe(fakeSkin);
  });
});
