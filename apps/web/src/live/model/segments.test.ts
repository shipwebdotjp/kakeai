import type { LiveProgramSegment } from "@kakeai/contracts";
import { describe, expect, it } from "vitest";
import { addScriptSegment, insertSegment, moveSegment } from "./segments";
import { makeProgramDocument } from "./test-helpers";

describe("live program segments", () => {
  it("refuses to insert a segment with a duplicate id", () => {
    const document = makeProgramDocument();
    expect(addScriptSegment(document, { id: "seg-script" })).toBe(document);
    expect(
      insertSegment(document, {
        id: "seg-opening",
        kind: "comment",
        label: "重複",
        targetDurationMs: 60_000,
      }),
    ).toBe(document);
  });

  it("inserts a new segment before the closing segment", () => {
    const document = makeProgramDocument();
    const next = addScriptSegment(document, { id: "seg-new" });
    const ids = next.segments.map((segment) => segment.id);
    expect(ids).toEqual([
      "seg-opening",
      "seg-script",
      "seg-cut",
      "seg-comment",
      "seg-new",
      "seg-closing",
    ]);
  });

  it("inserts at index 0 so a draft missing its opening can be repaired", () => {
    const document = makeProgramDocument();
    const withoutOpening = {
      ...document,
      segments: document.segments.slice(1),
    };
    const opening: LiveProgramSegment = {
      id: "seg-opening-new",
      kind: "opening",
      label: "新しい開始",
      targetDurationMs: 60_000,
      cues: [],
    };

    const next = insertSegment(withoutOpening, opening, 0);
    expect(next.segments.map((segment) => segment.id)).toEqual([
      "seg-opening-new",
      "seg-script",
      "seg-cut",
      "seg-comment",
      "seg-closing",
    ]);
    expect(next.segments).toHaveLength(withoutOpening.segments.length + 1);
  });

  it("swaps adjacent segments without changing their ids", () => {
    const document = makeProgramDocument();
    const next = moveSegment(document, "seg-comment", -1);
    expect(next.segments.map((segment) => segment.id)).toEqual([
      "seg-opening",
      "seg-script",
      "seg-comment",
      "seg-cut",
      "seg-closing",
    ]);
  });
});
