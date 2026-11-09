import { describe, expect, it } from "vitest";
import {
  addCueToSegment,
  createCue,
  moveCue,
  removeCue,
  updateCue,
} from "./cues";
import {
  addCutInSegment,
  addScriptSegment,
  moveSegment,
  patchSegment,
  removeSegment,
} from "./segments";
import { makeProgramDocument } from "./test-helpers";

describe("segment and cue document edits", () => {
  it("adds a cue at the end of the selected cue segment", () => {
    const document = makeProgramDocument();
    const next = addCueToSegment(
      document,
      "seg-script",
      createCue({ id: "cue-new", caption: "追加", speech: "ついか" }),
    );

    expect(next.cues.map((cue) => cue.id)).toContain("cue-new");
    const segment = next.segments.find((entry) => entry.id === "seg-script");
    expect(segment?.kind).toBe("script");
    if (segment?.kind === "script") {
      expect(segment.cues).toEqual(["cue-news", "cue-new"]);
    }
  });

  it("does not add a cue to a comment segment", () => {
    const document = makeProgramDocument();
    const next = addCueToSegment(
      document,
      "seg-comment",
      createCue({ id: "cue-new" }),
    );
    expect(next).toBe(document);
  });

  it("removes a cue from the document and every segment", () => {
    const document = makeProgramDocument();
    const next = removeCue(document, "cue-news");

    expect(next.cues.some((cue) => cue.id === "cue-news")).toBe(false);
    const segment = next.segments.find((entry) => entry.id === "seg-script");
    if (segment?.kind === "script") {
      expect(segment.cues).not.toContain("cue-news");
    }
  });

  it("reorders cues only inside their segment", () => {
    const document = addCueToSegment(
      makeProgramDocument(),
      "seg-script",
      createCue({ id: "cue-second" }),
    );
    const moved = moveCue(document, "seg-script", "cue-second", -1);
    const segment = moved.segments.find((entry) => entry.id === "seg-script");
    if (segment?.kind === "script") {
      expect(segment.cues).toEqual(["cue-second", "cue-news"]);
    }
    expect(moveCue(moved, "seg-script", "cue-second", -1)).toBe(moved);
  });

  it("inserts a new script segment before closing and removes its cues with it", () => {
    const document = addScriptSegment(makeProgramDocument(), {
      id: "seg-new",
      label: "新コーナー",
    });
    const ids = document.segments.map((segment) => segment.id);
    expect(ids.indexOf("seg-new")).toBe(ids.indexOf("seg-closing") - 1);

    const withCue = addCueToSegment(
      document,
      "seg-new",
      createCue({ id: "cue-new" }),
    );
    const removed = removeSegment(withCue, "seg-new");
    expect(removed.segments.some((segment) => segment.id === "seg-new")).toBe(false);
    expect(removed.cues.some((cue) => cue.id === "cue-new")).toBe(false);
  });

  it("inserts a CutIn placeholder and reorders segments", () => {
    const document = addCutInSegment(makeProgramDocument(), {
      id: "seg-cut-2",
      cutInId: "cut-1",
    });
    expect(document.segments.some((segment) => segment.id === "seg-cut-2")).toBe(true);

    const moved = moveSegment(document, "seg-cut-2", -1);
    const ids = moved.segments.map((segment) => segment.id);
    expect(ids.indexOf("seg-cut-2")).toBe(ids.indexOf("seg-comment") - 1);
  });

  it("preserves audio and segment visuals on unrelated patches", () => {
    const document = makeProgramDocument();
    const withAudio = {
      ...document,
      cues: document.cues.map((cue) =>
        cue.id === "cue-news" ? { ...cue, audioAssetId: "asset-audio" } : cue,
      ),
    };
    const afterCaption = updateCue(withAudio, "cue-news", { caption: "変更" });
    expect(afterCaption.cues.find((cue) => cue.id === "cue-news")?.audioAssetId).toBe(
      "asset-audio",
    );

    const afterLabel = patchSegment(withAudio, "seg-script", { label: "ラベル変更" });
    const script = afterLabel.segments.find((segment) => segment.id === "seg-script");
    if (script?.kind === "script") {
      expect(script.visual).toEqual({ kind: "card", cardId: "card-1", stateId: "state-1" });
    }
  });

  it("preserves the opening kind when a visual is applied", () => {
    const document = patchSegment(makeProgramDocument(), "seg-opening", {
      visual: { kind: "card", cardId: "card-1", stateId: "state-1" },
    });
    const segment = document.segments.find((entry) => entry.id === "seg-opening");
    expect(segment?.kind).toBe("opening");
    if (segment?.kind === "opening") {
      expect(segment.visual).toEqual({
        kind: "card",
        cardId: "card-1",
        stateId: "state-1",
      });
    }
  });

  it("applies commentPolicy and visual in one comment segment patch", () => {
    const document = patchSegment(makeProgramDocument(), "seg-comment", {
      commentPolicy: { maxCommentsPerCorner: 2 },
      visual: { kind: "material", materialId: "mat-1" },
    });
    const segment = document.segments.find((entry) => entry.id === "seg-comment");
    expect(segment?.kind).toBe("comment");
    if (segment?.kind === "comment") {
      expect(segment.commentPolicy).toEqual({ maxCommentsPerCorner: 2 });
      expect(segment.visual).toEqual({ kind: "material", materialId: "mat-1" });
    }
  });

  it("refuses to remove the safety fallback cue", () => {
    const document = makeProgramDocument();
    const next = removeCue(document, "cue-fallback");
    expect(next).toBe(document);
    expect(next.cues.some((cue) => cue.id === "cue-fallback")).toBe(true);
  });

  it("keeps a dedicated fallback cue when its segment is removed", () => {
    const document = makeProgramDocument();
    const withFallbackCue = {
      ...document,
      cues: document.cues.map((cue) =>
        cue.id === "cue-fallback"
          ? cue
          : cue,
      ),
      segments: document.segments.map((segment) =>
        segment.id === "seg-closing" && segment.kind === "closing"
          ? { ...segment, cues: [...segment.cues, "cue-fallback"] }
          : segment,
      ),
      safety: { ...document.safety!, fallbackCueId: "cue-fallback" },
    };
    const next = removeSegment(withFallbackCue, "seg-closing");
    expect(next.cues.some((cue) => cue.id === "cue-fallback")).toBe(true);
    expect(next.safety?.fallbackCueId).toBe("cue-fallback");
  });

  it("keeps opening and closing in place when a move would leave the array", () => {
    const document = makeProgramDocument();
    expect(moveSegment(document, "seg-opening", -1)).toBe(document);
    expect(moveSegment(document, "seg-closing", 1)).toBe(document);
  });
});
