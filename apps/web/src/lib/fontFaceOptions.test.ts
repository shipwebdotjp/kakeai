import { describe, expect, it } from "vitest";
import type { FontFace } from "@kakeai/contracts";
import { includeFontFace, matchesFontFaceQuery, selectableFontFaces } from "./fontFaceOptions";

function face(
  postScriptName: string,
  family: string,
  displayName: string = postScriptName,
): FontFace {
  return {
    platformId: postScriptName,
    family,
    displayName,
    postScriptName,
    weight: 400,
    style: "normal",
    stretch: "normal",
    available: true,
  };
}

const faces: FontFace[] = [
  face("YuMin_36pKn-Extrabold", "游明朝体+36ポかな"),
  face("YuMin-Medium", "游明朝体"),
  face("YuMin-Demibold", "游明朝体"),
  face("YuGo-Bold", "游ゴシック"),
];

describe("matchesFontFaceQuery", () => {
  it("matches family, face name and PostScript name, case-insensitively", () => {
    expect(matchesFontFaceQuery(faces[1]!, "游明朝体")).toBe(true);
    expect(matchesFontFaceQuery(faces[1]!, "yumin")).toBe(true);
    expect(matchesFontFaceQuery(faces[1]!, "  YUMIN-MEDIUM ")).toBe(true);
    expect(matchesFontFaceQuery(faces[1]!, "游ゴシック")).toBe(false);
    expect(matchesFontFaceQuery(faces[1]!, "")).toBe(true);
  });
});

describe("selectableFontFaces", () => {
  it("keeps every face of a family selectable as its own option", () => {
    const options = selectableFontFaces(faces, "游明朝体", undefined);
    expect(options.map((entry) => entry.postScriptName)).toEqual([
      "YuMin_36pKn-Extrabold",
      "YuMin-Medium",
      "YuMin-Demibold",
    ]);
  });

  it("applies the limit to the filtered list", () => {
    const options = selectableFontFaces(faces, "", undefined, 2);
    expect(options.map((entry) => entry.postScriptName)).toEqual([
      "YuMin_36pKn-Extrabold",
      "YuMin-Medium",
    ]);
  });

  it("keeps the selected face even when the search or the limit would hide it", () => {
    const bySearch = selectableFontFaces(faces, "游ゴシック", "YuMin-Medium");
    expect(bySearch.map((entry) => entry.postScriptName)).toEqual(["YuMin-Medium", "YuGo-Bold"]);

    const byLimit = selectableFontFaces(faces, "", "YuGo-Bold", 1);
    expect(byLimit.map((entry) => entry.postScriptName)).toEqual([
      "YuGo-Bold",
      "YuMin_36pKn-Extrabold",
    ]);
  });

  it("returns the filtered list when the selected face is unknown", () => {
    const options = selectableFontFaces(faces, "", "Removed-Font", 2);
    expect(options.map((entry) => entry.postScriptName)).toEqual([
      "YuMin_36pKn-Extrabold",
      "YuMin-Medium",
    ]);
  });
});

describe("includeFontFace", () => {
  it("prepends the selected face when the option list omits it", () => {
    const options = includeFontFace([faces[1]!], faces, "YuGo-Bold");
    expect(options.map((entry) => entry.postScriptName)).toEqual(["YuGo-Bold", "YuMin-Medium"]);
  });

  it("keeps the selected face in place when it is already an option", () => {
    const options = includeFontFace(faces, faces, "YuMin-Medium");
    expect(options.map((entry) => entry.postScriptName)).toEqual(
      faces.map((entry) => entry.postScriptName),
    );
  });

  it("keeps the list untouched when nothing is selected or the face is unknown", () => {
    expect(includeFontFace(faces, faces, undefined)).toHaveLength(faces.length);
    expect(includeFontFace(faces, faces, "Removed-Font")).toHaveLength(faces.length);
  });
});
