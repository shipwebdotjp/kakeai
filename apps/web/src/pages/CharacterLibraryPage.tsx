import { useEffect, useState } from "react";
import type { CharacterLibraryEntry, VoiceProfile } from "@kakeai/contracts";
import {
  useCharacters,
  useCreateCharacter,
  useDeleteCharacter,
  useUpdateCharacter,
  useVoiceProfiles,
} from "../api/hooks";
import { createEmptyAppearance, DEFAULT_APPEARANCE_EXPRESSION, DEFAULT_APPEARANCE_POSE } from "../content/form";
import { errorMessage } from "../lib/errorMessage";
import { MediaPicker } from "../components/MediaPicker";
import {
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

interface AppearanceDraft {
  id: string;
  assetId: string | null;
  expression: string;
  pose: string;
  label: string;
}

interface CharacterDraft {
  name: string;
  voiceProfileId: string;
  appearances: AppearanceDraft[];
}

function toDraft(entry: CharacterLibraryEntry): CharacterDraft {
  return {
    name: entry.name,
    voiceProfileId: entry.voiceProfileId ?? "",
    appearances: entry.appearances.map((appearance) => ({
      id: appearance.id,
      assetId: appearance.assetId,
      expression: appearance.expression,
      pose: appearance.pose,
      label: appearance.label ?? "",
    })),
  };
}

function emptyDraft(): CharacterDraft {
  return { name: "", voiceProfileId: "", appearances: [] };
}

interface CharacterFormProps {
  entry?: CharacterLibraryEntry;
  voiceProfiles: VoiceProfile[];
}

function CharacterForm({ entry, voiceProfiles }: CharacterFormProps) {
  const create = useCreateCharacter();
  const update = useUpdateCharacter();
  const remove = useDeleteCharacter();
  const [draft, setDraft] = useState<CharacterDraft>(entry === undefined ? emptyDraft() : toDraft(entry));
  const [issue, setIssue] = useState<string | null>(null);

  useEffect(() => {
    if (entry !== undefined) {
      setDraft(toDraft(entry));
    }
  }, [entry?.id, entry?.updatedAt]);

  const mutation = entry === undefined ? create : update;

  const addAppearance = () => {
    setDraft((current) => ({
      ...current,
      appearances: [...current.appearances, createEmptyAppearance()],
    }));
  };

  const updateAppearance = (id: string, patch: Partial<AppearanceDraft>) => {
    setDraft((current) => ({
      ...current,
      appearances: current.appearances.map((appearance) =>
        appearance.id === id ? { ...appearance, ...patch } : appearance,
      ),
    }));
  };

  const removeAppearance = (id: string) => {
    setDraft((current) => ({
      ...current,
      appearances: current.appearances.filter((appearance) => appearance.id !== id),
    }));
  };

  const save = () => {
    const name = draft.name.trim();
    if (name.length === 0) {
      setIssue("名前を入力してください。");
      return;
    }
    const missing = draft.appearances.findIndex(
      (appearance) => appearance.assetId === null || appearance.assetId.length === 0,
    );
    if (missing !== -1) {
      setIssue(`外観 ${missing + 1} の画像を選んでください。`);
      return;
    }
    setIssue(null);
    const appearances = draft.appearances.map((appearance) => ({
      id: appearance.id,
      assetId: appearance.assetId ?? "",
      expression: appearance.expression.trim() || DEFAULT_APPEARANCE_EXPRESSION,
      pose: appearance.pose.trim() || DEFAULT_APPEARANCE_POSE,
      ...(appearance.label.trim().length === 0 ? {} : { label: appearance.label.trim() }),
    }));
    const payload = {
      name,
      voiceProfileId: draft.voiceProfileId.length === 0 ? null : draft.voiceProfileId,
      appearances,
    };
    if (entry === undefined) {
      create.mutate(payload, { onSuccess: () => setDraft(emptyDraft()) });
    } else {
      update.mutate({ id: entry.id, input: payload });
    }
  };

  return (
    <section className="my-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft.name}
          placeholder="キャラクター名（例: 四国めたん）"
          className={`min-w-[200px] flex-1 ${textFieldClass}`}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
        />
        {entry !== undefined && (
          <button
            type="button"
            className={buttonDangerClass}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`「${entry.name || entry.id}」を削除しますか？`)) {
                remove.mutate(entry.id);
              }
            }}
          >
            削除
          </button>
        )}
      </div>

      <label className="mt-2 flex flex-wrap items-center gap-1.5">
        声プロファイル
        <select
          className={textFieldClass}
          value={draft.voiceProfileId}
          onChange={(event) =>
            setDraft((current) => ({ ...current, voiceProfileId: event.target.value }))
          }
        >
          <option value="">未設定</option>
          {voiceProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name || profile.id}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 border-t border-dashed border-border pt-2">
        <p className="mb-1 text-sm font-medium">外観</p>
        {draft.appearances.map((appearance, index) => (
          <div key={appearance.id} className="my-2 rounded border border-border p-2">
            <MediaPicker
              label={`外観 ${index + 1} の画像`}
              kinds={["image"]}
              selectedAssetId={appearance.assetId}
              onSelect={(assetId) => updateAppearance(appearance.id, { assetId })}
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-1.5">
                名前
                <input
                  value={appearance.label}
                  placeholder="例: 夏服"
                  className={textFieldClass}
                  onChange={(event) => updateAppearance(appearance.id, { label: event.target.value })}
                />
              </label>
              <label className="inline-flex items-center gap-1.5">
                表情
                <input
                  value={appearance.expression}
                  placeholder={DEFAULT_APPEARANCE_EXPRESSION}
                  className={textFieldClass}
                  onChange={(event) =>
                    updateAppearance(appearance.id, { expression: event.target.value })
                  }
                />
              </label>
              <label className="inline-flex items-center gap-1.5">
                ポーズ
                <input
                  value={appearance.pose}
                  placeholder={DEFAULT_APPEARANCE_POSE}
                  className={textFieldClass}
                  onChange={(event) => updateAppearance(appearance.id, { pose: event.target.value })}
                />
              </label>
              <button
                type="button"
                className={buttonDangerClass}
                onClick={() => removeAppearance(appearance.id)}
              >
                外観を削除
              </button>
            </div>
          </div>
        ))}
        <button type="button" className={buttonNeutralClass} onClick={addAppearance}>
          外観を追加
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonPrimaryClass}
          disabled={mutation.isPending}
          onClick={save}
        >
          {entry === undefined ? "追加" : "保存"}
        </button>
        {entry !== undefined && <span className={metaTextClass}>{entry.id}</span>}
      </div>
      {issue !== null && <p className={errorTextClass}>{issue}</p>}
      {mutation.isError && <p className={errorTextClass}>{errorMessage(mutation.error)}</p>}
      {remove.isError && <p className={errorTextClass}>{errorMessage(remove.error)}</p>}
    </section>
  );
}

