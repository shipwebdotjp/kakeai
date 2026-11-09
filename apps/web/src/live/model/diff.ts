import {
  type LiveCard,
  type LiveProgramDocument,
  type LiveProgramSegment,
  type LiveVisualRef,
} from "@kakeai/contracts";
import { stableJson } from "./canonical";
import { describeVisual, visualRefEquals, type CueVisualValue } from "./visual";

export type LiveProgramDiffArea =
  | "document"
  | "policy"
  | "segment"
  | "cue"
  | "card"
  | "cardState"
  | "visual"
  | "material"
  | "cutIn";

export type LiveProgramDiffChange = "added" | "removed" | "changed";

export interface LiveProgramDiffEntry {
  area: LiveProgramDiffArea;
  change: LiveProgramDiffChange;
  id: string;
  parentId?: string;
  /** Machine field names; the UI supplies Japanese labels. */
  fields: string[];
  before?: string;
  after?: string;
  /** Structured visual values, set only for `area: "visual"`. */
  beforeVisual?: CueVisualValue;
  afterVisual?: CueVisualValue;
}

export interface LiveProgramDiffSummary {
  entries: LiveProgramDiffEntry[];
  counts: { added: number; removed: number; changed: number };
  isEmpty: boolean;
}

/** A cut_in segment has no visual field; `undefined` is the "none" sentinel. */
function segmentVisual(segment: LiveProgramSegment): LiveVisualRef | undefined {
  return segment.kind === "cut_in" ? undefined : segment.visual;
}

function describeSegmentVisual(
  document: LiveProgramDocument,
  visual: LiveVisualRef | undefined,
): string {
  return visual === undefined
    ? "なし"
    : describeVisual(document.cards, document.materials, visual);
}

function indexed<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function changedFields(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  fields: readonly string[],
): string[] {
  return fields.filter(
    (field) => stableJson(baseline[field]) !== stableJson(current[field]),
  );
}

function display(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return stableJson(value);
}

