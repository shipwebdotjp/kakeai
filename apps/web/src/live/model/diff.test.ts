import { describe, expect, it } from "vitest";
import type { LiveProgramDocument } from "@kakeai/contracts";
import { addCueToSegment, createCue, removeCue, updateCue } from "./cues";
import { diffLiveProgramDocuments } from "./diff";
import { addScriptSegment } from "./segments";
import { setCueVisual } from "./visual";
import { makeProgramDocument } from "./test-helpers";

describe("draft vs version diff", () => {
  it("reports no changes for identical documents", () => {
    const document = makeProgramDocument();
    const summary = diffLiveProgramDocuments(document, makeProgramDocument());
    expect(summary.isEmpty).toBe(true);
    expect(summary.entries).toEqual([]);
  });

  it("summarizes document, policy, segment, cue and visual changes", () => {
    const baseline = makeProgramDocument();
    let current = {
      ...baseline,
      title: "更新後",
      playout: { ...baseline.playout, minBufferMs: 15_000 },
    };
    current = addScriptSegment(current, { id: "seg-new", label: "新コーナー" });
    current = addCueToSegment(current, "seg-new", createCue({ id: "cue-new" }));
    current = removeCue(current, "cue-closing");
    current = updateCue(current, "cue-news", { caption: "変更後" });
    current = setCueVisual(current, "cue-opening", { kind: "material", materialId: "mat-1" });

    const summary = diffLiveProgramDocuments(baseline, current);
    expect(summary.isEmpty).toBe(false);

    expect(summary.entries).toContainEqual(
      expect.objectContaining({ area: "document", id: "title", change: "changed", fields: ["title"] }),
    );
    expect(summary.entries).toContainEqual(
      expect.objectContaining({ area: "policy", id: "playout", fields: ["playout"] }),
    );
    expect(summary.entries).toContainEqual(
      expect.objectContaining({ area: "segment", id: "seg-new", change: "added" }),
    );
    expect(summary.entries).toContainEqual(
      expect.objectContaining({ area: "cue", id: "cue-new", change: "added" }),
    );
    expect(summary.entries).toContainEqual(
      expect.objectContaining({ area: "cue", id: "cue-closing", change: "removed" }),
    );
    expect(summary.entries).toContainEqual(
      expect.objectContaining({ area: "cue", id: "cue-news", fields: ["caption"] }),
    );
    expect(summary.entries).toContainEqual(
      expect.objectContaining({
        area: "visual",
        id: "cue-opening",
        parentId: "cue",
        beforeVisual: undefined,
        afterVisual: { kind: "material", materialId: "mat-1" },
      }),
    );
  });

  it("keeps visual ids that contain ':' and '/' distinct", () => {
    const baseline = setCueVisual(makeProgramDocument(), "cue-news", {
      kind: "card",
      cardId: "card:news",
      stateId: "2026/state:a/b",
    });
    const current = setCueVisual(baseline, "cue-news", {
      kind: "card",
      cardId: "card:news/2026",
      stateId: "state:a/b",
    });

    const summary = diffLiveProgramDocuments(baseline, current);
    expect(summary.entries).toContainEqual(
      expect.objectContaining({
        area: "visual",
        id: "cue-news",
        beforeVisual: {
          kind: "card",
          cardId: "card:news",
          stateId: "2026/state:a/b",
        },
        afterVisual: {
          kind: "card",
          cardId: "card:news/2026",
          stateId: "state:a/b",
        },
      }),
    );
  });

  it("summarizes card state snapshots and list item changes", () => {
    const baseline = makeProgramDocument();
    const card = baseline.cards[0]!;
    if (card.type !== "list") {
      throw new Error("expected list card");
    }
    const current: LiveProgramDocument = {
      ...baseline,
      cards: [
        {
          ...card,
          states: card.states.map((state) =>
            state.id === "state-2"
              ? {
                  ...state,
                  items: [
                    { id: "item-1", text: "ひとつめ" },
                    { id: "item-2", text: "ふたつめ（更新）" },
                    { id: "item-3", text: "みっつめ" },
                  ],
                }
              : state,
          ),
        },
      ],
    };

    const summary = diffLiveProgramDocuments(baseline, current);
    expect(summary.entries).toContainEqual(
      expect.objectContaining({
        area: "cardState",
        id: "state-2",
        parentId: "card-1",
        fields: ["items"],
      }),
    );
  });

  it("counts changes by kind", () => {
    const baseline = makeProgramDocument();
    const current = addCueToSegment(
      baseline,
      "seg-script",
      createCue({ id: "cue-added" }),
    );
    const summary = diffLiveProgramDocuments(baseline, current);
    expect(summary.counts.added).toBeGreaterThan(0);
    expect(summary.counts.removed).toBe(0);
  });
});
