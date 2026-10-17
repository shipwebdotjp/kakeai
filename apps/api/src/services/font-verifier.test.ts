import { describe, expect, it } from "vitest";
import { ChromiumFontVerifier } from "./font-verifier.ts";

describe("ChromiumFontVerifier", () => {
  it("resolves a local @font-face in Chromium and rejects an unknown face", async () => {
    if (process.platform !== "darwin") {
      return;
    }
    const verifier = new ChromiumFontVerifier();
    const result = await verifier.verifyLocalFaces(["HiraginoSans-W3", "KakeaiNoSuchFace-ZZZ"]);
    if (!result.supported) {
      // Chromium unavailable in this environment: verification degrades to unsupported.
      return;
    }
    expect(result.verified.has("HiraginoSans-W3")).toBe(true);
    expect(result.verified.has("KakeaiNoSuchFace-ZZZ")).toBe(false);
  }, 180000);
});