export function diffLiveProgramDocuments(
  baseline: LiveProgramDocument,
  current: LiveProgramDocument,
): LiveProgramDiffSummary {
  const entries: LiveProgramDiffEntry[] = [];

  const documentFields = ["title", "targetDurationMs", "theme", "cast", "stageTemplate"];
  for (const field of documentFields) {
    if (stableJson(baseline[field as keyof LiveProgramDocument]) === stableJson(current[field as keyof LiveProgramDocument])) {
      continue;
    }
    entries.push({
      area: "document",
      change: "changed",
      id: field,
      fields: [field],
      before: display(baseline[field as keyof LiveProgramDocument]),
      after: display(current[field as keyof LiveProgramDocument]),
    });
  }

  for (const field of ["commentPolicy", "safety", "playout"] as const) {
    if (stableJson(baseline[field]) !== stableJson(current[field])) {
      entries.push({
        area: "policy",
        change: "changed",
        id: field,
        fields: [field],
      });
    }
  }

  const baselineSegments = indexed(baseline.segments);
  const currentSegments = indexed(current.segments);
  const baselineSegmentIndex = new Map(
    baseline.segments.map((segment, index) => [segment.id, index]),
  );
  const currentSegmentIndex = new Map(
    current.segments.map((segment, index) => [segment.id, index]),
  );
  for (const [id, segment] of currentSegments) {
    const previous = baselineSegments.get(id);
    if (previous === undefined) {
      entries.push({ area: "segment", change: "added", id, fields: [] });
      continue;
    }
    const fields = changedFields(
      previous as unknown as Record<string, unknown>,
      segment as unknown as Record<string, unknown>,
      ["label", "targetDurationMs", "kind", "cues", "commentPolicy", "cutInId"],
    );
    if (fields.length > 0) {
      entries.push({ area: "segment", change: "changed", id, fields });
    }
    const previousVisual = segmentVisual(previous);
    const currentVisual = segmentVisual(segment);
    if (!visualRefEquals(previousVisual, currentVisual)) {
      entries.push({
        area: "visual",
        change: "changed",
        id,
        parentId: "segment",
        fields: ["visual"],
        beforeVisual: previousVisual,
        afterVisual: currentVisual,
        before: describeSegmentVisual(baseline, previousVisual),
        after: describeSegmentVisual(current, currentVisual),
      });
    }
    const previousIndex = baselineSegmentIndex.get(id) ?? -1;
    const currentIndex = currentSegmentIndex.get(id) ?? -1;
    if (previousIndex !== currentIndex) {
      entries.push({
        area: "segment",
        change: "changed",
        id,
        fields: ["order"],
        before: String(previousIndex + 1),
        after: String(currentIndex + 1),
      });
    }
  }
  for (const id of baselineSegments.keys()) {
    if (!currentSegments.has(id)) {
      entries.push({ area: "segment", change: "removed", id, fields: [] });
    }
  }

  const baselineCues = indexed(baseline.cues);
  const currentCues = indexed(current.cues);
  for (const [id, cue] of currentCues) {
    const previous = baselineCues.get(id);
    if (previous === undefined) {
      entries.push({ area: "cue", change: "added", id, fields: [] });
      continue;
    }
    const fields = changedFields(
      previous as unknown as Record<string, unknown>,
      cue as unknown as Record<string, unknown>,
      ["speaker", "caption", "speech", "expression", "audioAssetId"],
    );
    if (fields.length > 0) {
      entries.push({ area: "cue", change: "changed", id, fields });
    }
    if (!visualRefEquals(previous.visual, cue.visual)) {
      entries.push({
        area: "visual",
        change: "changed",
        id,
        parentId: "cue",
        fields: ["visual"],
        beforeVisual: previous.visual,
        afterVisual: cue.visual,
        before: describeVisual(baseline.cards, baseline.materials, previous.visual),
        after: describeVisual(current.cards, current.materials, cue.visual),
      });
    }
  }
  for (const id of baselineCues.keys()) {
    if (!currentCues.has(id)) {
      entries.push({ area: "cue", change: "removed", id, fields: [] });
    }
  }

  const baselineCards = indexed(baseline.cards);
  const currentCards = indexed(current.cards);
  for (const [id, card] of currentCards) {
    const previous = baselineCards.get(id);
    if (previous === undefined) {
      entries.push({ area: "card", change: "added", id, fields: [] });
      diffStates(previous, entries, card);
      continue;
    }
    const fields = changedFields(
      previous as unknown as Record<string, unknown>,
      card as unknown as Record<string, unknown>,
      ["type", "name", "animation", "variant", "chartAnimation"],
    );
    if (fields.length > 0) {
      entries.push({ area: "card", change: "changed", id, fields });
    }
    diffStates(previous, entries, card);
  }
  for (const id of baselineCards.keys()) {
    if (!currentCards.has(id)) {
      entries.push({ area: "card", change: "removed", id, fields: [] });
    }
  }

  const baselineMaterials = indexed(baseline.materials);
  const currentMaterials = indexed(current.materials);
  for (const [id, material] of currentMaterials) {
    const previous = baselineMaterials.get(id);
    if (previous === undefined) {
      entries.push({ area: "material", change: "added", id, fields: [] });
    } else if (stableJson(previous) !== stableJson(material)) {
      entries.push({
        area: "material",
        change: "changed",
        id,
        fields: changedFields(
          previous as unknown as Record<string, unknown>,
          material as unknown as Record<string, unknown>,
          ["name"],
        ),
      });
    }
  }
  for (const id of baselineMaterials.keys()) {
    if (!currentMaterials.has(id)) {
      entries.push({ area: "material", change: "removed", id, fields: [] });
    }
  }

  const baselineCutIns = indexed(baseline.cutIns);
  const currentCutIns = indexed(current.cutIns);
  for (const [id, cutIn] of currentCutIns) {
    const previous = baselineCutIns.get(id);
    if (previous === undefined) {
      entries.push({ area: "cutIn", change: "added", id, fields: [] });
    } else if (previous.assetId !== cutIn.assetId) {
      entries.push({ area: "cutIn", change: "changed", id, fields: ["assetId"] });
    }
  }
  for (const id of baselineCutIns.keys()) {
    if (!currentCutIns.has(id)) {
      entries.push({ area: "cutIn", change: "removed", id, fields: [] });
    }
  }

  const counts = {
    added: entries.filter((entry) => entry.change === "added").length,
    removed: entries.filter((entry) => entry.change === "removed").length,
    changed: entries.filter((entry) => entry.change === "changed").length,
  };
  return {
    entries,
    counts,
    isEmpty: entries.length === 0,
  };
}

function diffStates(
  previous: LiveCard | undefined,
  entries: LiveProgramDiffEntry[],
  card: LiveCard,
): void {
  const baselineStates = new Map(
    (previous?.states ?? []).map((state) => [state.id, state]),
  );
  const currentStates = new Map(card.states.map((state) => [state.id, state]));
  for (const [stateId, state] of currentStates) {
    const before = baselineStates.get(stateId);
    if (before === undefined) {
      entries.push({
        area: "cardState",
        change: "added",
        id: stateId,
        parentId: card.id,
        fields: [],
      });
      continue;
    }
    const fields = changedFields(
      before as unknown as Record<string, unknown>,
      state as unknown as Record<string, unknown>,
      [
        "title",
        "subtitle",
        "kicker",
        "tone",
        "align",
        "assetId",
        "alt",
        "caption",
        "credit",
        "fit",
        "items",
        "activeItemId",
        "ordered",
        "categories",
        "series",
        "unit",
        "highlight",
        "quote",
        "author",
        "source",
      ],
    );
    if (fields.length > 0) {
      entries.push({
        area: "cardState",
        change: "changed",
        id: stateId,
        parentId: card.id,
        fields,
      });
    }
  }
  for (const stateId of baselineStates.keys()) {
    if (!currentStates.has(stateId)) {
      entries.push({
        area: "cardState",
        change: "removed",
        id: stateId,
        parentId: card.id,
        fields: [],
      });
    }
  }
}
