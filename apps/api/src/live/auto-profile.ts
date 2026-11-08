import {
  liveShowProfileSchema,
  resolveCharacterName,
  type Character,
  type ContentDocument,
  type LiveAutoProfileSummary,
  type LiveCueInput,
  type LiveMaterialInput,
  type LiveScriptCueInput,
  type LiveSegment,
  type LiveShowProfile,
  type NarrationSegment,
  type Scene,
  type Speaker,
} from "@kakeai/contracts";
import { LiveExportError } from "./errors.ts";
import { validateMaterialScene } from "./prepare-materials.ts";

const OPENING_DURATION_MS = 120_000;
const SCRIPT_DURATION_MS = 360_000;
const COMMENT_DURATION_MS = 240_000;
const CLOSING_DURATION_MS = 180_000;
const MATERIAL_DURATION_MS = 4_000;

const DEFAULT_BLOCKED_TOPICS = ["政治", "宗教", "医療", "法律", "金融"];
const DEFAULT_PERSONA =
  "親しみやすい解説キャラクター。断定しすぎず、不明なことは保留する。";
const DEFAULT_MAX_RESPONSE_CHARS = 180;
const DEFAULT_MAX_RESPONSE_CUES = 2;

export interface AutoShowProfileInput {
  title: string;
  content: ContentDocument;
  includeCommentCorners: boolean;
  assetKindById: ReadonlyMap<string, { kind: string }>;
}

export interface AutoShowProfileResult {
  profile: LiveShowProfile;
  summary: LiveAutoProfileSummary;
  warnings: string[];
}

export class AutoProfileError extends Error {
  constructor(
    readonly code: "NO_CHARACTERS" | "NO_SCRIPT_LINES",
    message: string,
  ) {
    super(message);
    this.name = "AutoProfileError";
  }
}

interface CastMember {
  character: Character;
  speakerId: string;
  characterId: string;
}

interface Cast {
  left: CastMember;
  right: CastMember | null;
  speakerIdToCharacterId: Map<string, string>;
}

interface Warner {
  warnings: string[];
  warn: (key: string, message: string) => void;
}

function createWarner(): Warner {
  const warnings: string[] = [];
  const seen = new Set<string>();
  return {
    warnings,
    warn(key, message) {
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      warnings.push(message);
    },
  };
}

function hasText(line: NarrationSegment): boolean {
  return line.captionText.trim().length > 0 && line.speechText.trim().length > 0;
}

