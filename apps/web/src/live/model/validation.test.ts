import { describe, expect, it } from "vitest";
import type { LiveProgramDocument } from "@kakeai/contracts";
import { removeCue, updateCue } from "./cues";
import { moveSegment, patchSegment } from "./segments";
import { setCueVisual, setSegmentVisual } from "./visual";
import {
  draftValidationIssues,
  validateLiveProgramDocument,
  versionValidationIssues,
} from "./validation";
import { makeProgramDocument } from "./test-helpers";

describe("live program document validation", () => {
  it("accepts the healthy draft and reports only the duration warning for versions", () => {
    const document = makeProgramDocument();
    expect(draftValidationIssues(document)).toEqual([]);

    const versionIssues = versionValidationIssues(document);
    expect(versionIssues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(versionIssues.some((issue) => issue.code === "duration-mismatch")).toBe(true);
  });

  it("reports dangling card states, materials, CutIns and cue references", () => {
    let document = setCueVisual(makeProgramDocument(), "cue-news", {
      kind: "card",
      cardId: "card-1",
      stateId: "missing-state",
    });
    expect(
      draftValidationIssues(document).some(
        (issue) =>
          issue.path[0] === "cues" &&
          issue.path[1] === 1 &&
          issue.path[2] === "visual",
      ),
    ).toBe(true);

    document = setSegmentVisual(document, "seg-script", {
      kind: "material",
      materialId: "missing-material",
    });
    expect(
      draftValidationIssues(document).some(
        (issue) =>
          issue.path[0] === "segments" &&
          issue.path[1] === 1 &&
          issue.path[2] === "visual",
      ),
    ).toBe(true);

    document = patchSegment(document, "seg-cut", { cutInId: "missing-cut" });
    expect(
      draftValidationIssues(document).some(
        (issue) =>
          issue.path[0] === "segments" &&
          issue.path[1] === 2 &&
          issue.path[2] === "cutInId",
      ),
    ).toBe(true);

    document = makeProgramDocument();
    const broken = {
      ...document,
      segments: document.segments.map((segment) =>
        segment.id === "seg-script" && segment.kind === "script"
          ? { ...segment, cues: [...segment.cues, "missing-cue"] }
          : segment,
      ),
    };
    expect(
      draftValidationIssues(broken).some(
        (issue) => issue.path[0] === "segments" && issue.path[1] === 1,
      ),
    ).toBe(true);
  });

  it("surfaces opening, closing and cut_in spine constraints as version issues", () => {
    const document = moveSegment(makeProgramDocument(), "seg-opening", 1);
    const issues = versionValidationIssues(document);
    expect(
      issues.some(
        (issue) => issue.path[0] === "segments" && issue.path[1] === 0,
      ),
    ).toBe(true);
  });

  it("requires cues for opening/script/closing only at version time", () => {
    const document = removeCue(makeProgramDocument(), "cue-closing");
    expect(draftValidationIssues(document)).toEqual([]);
    expect(
      versionValidationIssues(document).some(
        (issue) =>
          issue.path[0] === "segments" &&
          issue.path[1] === 4 &&
          issue.path[2] === "cues",
      ),
    ).toBe(true);
  });

  it("rejects right-speaker cues when cast.right is null", () => {
    const document = updateCue(makeProgramDocument(), "cue-news", { speaker: "right" });
    expect(
      versionValidationIssues(document).some(
        (issue) =>
          issue.path[0] === "cues" &&
          issue.path[1] === 1 &&
          issue.path[2] === "speaker",
      ),
    ).toBe(true);
  });

  it("rejects a closing reserve that covers the whole program", () => {
    const document = makeProgramDocument();
    const broken = {
      ...document,
      playout: { ...document.playout, closingReserveMs: document.targetDurationMs },
    };
    expect(validateLiveProgramDocument(broken).some((issue) => issue.severity === "error")).toBe(
      true,
    );
  });

  it("does not throw on malformed segments or missing duration fields", () => {
    const base = makeProgramDocument();
    const malformedDocuments = [
      { ...base, segments: undefined },
      { ...base, targetDurationMs: undefined },
      { ...base, targetDurationMs: Number.NaN },
      { ...base, segments: [{ id: "seg-only", kind: "script" }] },
    ] as unknown as LiveProgramDocument[];

    for (const document of malformedDocuments) {
      expect(() => validateLiveProgramDocument(document)).not.toThrow();
      expect(validateLiveProgramDocument(document).length).toBeGreaterThan(0);
    }
  });
});
