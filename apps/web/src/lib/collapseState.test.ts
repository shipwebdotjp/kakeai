import { describe, expect, it, vi } from "vitest";
import {
  foldStorageKey,
  isPersistedFoldKey,
  loadFoldEntries,
  parseFoldEntries,
  saveFoldEntries,
  sceneFoldKey,
  sectionFoldKey,
  serializeFoldEntries,
} from "./collapseState";

describe("fold keys", () => {
  it("builds namespaced keys", () => {
    expect(sceneFoldKey("abc")).toBe("scene-open:abc");
    expect(sectionFoldKey("abc", "visual")).toBe("section:visual:abc");
    expect(foldStorageKey("work/edition")).toBe("kakeai.editor.fold.v1:work/edition");
  });

  it("only persists scene and section keys", () => {
    expect(isPersistedFoldKey("scene-open:abc")).toBe(true);
    expect(isPersistedFoldKey("section:visual:abc")).toBe(true);
    expect(isPersistedFoldKey("theme")).toBe(false);
    expect(isPersistedFoldKey("scene-settings-abc")).toBe(false);
  });
});

describe("parseFoldEntries", () => {
  it("returns empty for blank input", () => {
    expect(parseFoldEntries(null).size).toBe(0);
    expect(parseFoldEntries("  ").size).toBe(0);
  });

  it("returns empty for broken JSON or non-objects", () => {
    expect(parseFoldEntries("{broken").size).toBe(0);
    expect(parseFoldEntries("[1,2]").size).toBe(0);
    expect(parseFoldEntries('"str"').size).toBe(0);
  });

  it("keeps only persisted keys with boolean values", () => {
    const parsed = parseFoldEntries(
      JSON.stringify({
        "scene-open:a": true,
        "section:lines:b": false,
        theme: true,
        "scene-open:c": "yes",
      }),
    );
    expect(Object.fromEntries(parsed)).toEqual({
      "scene-open:a": true,
      "section:lines:b": false,
    });
  });
});

describe("serializeFoldEntries", () => {
  it("round-trips persisted keys only", () => {
    const entries = new Map([
      ["scene-open:a", true],
      ["section:audio:b", false],
      ["theme", true],
    ]);
    const parsed = parseFoldEntries(serializeFoldEntries(entries));
    expect(Object.fromEntries(parsed)).toEqual({
      "scene-open:a": true,
      "section:audio:b": false,
    });
  });
});

describe("storage helpers", () => {
  it("loads empty when storage is missing or throws", () => {
    expect(loadFoldEntries(null, "k").size).toBe(0);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    };
    expect(loadFoldEntries(throwing, "k").size).toBe(0);
  });

  it("ignores save failures", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => saveFoldEntries(throwing, "k", new Map())).not.toThrow();
    expect(() => saveFoldEntries(null, "k", new Map())).not.toThrow();
  });

  it("writes and reads back through storage", () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        backing.set(key, value);
      },
    };
    saveFoldEntries(
      storage,
      "k",
      new Map([
        [sceneFoldKey("a"), true],
        [sectionFoldKey("a", "visual"), false],
      ]),
    );
    const loaded = loadFoldEntries(storage, "k");
    expect(loaded.get(sceneFoldKey("a"))).toBe(true);
    expect(loaded.get(sectionFoldKey("a", "visual"))).toBe(false);
  });

  it("does not call setItem with a throwing getItem mock interfering", () => {
    const setItem = vi.fn();
    const storage = { getItem: () => null, setItem };
    saveFoldEntries(storage, "k", new Map([[sceneFoldKey("a"), true]]));
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});