function selectCast(content: ContentDocument, warner: Warner): Cast {
  const speakerById = new Map(content.speakers.map((speaker) => [speaker.id, speaker]));
  const characterById = new Map(
    content.characters.map((character) => [character.id, character]),
  );
  const speakersByCharacter = new Map<string, Speaker[]>();
  for (const speaker of content.speakers) {
    if (speaker.characterId === null) {
      continue;
    }
    const speakers = speakersByCharacter.get(speaker.characterId) ?? [];
    speakers.push(speaker);
    speakersByCharacter.set(speaker.characterId, speakers);
  }
  const chosenSpeakerByCharacter = new Map<string, string>();
  const characterOrder: string[] = [];

  for (const scene of content.scenes) {
    for (const line of scene.lines) {
      if (line.speakerId === null) {
        warner.warn(
          `line:${line.id}:no-speaker`,
          `行 ${line.id} に話者が設定されていないため、この行は使いません。`,
        );
        continue;
      }
      const speaker = speakerById.get(line.speakerId);
      if (speaker === undefined) {
        warner.warn(
          `line:${line.id}:unknown-speaker`,
          `行 ${line.id} の話者 ${line.speakerId} が見つからないため、この行は使いません。`,
        );
        continue;
      }
      if (speaker.characterId === null) {
        warner.warn(
          `speaker:${speaker.id}:no-character`,
          `話者 ${speaker.id} にキャラクターが設定されていないため、この話者の行は使いません。`,
        );
        continue;
      }
      const character = characterById.get(speaker.characterId);
      if (character === undefined) {
        warner.warn(
          `speaker:${speaker.id}:unknown-character`,
          `話者 ${speaker.id} のキャラクター ${speaker.characterId} が見つからないため、この話者の行は使いません。`,
        );
        continue;
      }
      const speakers = speakersByCharacter.get(character.id) ?? [];
      if (speakers.length !== 1) {
        warner.warn(
          `character:${character.id}:speaker-count`,
          `キャラクター ${character.id} に複数の話者があるため、このキャラクターは使いません。v1では1キャラクター1話者にしてください。`,
        );
        continue;
      }
      const chosen = speakers[0]!;
      if (chosen.id !== speaker.id) {
        continue;
      }
      if (chosen.voiceProfileId === null) {
        warner.warn(
          `speaker:${chosen.id}:no-voice`,
          `話者 ${chosen.id} に声プロファイルがないため、この話者の行は使いません。`,
        );
        continue;
      }
      if (!character.appearances.some((appearance) => appearance.expression === "normal")) {
        warner.warn(
          `character:${character.id}:no-normal`,
          `キャラクター ${character.id} に expression: normal の外観がないため、このキャラクターは使いません。`,
        );
        continue;
      }

      if (chosenSpeakerByCharacter.has(character.id)) {
        continue;
      }
      if (characterOrder.length >= 2) {
        warner.warn(
          `character:${character.id}:extra`,
          "3人以上のキャラクターがいるため、最初の2人だけを左右に使います。",
        );
        continue;
      }
      chosenSpeakerByCharacter.set(character.id, chosen.id);
      characterOrder.push(character.id);
    }
  }

  const [leftId, rightId] = characterOrder;
  if (leftId === undefined) {
    throw new AutoProfileError(
      "NO_CHARACTERS",
      "台本にキャラクター付きの話者がいません。話者にキャラクターと声プロファイルを設定してください。",
    );
  }

  const leftCharacter = characterById.get(leftId)!;
  const leftSpeakerId = chosenSpeakerByCharacter.get(leftId)!;
  const left: CastMember = {
    character: leftCharacter,
    speakerId: leftSpeakerId,
    characterId: leftId,
  };
  const right =
    rightId === undefined
      ? null
      : {
          character: characterById.get(rightId)!,
          speakerId: chosenSpeakerByCharacter.get(rightId)!,
          characterId: rightId,
        };

  const speakerIdToCharacterId = new Map<string, string>();
  speakerIdToCharacterId.set(left.speakerId, left.characterId);
  if (right !== null) {
    speakerIdToCharacterId.set(right.speakerId, right.characterId);
  }

  return {
    left,
    right,
    speakerIdToCharacterId,
  };
}

function cuesForScene(
  scene: Scene,
  cast: Cast,
  warner: Warner,
): { cues: LiveScriptCueInput[]; cueIds: string[] } {
  const cues: LiveScriptCueInput[] = [];
  for (const line of scene.lines) {
    if (line.speakerId === null) {
      continue;
    }
    if (!cast.speakerIdToCharacterId.has(line.speakerId)) {
      warner.warn(
        `line:${line.id}:cast-excluded`,
        `行 ${line.id} は選択外キャラクターの話者のため使いません。`,
      );
      continue;
    }
    if (!hasText(line)) {
      warner.warn(
        `line:${line.id}:empty-text`,
        `行 ${line.id} の字幕または読み上げが空のため、この行は使いません。`,
      );
      continue;
    }
    cues.push({ id: `cue-script-${line.id}`, lineId: line.id });
  }
  return { cues, cueIds: cues.map((cue) => cue.id) };
}

function materialCandidate(
  scene: Scene,
  input: AutoShowProfileInput,
  warner: Warner,
): LiveMaterialInput | null {
  if (scene.kind === "intro" || scene.kind === "outro") {
    return null;
  }
  if (scene.lines.length > 0) {
    return null;
  }
  if (scene.visualCues.length === 0) {
    warner.warn(
      `scene:${scene.id}:material-empty`,
      `Scene ${scene.id} に表示する VisualCue がないため、素材から除外しました。`,
    );
    return null;
  }
  const material: LiveMaterialInput = {
    id: `material-${scene.id}`,
    sceneId: scene.id,
    focus: true,
    format: "png",
    durationMs: MATERIAL_DURATION_MS,
  };
  try {
    validateMaterialScene(material, input.content, input.assetKindById);
  } catch (error) {
    if (error instanceof LiveExportError) {
      warner.warn(
        `scene:${scene.id}:material-skipped`,
        `Scene ${scene.id} は素材カードにできないため除外しました: ${error.message}`,
      );
      return null;
    }
    throw error;
  }
  return material;
}

/**
 * Materials attach to the script scene immediately before them. A material
 * before the first script scene falls forward to the first script scene.
 */
