import { describe, expect, it } from "vitest";
import { createDefaultLiveFormatDocument } from "./format";
import { canAdoptExternalFormatDocument } from "./format-sync";

function defaultFormat() {
  return createDefaultLiveFormatDocument({
    name: "ニュース 30分",
    theme: { id: "theme-news", version: 1 },
    cast: {
      left: { characterId: "char-left", voiceProfileId: "voice-left" },
      right: null,
    },
  });
}

describe("format document sync", () => {
  it("adopts an external document when the draft has no local edits", () => {
    const baseline = defaultFormat();
    expect(canAdoptExternalFormatDocument(baseline, baseline)).toBe(true);
  });

  it("keeps a draft object that is not the baseline reference", () => {
    const baseline = defaultFormat();
    const draft = structuredClone(baseline);
    expect(canAdoptExternalFormatDocument(draft, baseline)).toBe(false);
  });

  it("keeps a draft with actual local edits", () => {
    const baseline = defaultFormat();
    const draft = { ...baseline, name: "変更後の名前" };
    expect(canAdoptExternalFormatDocument(draft, baseline)).toBe(false);
  });
});
