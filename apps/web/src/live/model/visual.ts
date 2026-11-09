import {
  resolveLiveCardState,
  type LiveCard,
  type LiveProgramCue,
  type LiveProgramDocument,
  type LiveProgramMaterial,
  type LiveProgramSegment,
  type LiveVisualRef,
} from "@kakeai/contracts";

/**
 * `undefined` means "inherit the segment default" and must never be collapsed
 * into `null`, which explicitly hides the centre visual.
 */
export type CueVisualValue = LiveVisualRef | null | undefined;

export type EffectiveVisualSource = "cue" | "segment" | "none";

export interface EffectiveVisual {
  visual: LiveVisualRef | null;
  source: EffectiveVisualSource;
}

export function isCueSegment(
  segment: LiveProgramSegment,
): segment is Extract<LiveProgramSegment, { cues: string[] }> {
  return segment.kind === "opening" || segment.kind === "script" || segment.kind === "closing";
}

export function segmentDefaultVisual(segment: LiveProgramSegment): LiveVisualRef | null {
  if (segment.kind === "cut_in") {
    return null;
  }
  return segment.visual ?? null;
}

export function resolveEffectiveVisual(
  segment: LiveProgramSegment,
  cue: LiveProgramCue,
): EffectiveVisual {
  if (cue.visual !== undefined) {
    return { visual: cue.visual, source: "cue" };
  }
  const segmentVisual = segmentDefaultVisual(segment);
  if (segmentVisual !== null) {
    return { visual: segmentVisual, source: "segment" };
  }
  return { visual: null, source: "none" };
}

export type VisualFieldKind = "inherit" | "hidden" | "card" | "material";

export function visualFieldKind(visual: CueVisualValue): VisualFieldKind {
  if (visual === undefined) {
    return "inherit";
  }
  if (visual === null) {
    return "hidden";
  }
  return visual.kind;
}

export function visualRefKey(visual: LiveVisualRef): string {
  // JSON arrays keep ids that contain ":" or "/" unambiguous.
  return visual.kind === "card"
    ? JSON.stringify(["card", visual.cardId, visual.stateId])
    : JSON.stringify(["material", visual.materialId]);
}

export function visualRefEquals(
  left: CueVisualValue,
  right: CueVisualValue,
): boolean {
  if (left === undefined || left === null || right === undefined || right === null) {
    return left === right;
  }
  // Compare fields directly; ids may themselves contain ":" or "/".
  if (left.kind === "card" && right.kind === "card") {
    return left.cardId === right.cardId && left.stateId === right.stateId;
  }
  if (left.kind === "material" && right.kind === "material") {
    return left.materialId === right.materialId;
  }
  return false;
}

export function describeVisual(
  cards: readonly LiveCard[],
  materials: readonly LiveProgramMaterial[],
  visual: CueVisualValue,
): string {
  if (visual === undefined) {
    return "セグメント既定を継承";
  }
  if (visual === null) {
    return "中央ビジュアルを隠す";
  }
  if (visual.kind === "material") {
    const material = materials.find((entry) => entry.id === visual.materialId);
    return material === undefined
      ? `素材（見つかりません: ${visual.materialId}）`
      : `素材: ${material.name ?? material.id}`;
  }
  const resolved = resolveLiveCardState(cards, visual);
  if (resolved === null) {
    return `カード（見つかりません: ${visual.cardId}/${visual.stateId}）`;
  }
  const name = resolved.card.name;
  const typeLabel = cardTypeLabel(resolved.card.type);
  return name === undefined
    ? `${typeLabel}カード / 状態 ${resolved.state.id}`
    : `カード「${name}」 / 状態 ${resolved.state.id}`;
}

export function cardTypeLabel(type: LiveCard["type"]): string {
  switch (type) {
    case "headline":
      return "見出し";
    case "image":
      return "画像";
    case "list":
      return "リスト";
    case "chart":
      return "グラフ";
    case "quote":
      return "引用";
  }
}

export function setCueVisual(
  document: LiveProgramDocument,
  cueId: string,
  visual: CueVisualValue,
): LiveProgramDocument {
  return {
    ...document,
    cues: document.cues.map((cue) => {
      if (cue.id !== cueId) {
        return cue;
      }
      if (visual === undefined) {
        const { visual: _removed, ...rest } = cue;
        return rest;
      }
      return { ...cue, visual };
    }),
  };
}

/** Segment visuals only have "none" or an explicit ref; null is not a segment value. */
export function setSegmentVisual(
  document: LiveProgramDocument,
  segmentId: string,
  visual: LiveVisualRef | undefined,
): LiveProgramDocument {
  return {
    ...document,
    segments: document.segments.map((segment) => {
      if (segment.id !== segmentId || segment.kind === "cut_in") {
        return segment;
      }
      if (visual === undefined) {
        const { visual: _removed, ...rest } = segment;
        return rest;
      }
      return { ...segment, visual };
    }),
  };
}