function precedingScriptSceneIndex(
  scriptSceneIndexes: readonly number[],
  sceneIndex: number,
): number | undefined {
  let before: number | undefined;
  let after: number | undefined;
  for (const scriptIndex of scriptSceneIndexes) {
    if (scriptIndex < sceneIndex) {
      before = scriptIndex;
    } else if (scriptIndex > sceneIndex) {
      after = scriptIndex;
      break;
    }
  }
  return before ?? after;
}

function buildSummary(
  profile: LiveShowProfile,
  content: ContentDocument,
  cast: Cast,
): LiveAutoProfileSummary {
  const sceneById = new Map(content.scenes.map((scene) => [scene.id, scene]));
  const materialLabelById = new Map(
    profile.materials.map((material) => [
      material.id,
      sceneById.get(material.sceneId)?.label ?? material.sceneId,
    ]),
  );
  const displayName = (member: CastMember | null): string | null => {
    if (member === null) {
      return null;
    }
    const name = resolveCharacterName(member.character, content.locale).trim();
    return name.length > 0 ? name : member.characterId;
  };

  return {
    title: profile.show.title,
    targetDurationMs: profile.show.targetDurationMs,
    characters: {
      left: displayName(cast.left),
      right: displayName(cast.right),
    },
    segments: profile.segments.map((segment) => ({
      kind: segment.kind,
      label: segment.label,
      cueCount: "cues" in segment ? segment.cues.length : 0,
      materialLabel:
        segment.kind === "cut_in" || segment.material === undefined
          ? null
          : (materialLabelById.get(segment.material) ?? segment.material),
    })),
    materials: profile.materials.map((material) => ({
      id: material.id,
      sceneId: material.sceneId,
      label: sceneById.get(material.sceneId)?.label ?? material.sceneId,
      format: material.format,
    })),
  };
}

/**
 * Builds a valid Show Profile draft from the ScriptVersion's fixed
 * intro → point/insert → outro structure. The draft uses segment-level
 * materials; per-cue overrides are authored in the saved Show Profile.
 */
