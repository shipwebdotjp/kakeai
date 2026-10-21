import type { CharacterFormValue, SceneFormValue, SpeakerFormValue } from "./form";

/**
 * 左ペイン（Cue対応マップ）へ渡す値を更新すべきか判定するための投影。
 * 見た目に影響するフィールドだけを含め、同じ文字列なら通知を省略する。
 */
export function sceneNavProjection(
  scenes: readonly SceneFormValue[],
  speakers: readonly SpeakerFormValue[],
  characters: readonly CharacterFormValue[],
): string {
  return JSON.stringify({
    scenes: scenes.map((scene) => ({
      id: scene.id,
      kind: scene.kind,
      label: scene.label,
      cues: (scene.cues ?? []).map((cue) => ({
        id: cue.id,
        templateId: cue.templateId,
        templateVersion: cue.templateVersion,
        layer: cue.layer,
        order: cue.order,
        rangeKind: cue.rangeKind,
        startLineId: cue.startLineId,
        endLineId: cue.endLineId,
        startMs: cue.startMs,
        endMs: cue.endMs,
        fields: cue.fields,
      })),
      lines: (scene.lines ?? []).map((line) => ({
        id: line.id,
        speakerId: line.speakerId,
        captionText: line.captionText,
      })),
      standings: (scene.standings ?? []).map((standing) => ({
        cueId: standing.cueId,
        side: standing.side,
        characterId: standing.characterId,
        appearanceId: standing.appearanceId,
      })),
    })),
    speakers: speakers.map((speaker) => ({
      id: speaker.id,
      name: speaker.name,
    })),
    characters: characters.map((character) => ({
      id: character.id,
      name: character.name,
      appearances: (character.appearances ?? []).map((appearance) => ({
        id: appearance.id,
        assetId: appearance.assetId,
      })),
    })),
  });
}
