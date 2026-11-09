import {
  LIVE_PROGRAM_DEFAULT_COMMENT_POLICY,
  LIVE_PROGRAM_DEFAULT_PLAYOUT,
  type LiveCard,
  type LiveCommentPolicy,
  type LiveFormatCueRole,
  type LiveFormatCueSegmentTemplate,
  type LiveFormatCueTemplate,
  type LiveFormatDocumentV1,
  type LiveFormatVisualRef,
  type LiveProgramCast,
  type LiveVisualRef,
  type VisualThemeRef,
} from "@kakeai/contracts";
import { removeCardState } from "./cards";

export const DEFAULT_FORMAT_OPENING_MS = 120_000;
export const DEFAULT_FORMAT_CLOSING_MS = 120_000;

export interface DefaultLiveFormatInput {
  name: string;
  title?: string;
  targetDurationMs?: number;
  theme: VisualThemeRef;
  cast: LiveProgramCast;
}

/**
 * Starter preset used by the format creation screen. It satisfies the format
 * contract immediately: one opening, one script, one closing and one generic
 * cue for each role.
 */
export function createDefaultLiveFormatDocument(
  input: DefaultLiveFormatInput,
): LiveFormatDocumentV1 {
  const targetDurationMs = input.targetDurationMs ?? 1_800_000;
  const openingId = "format-seg-opening";
  const scriptId = "format-seg-script";
  const closingId = "format-seg-closing";
  const openingCueId = "format-cue-opening";
  const closingCueId = "format-cue-closing";
  const fallbackCueId = "format-cue-fallback";
  const scriptDurationMs = Math.max(
    60_000,
    targetDurationMs - DEFAULT_FORMAT_OPENING_MS - DEFAULT_FORMAT_CLOSING_MS,
  );
  const cues: LiveFormatCueTemplate[] = [
    {
      id: openingCueId,
      role: "opening",
      speaker: "left",
      caption: "番組が始まりました。",
      speech: "ばんぐみが はじまりました。",
      expression: "normal",
    },
    {
      id: closingCueId,
      role: "closing",
      speaker: "left",
      caption: "本日はここまでです。",
      speech: "ほんじつは ここまでです。",
      expression: "normal",
    },
    {
      id: fallbackCueId,
      role: "fallback",
      speaker: "left",
      caption: "少し補足します。",
      speech: "すこし ほそくします。",
      expression: "normal",
    },
  ];
  return {
    schemaVersion: 1,
    name: input.name,
    title: input.title ?? input.name,
    locale: "ja-JP",
    targetDurationMs,
    stageTemplate: "news-desk",
    theme: input.theme,
    cast: input.cast,
    segments: [
      {
        id: openingId,
        kind: "opening",
        label: "オープニング",
        targetDurationMs: DEFAULT_FORMAT_OPENING_MS,
      },
      {
        id: scriptId,
        kind: "script",
        label: "本編",
        targetDurationMs: scriptDurationMs,
      },
      {
        id: closingId,
        kind: "closing",
        label: "クロージング",
        targetDurationMs: DEFAULT_FORMAT_CLOSING_MS,
      },
    ],
    cues,
    cards: [],
    commentPolicy: { ...LIVE_PROGRAM_DEFAULT_COMMENT_POLICY },
    safety: {
      blockedTopics: [],
      persona: "親しみやすい解説キャラクター。",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId,
    },
    playout: { ...LIVE_PROGRAM_DEFAULT_PLAYOUT },
  };
}

export function createFormatCue(input: {
  id: string;
  role: LiveFormatCueRole;
  speaker?: "left" | "right";
  caption: string;
  speech: string;
  expression?: string;
}): LiveFormatCueTemplate {
  return {
    id: input.id,
    role: input.role,
    speaker: input.speaker ?? "left",
    caption: input.caption,
    speech: input.speech,
    expression: input.expression ?? "normal",
  };
}

export function updateFormatCue(
  document: LiveFormatDocumentV1,
  cueId: string,
  patch: Partial<Omit<LiveFormatCueTemplate, "id" | "role">>,
): LiveFormatDocumentV1 {
  return {
    ...document,
    cues: document.cues.map((cue) => (cue.id === cueId ? { ...cue, ...patch } : cue)),
  };
}

export function addFormatCue(
  document: LiveFormatDocumentV1,
  cue: LiveFormatCueTemplate,
): LiveFormatDocumentV1 {
  if (
    document.cues.some((entry) => entry.id === cue.id) ||
    document.cues.some((entry) => entry.role === cue.role)
  ) {
    return document;
  }
  return { ...document, cues: [...document.cues, cue] };
}


