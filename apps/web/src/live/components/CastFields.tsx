import type {
  CharacterLibraryEntry,
  LiveProgramCast,
  VisualThemeRef,
  VoiceProfile,
} from "@kakeai/contracts";
import { metaTextClass, textFieldClass } from "../../ui";
import { RequiredNumberField } from "./DurationField";

export interface ThemeOption {
  id: string;
  name: string;
  version: number;
}

interface CastFieldsProps {
  cast: LiveProgramCast;
  characters: readonly CharacterLibraryEntry[];
  voices: readonly VoiceProfile[];
  onChange: (cast: LiveProgramCast) => void;
}

function voiceOptions(voices: readonly VoiceProfile[]) {
  return voices.map((voice) => (
    <option key={voice.id} value={voice.id}>
      {voice.name}（{voice.adapterId} / {voice.locale}）
    </option>
  ));
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined;
}

export function CastFields({ cast, characters, voices, onChange }: CastFieldsProps) {
  const changeCharacter = (side: "left" | "right", characterId: string) => {
    if (characterId === "") {
      if (side === "right") {
        onChange({ ...cast, right: null });
      }
      // Never write an empty characterId for the left cast.
      return;
    }
    const character = characters.find((entry) => entry.id === characterId);
    const japaneseVoice = character?.voices.find((voice) => voice.locale === "ja-JP");
    const currentVoice =
      side === "left" ? cast.left.voiceProfileId : cast.right?.voiceProfileId;
    const voiceProfileId =
      nonEmpty(japaneseVoice?.voiceProfileId) ??
      nonEmpty(currentVoice) ??
      nonEmpty(voices[0]?.id);
    if (voiceProfileId === undefined) {
      // There is no usable voice yet; keep the current valid cast untouched.
      return;
    }
    if (side === "left") {
      const nextLeft = { characterId, voiceProfileId };
      onChange({
        ...cast,
        left: nextLeft,
        right:
          cast.right !== null && cast.right.characterId === characterId
            ? null
            : cast.right,
      });
      return;
    }
    onChange({
      ...cast,
      right: { characterId, voiceProfileId },
    });
  };

  const changeVoice = (side: "left" | "right", voiceProfileId: string) => {
    if (voiceProfileId === "") {
      return;
    }
    if (side === "left") {
      onChange({
        ...cast,
        left: { ...cast.left, voiceProfileId },
      });
      return;
    }
    if (cast.right !== null) {
      onChange({ ...cast, right: { ...cast.right, voiceProfileId } });
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          左キャラクター
          <select
            className={`mt-1 w-full ${textFieldClass}`}
            value={cast.left.characterId}
            onChange={(event) => changeCharacter("left", event.target.value)}
          >
            {!characters.some((character) => character.id === cast.left.characterId) && (
              <option value={cast.left.characterId}>
                {cast.left.characterId === "" ? "未選択" : `${cast.left.characterId}（未登録）`}
              </option>
            )}
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          左ボイス
          <select
            className={`mt-1 w-full ${textFieldClass}`}
            value={cast.left.voiceProfileId}
            onChange={(event) => changeVoice("left", event.target.value)}
          >
            {!voices.some((voice) => voice.id === cast.left.voiceProfileId) && (
              <option value={cast.left.voiceProfileId}>
                {cast.left.voiceProfileId === ""
                  ? "未選択"
                  : `${cast.left.voiceProfileId}（未登録）`}
              </option>
            )}
            {voiceOptions(voices)}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={cast.right !== null}
          onChange={(event) => {
            if (!event.target.checked) {
              onChange({ ...cast, right: null });
              return;
            }
            const candidate =
              characters.find((entry) => entry.id !== cast.left.characterId) ?? characters[0];
            const voiceProfileId =
              nonEmpty(
                candidate?.voices.find((voice) => voice.locale === "ja-JP")?.voiceProfileId,
              ) ?? nonEmpty(voices[0]?.id);
            if (candidate === undefined || voiceProfileId === undefined) {
              // Leave the cast disabled until a real character and voice exist.
              return;
            }
            onChange({
              ...cast,
              right: {
                characterId: candidate.id,
                voiceProfileId,
              },
            });
          }}
        />
        右キャストを使う
      </label>

      {cast.right !== null && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            右キャラクター
            <select
              className={`mt-1 w-full ${textFieldClass}`}
              value={cast.right.characterId}
              onChange={(event) => changeCharacter("right", event.target.value)}
            >
              {!characters.some((character) => character.id === cast.right?.characterId) && (
                <option value={cast.right.characterId}>
                  {cast.right.characterId === ""
                    ? "未選択"
                    : `${cast.right.characterId}（未登録）`}
                </option>
              )}
              {characters
                .filter((character) => character.id !== cast.left.characterId)
                .map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm">
            右ボイス
            <select
              className={`mt-1 w-full ${textFieldClass}`}
              value={cast.right.voiceProfileId}
              onChange={(event) => changeVoice("right", event.target.value)}
            >
              {!voices.some((voice) => voice.id === cast.right?.voiceProfileId) && (
                <option value={cast.right.voiceProfileId}>
                  {cast.right.voiceProfileId === ""
                    ? "未選択"
                    : `${cast.right.voiceProfileId}（未登録）`}
                </option>
              )}
              {voiceOptions(voices)}
            </select>
          </label>
        </div>
      )}
      <p className={metaTextClass}>
        右キャストが null のとき、右話者のCueは版確定時に拒否されます。
      </p>
    </div>
  );
}

interface ThemeFieldsProps {
  theme: VisualThemeRef;
  themes: readonly ThemeOption[];
  onChange: (theme: VisualThemeRef) => void;
}

export function ThemeFields({ theme, themes, onChange }: ThemeFieldsProps) {
  const selected = themes.find((entry) => entry.id === theme.id);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        テーマ
        <select
          className={`mt-1 w-full ${textFieldClass}`}
          value={selected?.id ?? theme.id}
          onChange={(event) => {
            const next = themes.find((entry) => entry.id === event.target.value);
            if (next !== undefined) {
              onChange({ id: next.id, version: next.version });
            }
          }}
        >
          {selected === undefined && <option value={theme.id}>{theme.id}</option>}
          {themes.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}（v{entry.version}）
            </option>
          ))}
        </select>
      </label>
      <RequiredNumberField
        // The field buffers typed text, so remount it when the theme changes;
        // otherwise an uncommitted version can leak across themes with the same
        // current version number.
        key={theme.id}
        label="テーマ版"
        value={theme.version}
        onCommit={(version) => onChange({ id: theme.id, version })}
      />
    </div>
  );
}