export function buildAutoShowProfile(input: AutoShowProfileInput): AutoShowProfileResult {
  const warner = createWarner();
  const cast = selectCast(input.content, warner);

  const scriptCues: LiveScriptCueInput[] = [];
  const liveCues: LiveCueInput[] = [];
  const materials: LiveMaterialInput[] = [];
  const scriptSegments: LiveSegment[] = [];
  const scriptSceneIndexes: number[] = [];
  const scriptSceneIdByIndex = new Map<number, string>();

  input.content.scenes.forEach((scene, sceneIndex) => {
    if (scene.kind !== "point") {
      if (scene.kind !== "intro" && scene.kind !== "outro" && scene.lines.length > 0) {
        warner.warn(
          `scene:${scene.id}:unsupported-script-scene`,
          `Scene ${scene.id} は ${scene.kind} のため script セグメントにできません。`,
        );
      }
      return;
    }
    const { cues, cueIds } = cuesForScene(scene, cast, warner);
    if (cues.length === 0) {
      if (scene.lines.length > 0) {
        warner.warn(
          `scene:${scene.id}:no-script-lines`,
          `Scene ${scene.id} に使用できる行がないため、script セグメントから除外しました。`,
        );
      }
      return;
    }
    scriptCues.push(...cues);
    scriptSceneIndexes.push(sceneIndex);
    scriptSceneIdByIndex.set(sceneIndex, scene.id);
    scriptSegments.push({
      id: `seg-script-${scene.id}`,
      kind: "script",
      label: scene.label,
      targetDurationMs: SCRIPT_DURATION_MS,
      cues: cueIds,
    });
  });

  if (scriptSegments.length === 0) {
    throw new AutoProfileError(
      "NO_SCRIPT_LINES",
      "script セグメントにできる行がありません。台本の行に話者・字幕・読み上げを設定してください。",
    );
  }

  const intro = input.content.scenes.find((scene) => scene.kind === "intro");
  const outro = input.content.scenes.find((scene) => scene.kind === "outro");
  if (intro === undefined || outro === undefined) {
    throw new AutoProfileError(
      "NO_SCRIPT_LINES",
      "intro Scene と outro Scene が見つかりません。",
    );
  }

  const openingCues = cuesForScene(intro, cast, warner);
  scriptCues.push(...openingCues.cues);
  let openingCueIds = openingCues.cueIds;
  if (openingCueIds.length === 0) {
    const cue: LiveCueInput = {
      id: "cue-opening-placeholder",
      speaker: "left",
      caption: "こんにちは。今日も始めましょう。",
      speech: "こんにちは。きょうも はじめましょう。",
      expression: "normal",
    };
    liveCues.push(cue);
    openingCueIds = [cue.id];
    warner.warn(
      "opening:placeholder",
      "intro Scene にセリフがないため、placeholder の opening cue を作成しました。",
    );
  }

  const closingCues = cuesForScene(outro, cast, warner);
  scriptCues.push(...closingCues.cues);
  let closingCueIds = closingCues.cueIds;
  if (closingCueIds.length === 0) {
    const cue: LiveCueInput = {
      id: "cue-closing-placeholder",
      speaker: "left",
      caption: "今日はここまでです。また来週お会いしましょう。",
      speech: "きょうは ここまでです。また らいしゅう おあいしましょう。",
      expression: "normal",
    };
    liveCues.push(cue);
    closingCueIds = [cue.id];
    warner.warn(
      "closing:placeholder",
      "outro Scene にセリフがないため、placeholder の closing cue を作成しました。",
    );
  }

  const materialBySegmentId = new Map<string, string>();
  input.content.scenes.forEach((scene, sceneIndex) => {
    const material = materialCandidate(scene, input, warner);
    if (material === null) {
      return;
    }
    const targetIndex = precedingScriptSceneIndex(scriptSceneIndexes, sceneIndex);
    if (targetIndex === undefined) {
      return;
    }
    const targetSceneId = scriptSceneIdByIndex.get(targetIndex);
    if (targetSceneId === undefined) {
      return;
    }
    const targetSegmentId = `seg-script-${targetSceneId}`;
    if (materialBySegmentId.has(targetSegmentId)) {
      warner.warn(
        `segment:${targetSegmentId}:material-duplicate`,
        `Scene ${scene.id} の素材は、既に素材が紐づいている ${targetSegmentId} に追加できないため除外しました。`,
      );
      return;
    }
    materialBySegmentId.set(targetSegmentId, material.id);
    materials.push(material);
  });

  const baseSegments: LiveSegment[] = [
    {
      id: "seg-opening",
      kind: "opening",
      label: intro.label,
      targetDurationMs: OPENING_DURATION_MS,
      cues: openingCueIds,
    },
  ];
  let commentIndex = 1;
  scriptSegments.forEach((segment, index) => {
    baseSegments.push(segment);
    const shouldAddComment =
      input.includeCommentCorners &&
      (scriptSegments.length === 1 || index < scriptSegments.length - 1);
    if (shouldAddComment) {
      baseSegments.push({
        id: `seg-comment-${commentIndex}`,
        kind: "comment",
        label: `コメント${commentIndex}`,
        targetDurationMs: COMMENT_DURATION_MS,
      });
      commentIndex += 1;
    }
  });
  baseSegments.push({
    id: "seg-closing",
    kind: "closing",
    label: outro.label,
    targetDurationMs: CLOSING_DURATION_MS,
    cues: closingCueIds,
  });

  const segments = baseSegments.map((segment) => {
    const materialId = materialBySegmentId.get(segment.id);
    return materialId === undefined ? segment : { ...segment, material: materialId };
  });

  const fallbackCueId = closingCueIds[closingCueIds.length - 1];
  if (fallbackCueId === undefined) {
    throw new AutoProfileError("NO_SCRIPT_LINES", "closing cue がありません。");
  }
  const rawProfile = {
    schemaVersion: 1,
    show: {
      title: input.title.trim(),
      locale: input.content.locale,
      targetDurationMs: segments.reduce(
        (sum, segment) => sum + ("targetDurationMs" in segment ? segment.targetDurationMs : 0),
        0,
      ),
      stageTemplate: "news-desk",
      theme: "theme.css",
      characters: {
        left: cast.left.characterId,
        right: cast.right?.characterId ?? null,
      },
      startAt: null,
    },
    commentSource: { kind: "youtube" as const },
    segments,
    scriptCues,
    liveCues,
    materials,
    safety: {
      blockedTopics: [...DEFAULT_BLOCKED_TOPICS],
      persona: DEFAULT_PERSONA,
      maxResponseChars: DEFAULT_MAX_RESPONSE_CHARS,
      maxResponseCues: DEFAULT_MAX_RESPONSE_CUES,
      fallbackCueId,
    },
  };
  const profile = liveShowProfileSchema.parse(rawProfile);

  return {
    profile,
    summary: buildSummary(profile, input.content, cast),
    warnings: warner.warnings,
  };
}