function insertFormatSegment(
  document: LiveFormatDocumentV1,
  segment: LiveFormatDocumentV1["segments"][number],
  index?: number,
): LiveFormatDocumentV1 {
  if (document.segments.some((entry) => entry.id === segment.id)) {
    return document;
  }
  // Keep the spine invariant "exactly one opening first, one closing last".
  if (segment.kind === "opening") {
    if (
      document.segments.some((entry) => entry.kind === "opening") ||
      (index !== undefined && index !== 0)
    ) {
      return document;
    }
    return { ...document, segments: [segment, ...document.segments] };
  }
  if (segment.kind === "closing") {
    if (
      document.segments.some((entry) => entry.kind === "closing") ||
      (index !== undefined && index !== document.segments.length)
    ) {
      return document;
    }
    return { ...document, segments: [...document.segments, segment] };
  }
  const closingIndex = document.segments.findIndex((entry) => entry.kind === "closing");
  const maximum = closingIndex === -1 ? document.segments.length : closingIndex;
  const minimum = document.segments.length === 0 ? 0 : 1;
  if (index !== undefined && (index < minimum || index > maximum)) {
    return document;
  }
  const bounded = index ?? maximum;
  if (
    segment.kind === "cut_in" &&
    (bounded === 0 ||
      bounded === document.segments.length ||
      !document.segments.some((entry) => entry.kind === "opening") ||
      closingIndex === -1)
  ) {
    return document;
  }
  return {
    ...document,
    segments: [
      ...document.segments.slice(0, bounded),
      segment,
      ...document.segments.slice(bounded),
    ],
  };
}

export function addFormatCueSegment(
  document: LiveFormatDocumentV1,
  input: {
    id: string;
    kind: "opening" | "script" | "closing";
    label?: string;
    targetDurationMs?: number;
    index?: number;
  },
): LiveFormatDocumentV1 {
  const segment: LiveFormatCueSegmentTemplate = {
    id: input.id,
    kind: input.kind,
    label: input.label ?? (input.kind === "script" ? "新しいセグメント" : input.kind),
    targetDurationMs: input.targetDurationMs ?? 300_000,
  };
  return insertFormatSegment(document, segment, input.index);
}

export function addFormatCommentSegment(
  document: LiveFormatDocumentV1,
  input: { id: string; label?: string; targetDurationMs?: number; index?: number },
): LiveFormatDocumentV1 {
  return insertFormatSegment(
    document,
    {
      id: input.id,
      kind: "comment",
      label: input.label ?? "コメント",
      targetDurationMs: input.targetDurationMs ?? 300_000,
    },
    input.index,
  );
}

export function addFormatCutInSegment(
  document: LiveFormatDocumentV1,
  input: { id: string; label?: string; targetDurationMs?: number; index?: number },
): LiveFormatDocumentV1 {
  return insertFormatSegment(
    document,
    {
      id: input.id,
      kind: "cut_in",
      label: input.label ?? "CutIn",
      ...(input.targetDurationMs === undefined
        ? {}
        : { targetDurationMs: input.targetDurationMs }),
    },
    input.index,
  );
}

export function removeFormatSegment(
  document: LiveFormatDocumentV1,
  segmentId: string,
): LiveFormatDocumentV1 {
  const target = document.segments.find((segment) => segment.id === segmentId);
  if (target === undefined) {
    return document;
  }
  // The spine must always keep its opening, closing and at least one script.
  if (target.kind === "opening" || target.kind === "closing") {
    return document;
  }
  if (
    target.kind === "script" &&
    document.segments.filter((segment) => segment.kind === "script").length <= 1
  ) {
    return document;
  }
  return {
    ...document,
    segments: document.segments.filter((segment) => segment.id !== segmentId),
  };
}

export function moveFormatSegment(
  document: LiveFormatDocumentV1,
  segmentId: string,
  direction: -1 | 1,
): LiveFormatDocumentV1 {
  const index = document.segments.findIndex((segment) => segment.id === segmentId);
  if (index === -1) {
    return document;
  }
  const segment = document.segments[index]!;
  if (segment.kind === "opening" || segment.kind === "closing") {
    return document;
  }
  const target = index + direction;
  if (target < 0 || target >= document.segments.length) {
    return document;
  }
  // Never let a non-opening/non-closing segment land on a spine end.
  if (target === 0 || target === document.segments.length - 1) {
    return document;
  }
  const segments = [...document.segments];
  segments[index] = segments[target]!;
  segments[target] = segment;
  return { ...document, segments };
}

