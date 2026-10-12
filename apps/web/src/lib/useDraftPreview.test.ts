import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInitialContentDocument,
  type DraftPreview,
  type ScriptVersionPreview,
} from "@kakeai/contracts";
import {
  draftDocumentKey,
  isDraftUnreflected,
  requestDraftPreview,
  selectActivePreview,
} from "./useDraftPreview";

function savedPreview(): ScriptVersionPreview {
  return {
    scriptVersionId: "scr_001",
    compositionHtml: "<!doctype html><html></html>",
    assets: [],
    compositions: [],
    renderer: { engine: "hyperframes", compilerVersion: "app-1", playerVersion: "0.8.141" },
    timeline: { totalDurationMs: 9000, fps: 30, scenes: [] },
  };
}

function draftPreview(): DraftPreview {
  return {
    source: { kind: "draft" },
    compositionHtml: "<!doctype html><html>draft</html>",
    assets: [],
    compositions: [],
    renderer: { engine: "hyperframes", compilerVersion: "app-1", playerVersion: "0.8.141" },
    timeline: { totalDurationMs: 9000, fps: 30, scenes: [] },
  };
}

describe("requestDraftPreview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const envelope = {
    data: {
      source: { kind: "draft" },
      compositionHtml: "<!doctype html><html></html>",
      assets: [],
      compositions: [],
      renderer: { engine: "hyperframes", compilerVersion: "app-1", playerVersion: "0.8.141" },
      timeline: { totalDurationMs: 9000, fps: 30, scenes: [] },
    },
  };

  it("posts the document wrapped as content", async () => {
    const seen: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body?: string }) => {
        seen.push({ url, body: init.body === undefined ? undefined : JSON.parse(init.body) });
        return new Response(JSON.stringify(envelope), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const document = createInitialContentDocument();
    const preview = await requestDraftPreview("led_1", document);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/v1/language-editions/led_1/draft-preview");
    expect(seen[0]!.body).toEqual({ content: document });
    expect(preview.source).toEqual({ kind: "draft" });
  });

  it("rejects a malformed preview response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ data: { source: { kind: "draft" } } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(
      requestDraftPreview("led_1", createInitialContentDocument()),
    ).rejects.toThrow();
  });
});

describe("selectActivePreview", () => {
  it("prefers the latest valid draft over the saved preview", () => {
    const active = selectActivePreview(savedPreview(), draftPreview(), 3);
    expect(active?.source).toBe("draft");
    expect(active?.identity).toBe("draft:3");
    expect(active?.compositionHtml).toContain("draft");
  });

  it("falls back to the saved preview without a draft", () => {
    const active = selectActivePreview(savedPreview(), null, 0);
    expect(active?.source).toBe("saved");
    expect(active?.identity).toBe("scr_001");
  });

  it("returns undefined while nothing is available", () => {
    expect(selectActivePreview(undefined, null, 0)).toBeUndefined();
  });
});

describe("isDraftUnreflected", () => {
  const document = createInitialContentDocument();
  const key = draftDocumentKey(document);

  it("is clean without unsaved edits", () => {
    expect(isDraftUnreflected(false, false, null, null)).toBe(false);
    expect(isDraftUnreflected(false, false, document, null)).toBe(false);
  });

  it("is unreflected while a request is pending", () => {
    expect(isDraftUnreflected(true, true, document, key)).toBe(true);
  });

  it("is unreflected for transiently invalid input", () => {
    expect(isDraftUnreflected(true, false, null, key)).toBe(true);
  });

  it("compares the latest document against the applied preview", () => {
    expect(isDraftUnreflected(true, false, document, key)).toBe(false);
    expect(isDraftUnreflected(true, false, document, null)).toBe(true);
    expect(isDraftUnreflected(true, false, { ...document, scenes: [] }, key)).toBe(true);
  });
});