export function CharacterLibraryPage() {
  const characters = useCharacters();
  const voiceProfiles = useVoiceProfiles();
  const profiles = voiceProfiles.data ?? [];

  return (
    <section>
      <h1 className="my-3 text-2xl font-bold">キャラクターライブラリ</h1>
      <p className={metaTextClass}>
        作品をまたいで使うキャラクターを登録します。台本には「ライブラリから追加」でコピーされ、作品ごとに名前や声を調整できます。外観は「夏服」「冬服」のように複数登録できます。
      </p>

      {characters.isLoading && <p>読み込み中…</p>}
      {characters.isError && <p className={errorTextClass}>{errorMessage(characters.error)}</p>}
      {voiceProfiles.isLoading && <p className={metaTextClass}>声プロファイルを読み込み中…</p>}
      {voiceProfiles.isError && (
        <p className={errorTextClass}>{errorMessage(voiceProfiles.error)}</p>
      )}
      {characters.data !== undefined && characters.data.length === 0 && (
        <p className={metaTextClass}>キャラクターがありません。下のフォームから追加してください。</p>
      )}

      {characters.data?.map((entry) => (
        <CharacterForm key={entry.id} entry={entry} voiceProfiles={profiles} />
      ))}

      <CharacterForm voiceProfiles={profiles} />
    </section>
  );
}