export function patchFormatSegment(
  document: LiveFormatDocumentV1,
  segmentId: string,
  patch: {
    label?: string;
    targetDurationMs?: number;
    visual?: LiveFormatVisualRef;
    commentPolicy?: Partial<LiveCommentPolicy>;
  },
): LiveFormatDocumentV1 {
  return {
    ...document,
    segments: document.segments.map((segment) => {
      if (segment.id !== segmentId) {
        return segment;
      }
      if (segment.kind === "cut_in") {
        return {
          ...segment,
          ...(patch.label === undefined ? {} : { label: patch.label }),
          ...(patch.targetDurationMs === undefined
            ? {}
            : { targetDurationMs: patch.targetDurationMs }),
        };
      }
      if (segment.kind === "comment") {
        const next = {
          ...segment,
          ...(patch.label === undefined ? {} : { label: patch.label }),
          ...(patch.targetDurationMs === undefined
            ? {}
            : { targetDurationMs: patch.targetDurationMs }),
          ...(patch.commentPolicy === undefined
            ? {}
            : { commentPolicy: patch.commentPolicy }),
        };
        if (!("visual" in patch)) {
          return next;
        }
        if (patch.visual === undefined) {
          const { visual: _removed, ...rest } = next;
          return rest;
        }
        return { ...next, visual: patch.visual };
      }
      const next = {
        ...segment,
        ...(patch.label === undefined ? {} : { label: patch.label }),
        ...(patch.targetDurationMs === undefined
          ? {}
          : { targetDurationMs: patch.targetDurationMs }),
      };
      if (!("visual" in patch)) {
        return next;
      }
      if (patch.visual === undefined) {
        const { visual: _removed, ...rest } = next;
        return rest;
      }
      return { ...next, visual: patch.visual };
    }),
  };
}

export function replaceFormatCard(
  document: LiveFormatDocumentV1,
  card: LiveCard,
): LiveFormatDocumentV1 {
  return {
    ...document,
    cards: document.cards.map((entry) => (entry.id === card.id ? card : entry)),
  };
}

export function addFormatCard(
  document: LiveFormatDocumentV1,
  card: LiveCard,
): LiveFormatDocumentV1 {
  if (document.cards.some((entry) => entry.id === card.id)) {
    return document;
  }
  return { ...document, cards: [...document.cards, card] };
}

/** Removes a card and segment visuals that referenced it (format has only card visuals). */
export function removeFormatCard(
  document: LiveFormatDocumentV1,
  cardId: string,
): LiveFormatDocumentV1 {
  return {
    ...document,
    cards: document.cards.filter((card) => card.id !== cardId),
    segments: document.segments.map((segment) => {
      if (segment.kind === "cut_in" || segment.visual === undefined) {
        return segment;
      }
      if (segment.visual.cardId !== cardId) {
        return segment;
      }
      const { visual: _removed, ...rest } = segment;
      return rest;
    }),
  };
}

/** Removes a state and clears segment visuals that referenced that exact state. */
export function removeFormatCardState(
  document: LiveFormatDocumentV1,
  cardId: string,
  stateId: string,
): LiveFormatDocumentV1 {
  const card = document.cards.find((entry) => entry.id === cardId);
  if (card === undefined || card.states.length <= 1) {
    return document;
  }
  const nextCard = removeCardState(card, stateId);
  if (nextCard === card) {
    return document;
  }
  return {
    ...document,
    cards: document.cards.map((entry) => (entry.id === cardId ? nextCard : entry)),
    segments: document.segments.map((segment) => {
      if (segment.kind === "cut_in" || segment.visual === undefined) {
        return segment;
      }
      if (segment.visual.cardId !== cardId || segment.visual.stateId !== stateId) {
        return segment;
      }
      const { visual: _removed, ...rest } = segment;
      return rest;
    }),
  };
}

export function toProgramVisual(visual: LiveFormatVisualRef): LiveVisualRef {
  return { kind: "card", cardId: visual.cardId, stateId: visual.stateId };
}

export function toFormatVisual(visual: LiveVisualRef): LiveFormatVisualRef | undefined {
  return visual.kind === "card"
    ? { kind: "card", cardId: visual.cardId, stateId: visual.stateId }
    : undefined;
}

/** CutIn target durations are optional; this is the only path that can clear one. */
export function setFormatCutInDuration(
  document: LiveFormatDocumentV1,
  segmentId: string,
  targetDurationMs: number | undefined,
): LiveFormatDocumentV1 {
  return {
    ...document,
    segments: document.segments.map((segment) => {
      if (segment.id !== segmentId || segment.kind !== "cut_in") {
        return segment;
      }
      if (targetDurationMs === undefined) {
        const { targetDurationMs: _removed, ...rest } = segment;
        return rest;
      }
      return { ...segment, targetDurationMs };
    }),
  };
}
