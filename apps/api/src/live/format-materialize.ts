import {
  liveProgramDocumentSchema,
  type LiveCard,
  type LiveFormatDocumentV1,
  type LiveFormatVisualRef,
  type LiveProgramCueSegment,
  type LiveProgramDocument,
  type LiveProgramSegment,
  type LiveVisualRef,
} from "@kakeai/contracts";
import { ApiError } from "../http/errors.ts";
import { validationErrorFromZod } from "../http/validation.ts";
import { newLiveId } from "./ids.ts";

export interface MaterializeLiveProgramInput {
  formatId: string;
  formatUpdatedAt: string;
  format: LiveFormatDocumentV1;
  title?: string;
}

function remapVisual(
  visual: LiveFormatVisualRef | undefined,
  cardIdMap: ReadonlyMap<string, string>,
  stateIdMap: ReadonlyMap<string, string>,
): LiveVisualRef | undefined {
  if (visual === undefined) {
    return undefined;
  }
  const cardId = cardIdMap.get(visual.cardId);
  const stateId = stateIdMap.get(`${visual.cardId}/${visual.stateId}`);
  if (cardId === undefined || stateId === undefined) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      `フォーマットの visual を解決できません: ${visual.cardId}/${visual.stateId}`,
    );
  }
  return { kind: "card", cardId, stateId };
}

/**
 * Deep-copies a format into a new program draft. Segment, Card, State and Cue
 * ids are newly allocated and every reference (visual, segment cue order,
 * safety fallback) is remapped. CutIn placeholders are omitted because a
 * format never owns the video Asset a CutIn requires.
 */
export function materializeLiveProgramFromFormat(
  input: MaterializeLiveProgramInput,
): LiveProgramDocument {
  const format = input.format;
  const cardIdMap = new Map<string, string>();
  const stateIdMap = new Map<string, string>();
  const cards: LiveCard[] = format.cards.map((card) => {
    const newCardId = newLiveId("card");
    cardIdMap.set(card.id, newCardId);
    const states = card.states.map((state) => {
      const newStateId = newLiveId("state");
      stateIdMap.set(`${card.id}/${state.id}`, newStateId);
      return { ...structuredClone(state), id: newStateId };
    });
    return { ...structuredClone(card), id: newCardId, states } as LiveCard;
  });

  const programCues = format.cues.map((cue) => {
    const id = newLiveId("cue");
    return {
      sourceId: cue.id,
      role: cue.role,
      cue: {
        id,
        speaker: cue.speaker,
        caption: cue.caption,
        speech: cue.speech,
        expression: cue.expression,
      },
    };
  });
  const cueIdByFormatCueId = new Map(
    programCues.map((entry) => [entry.sourceId, entry.cue.id]),
  );

  const segments: LiveProgramSegment[] = [];
  let openingSegment: LiveProgramCueSegment | undefined;
  let closingSegment: LiveProgramCueSegment | undefined;
  let omittedCutInDurationMs = 0;
  for (const segment of format.segments) {
    if (segment.kind === "cut_in") {
      // A format never owns a CutIn video Asset, so the placeholder is
      // omitted. Subtract its budget so the program's target duration does
      // not claim time that no segment covers.
      omittedCutInDurationMs += segment.targetDurationMs ?? 0;
      continue;
    }
    const id = newLiveId("seg");
    if (segment.kind === "comment") {
      segments.push({
        id,
        kind: "comment",
        label: segment.label,
        targetDurationMs: segment.targetDurationMs,
        ...(segment.visual === undefined
          ? {}
          : { visual: remapVisual(segment.visual, cardIdMap, stateIdMap) }),
        ...(segment.commentPolicy === undefined
          ? {}
          : { commentPolicy: structuredClone(segment.commentPolicy) }),
      });
      continue;
    }
    const created: LiveProgramCueSegment = {
      id,
      kind: segment.kind,
      label: segment.label,
      targetDurationMs: segment.targetDurationMs,
      cues: [],
      ...(segment.visual === undefined
        ? {}
        : { visual: remapVisual(segment.visual, cardIdMap, stateIdMap) }),
    };
    segments.push(created);
    if (segment.kind === "opening") {
      openingSegment = created;
    }
    if (segment.kind === "closing") {
      closingSegment = created;
    }
  }

  for (const entry of programCues) {
    if (entry.role === "opening") {
      openingSegment?.cues.push(entry.cue.id);
    } else if (entry.role === "closing") {
      closingSegment?.cues.push(entry.cue.id);
    }
  }
  if (openingSegment === undefined || closingSegment === undefined) {
    throw new ApiError(422, "VALIDATION_ERROR", "フォーマットのスパインを複製できませんでした。");
  }
  const fallbackCueId = cueIdByFormatCueId.get(format.safety.fallbackCueId);
  if (fallbackCueId === undefined) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      `フォーマットの退避キューが見つかりません: ${format.safety.fallbackCueId}`,
    );
  }

  const targetDurationMs = format.targetDurationMs - omittedCutInDurationMs;
  if (targetDurationMs <= format.playout.closingReserveMs) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      `CutIn を除いた目標尺 ${targetDurationMs}ms がクロージング確保尺 ${format.playout.closingReserveMs}ms 以下です。フォーマットの尺を見直してください。`,
    );
  }

  const parsed = liveProgramDocumentSchema.safeParse({
    schemaVersion: 1,
    title: input.title ?? format.title,
    locale: format.locale,
    targetDurationMs,
    stageTemplate: format.stageTemplate,
    theme: format.theme,
    sourceFormat: {
      formatId: input.formatId,
      formatUpdatedAt: input.formatUpdatedAt,
    },
    cast: structuredClone(format.cast),
    segments,
    cues: programCues.map((entry) => entry.cue),
    cards,
    materials: [],
    cutIns: [],
    commentPolicy: structuredClone(format.commentPolicy),
    safety: {
      ...structuredClone(format.safety),
      fallbackCueId,
    },
    playout: structuredClone(format.playout),
  });
  if (!parsed.success) {
    throw validationErrorFromZod(parsed.error);
  }
  return parsed.data;
}
