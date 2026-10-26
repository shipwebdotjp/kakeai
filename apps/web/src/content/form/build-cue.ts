import type { CueFormValue, SceneFormValue } from "./types";
import { newVisualCueId } from "./factories";
import { selectManagedStandingCues } from "./read";
import {
  DEFAULT_STANDING_SCALE,
  STANDING_EDGE_VALUES,
  STANDING_SIDES,
  STANDING_TEMPLATE_ID,
  STANDING_TRANSITION_POLICY,
  STANDING_VERTICAL_VALUES,
} from "./constants";
import {
  buildTransition,
  intOrZero,
  normalizeScale,
  normalizeStandingEnum,
  standingReferencesMissing,
} from "./build-common";
import { buildCueInput, buildRange } from "./build-cue-input";
import {
  DEFAULT_TRANSITION_POLICY,
  characterStandingV1,
  getVisualTemplate,
  DEFAULT_STANDING_EDGE,
  DEFAULT_STANDING_VERTICAL,
  type Scene,
  type StandingSide,
  type VisualCue,
} from "@kakeai/contracts";

export interface BuildCueOptions {
  tolerant?: boolean;
}

function managedStandingIdSet(
  baseScene: Scene | undefined,
): ReadonlySet<string> {
  return new Set(
    (baseScene === undefined ? [] : selectManagedStandingCues(baseScene)).map(
      (entry) => entry.cue.id,
    ),
  );
}

class IncompleteCueError extends Error {}

function buildVisualCue(
  cue: CueFormValue,
  managedIds: ReadonlySet<string>,
): VisualCue | null {
  const definition = getVisualTemplate(cue.templateId, cue.templateVersion);
  const fields = definition?.inputFields;
  if (definition !== undefined && fields !== undefined && fields.length > 0) {
    const input = buildCueInput(cue, definition);
    if (input === null) {
      if (cue.baseCue === null) {
        throw new IncompleteCueError("追加したCueの素材を選択してください");
      }
      return null;
    }
    const layer = definition.layers.includes(cue.layer)
      ? cue.layer
      : (definition.layers[0] ?? "background");
    return {
      id: cue.id,
      template: { id: cue.templateId, version: cue.templateVersion },
      range: buildRange(cue),
      layer,
      order: intOrZero(cue.order),
      transition: buildTransition(cue, definition.transitionPolicy),
      input,
    };
  }
  if (cue.baseCue !== null && !managedIds.has(cue.baseCue.id)) {
    const baseDefinition = getVisualTemplate(
      cue.baseCue.template.id,
      cue.baseCue.template.version,
    );
    const allowedBaseLayers = baseDefinition?.layers;
    return {
      ...cue.baseCue,
      range: buildRange(cue),
      layer:
        allowedBaseLayers !== undefined && allowedBaseLayers.includes(cue.layer)
          ? cue.layer
          : cue.baseCue.layer,
      order: intOrZero(cue.order),
      transition: buildTransition(
        cue,
        baseDefinition?.transitionPolicy ?? DEFAULT_TRANSITION_POLICY,
      ),
    };
  }
  return null;
}

export function buildVisualCues(
  baseScene: Scene | undefined,
  sceneValue: SceneFormValue,
  options: BuildCueOptions = {},
): VisualCue[] {
  const managedIds = managedStandingIdSet(baseScene);
  const cues: VisualCue[] = [];
  for (const cue of sceneValue.cues) {
    try {
      const built = buildVisualCue(cue, managedIds);
      if (built !== null) {
        cues.push(built);
      }
    } catch (error) {
      if (!(error instanceof IncompleteCueError)) {
        throw error;
      }
      if (!options.tolerant) {
        throw error;
      }
    }
  }
  return cues;
}

export function buildStandingCues(
  baseScene: Scene | undefined,
  sceneValue: SceneFormValue,
  characterIds: ReadonlySet<string>,
  appearanceIdsByCharacter: ReadonlyMap<string, ReadonlySet<string>>,
): VisualCue[] {
  const managedIds = managedStandingIdSet(baseScene);
  const kept = (baseScene?.visualCues ?? []).filter(
    (cue) =>
      cue.template.id === STANDING_TEMPLATE_ID &&
      !managedIds.has(cue.id) &&
      !standingReferencesMissing(cue, characterIds, appearanceIdsByCharacter),
  );
  const cues: VisualCue[] = [...kept];
  const emittedSides = new Set<StandingSide>();
  let order = kept.reduce((max, cue) => Math.max(max, cue.order), -1) + 1;
  for (const standing of sceneValue.standings) {
    if (standing.characterId === null || standing.appearanceId === null) {
      continue;
    }
    if (
      !STANDING_SIDES.includes(standing.side) ||
      emittedSides.has(standing.side)
    ) {
      continue;
    }
    const appearanceIds = appearanceIdsByCharacter.get(standing.characterId);
    if (
      appearanceIds === undefined ||
      !appearanceIds.has(standing.appearanceId)
    ) {
      continue;
    }
    emittedSides.add(standing.side);
    cues.push({
      id:
        standing.cueId ??
        newVisualCueId(sceneValue.id, `standing-${standing.side}`),
      template: {
        id: characterStandingV1.id,
        version: characterStandingV1.version,
      },
      range: { kind: "scene" },
      layer: "standing",
      order,
      transition: buildTransition(standing, STANDING_TRANSITION_POLICY),
      input: {
        characterId: standing.characterId,
        appearanceId: standing.appearanceId,
        side: standing.side,
        scale: normalizeScale(standing.scale, DEFAULT_STANDING_SCALE),
        edge: normalizeStandingEnum(
          standing.edge,
          STANDING_EDGE_VALUES,
          DEFAULT_STANDING_EDGE,
        ),
        vertical: normalizeStandingEnum(
          standing.vertical,
          STANDING_VERTICAL_VALUES,
          DEFAULT_STANDING_VERTICAL,
        ),
      },
    });
    order += 1;
  }
  return cues;
}
