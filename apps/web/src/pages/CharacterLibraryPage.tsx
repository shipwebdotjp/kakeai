import { useEffect, useState } from "react";
import { SUPPORTED_LOCALES } from "@kakeai/contracts";
import type { CharacterLibraryEntry, CharacterVoice, VoiceProfile } from "@kakeai/contracts";
import {
  useCharacters,
  useCreateCharacter,
  useDeleteCharacter,
  useFaceSets,
  useUpdateCharacter,
  useVoiceProfiles,
} from "../api/hooks";
import { createEmptyAppearance, DEFAULT_APPEARANCE_EXPRESSION, DEFAULT_APPEARANCE_POSE, type AppearanceFormValue } from "../content/form";
import { errorMessage } from "../lib/errorMessage";
import { AppearanceFields } from "../components/AppearanceFields";
import {
  buttonDangerClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

type AppearanceDraft = AppearanceFormValue;

interface CharacterDraft {
  name: string;
  voices: CharacterVoice[];
  appearances: AppearanceDraft[];
}

function toDraft(entry: CharacterLibraryEntry): CharacterDraft {
  return {
    name: entry.name,
    voices: entry.voices.map((voice) => ({ ...voice })),
    appearances: entry.appearances.map((appearance) => ({
      id: appearance.id,
      assetId: appearance.assetId,
      expression: appearance.expression,
      pose: appearance.pose,
      label: appearance.label ?? "",
      faceSetId: appearance.faceSetId,
    })),
  };
}

function emptyDraft(): CharacterDraft {
  return { name: "", voices: [], appearances: [] };
}

interface CharacterFormProps {
  entry?: CharacterLibraryEntry;
  voiceProfiles: VoiceProfile[];
  faceSets: { id: string; name: string }[];
}

function CharacterForm({ entry, voiceProfiles, faceSets }: CharacterFormProps) {
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

  const addVoice = () => {
    setDraft((current) => {
      if (current.voices.length >= SUPPORTED_LOCALES.length) {
        return current;
      }
      const used = new Set(current.voices.map((voice) => voice.locale));
      const next = SUPPORTED_LOCALES.find((locale) => !used.has(locale));
      if (next === undefined) {
        return current;
      }
      return {
        ...current,
        voices: [...current.voices, { locale: next, voiceProfileId: "" }],
      };
    });
  };

  const updateVoice = (index: number, patch: Partial<CharacterVoice>) => {
    setDraft((current) => ({
      ...current,
      voices: current.voices.map((voice, voiceIndex) =>
        voiceIndex === index ? { ...voice, ...patch } : voice,
      ),
    }));
  };

  const removeVoice = (index: number) => {
    setDraft((current) => ({
      ...current,
      voices: current.voices.filter((_, voiceIndex) => voiceIndex !== index),
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
    const incompleteVoice = draft.voices.findIndex(
      (voice) => voice.voiceProfileId.length === 0,
    );
    if (incompleteVoice !== -1) {
      setIssue(`声 ${incompleteVoice + 1} の声プロファイルを選んでください。`);
      return;
    }
    const seenLocales = new Set<string>();
    const duplicateVoice = draft.voices.some((voice) => {
      if (seenLocales.has(voice.locale)) {
        return true;
      }
      seenLocales.add(voice.locale);
      return false;
    });
    if (duplicateVoice) {
      setIssue("同じ言語の声が重複しています。");
      return;
    }
    setIssue(null);
    const voices = draft.voices.map((voice) => ({
      locale: voice.locale,
      voiceProfileId: voice.voiceProfileId,
    }));
    const appearances = draft.appearances.map((appearance) => ({
      id: appearance.id,
      assetId: appearance.assetId ?? "",
      expression: appearance.expression.trim() || DEFAULT_APPEARANCE_EXPRESSION,
      pose: appearance.pose.trim() || DEFAULT_APPEARANCE_POSE,
      ...(appearance.label.trim().length === 0 ? {} : { label: appearance.label.trim() }),
      faceSetId: appearance.faceSetId,
    }));
    const payload = {
      name,
      voices,
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

      <div className="mt-2">
        <p className={metaTextClass}>言語別の声</p>
        {draft.voices.map((voice, index) => (
          <div key={`voice-${index}`} className="mt-1 flex flex-wrap items-center gap-1.5">
            <select
              className={textFieldClass}
              value={voice.locale}
              onChange={(event) => {
                const next = event.target.value as CharacterVoice["locale"];
                updateVoice(
                  index,
                  next === voice.locale ? { locale: next } : { locale: next, voiceProfileId: "" },
                );
              }}
            >
              {SUPPORTED_LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {locale}
                </option>
              ))}
            </select>
            <select
              className={textFieldClass}
              value={voice.voiceProfileId}
              onChange={(event) => updateVoice(index, { voiceProfileId: event.target.value })}
            >
              <option value="">選択してください</option>
              {voiceProfiles
                .filter((profile) => profile.locale === voice.locale)
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name || profile.id}（{profile.locale}）
                  </option>
                ))}
            </select>
            <button
              type="button"
              className={buttonDangerClass}
              onClick={() => removeVoice(index)}
            >
              削除
            </button>
          </div>
        ))}
        <button type="button" className={buttonPrimaryClass} onClick={addVoice}>
          声を追加
        </button>
      </div>

      <AppearanceFields
        appearances={draft.appearances}
        onAdd={addAppearance}
        onPatch={updateAppearance}
        onRemove={removeAppearance}
        faceSets={faceSets}
      />

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
  const faceSets = useFaceSets();
  const profiles = voiceProfiles.data ?? [];
  const sets = faceSets.data ?? [];

  return (
    <section>
      <h1 className="my-3 text-2xl font-bold">キャラクターライブラリ</h1>
      <p className={metaTextClass}>
        作品をまたいで使うキャラクターを登録します。台本には「ライブラリから追加」でコピーされ、作品ごとに名前・声・外観を調整できます。外観は「夏服」「冬服」のように複数登録できます。
      </p>

      {characters.isLoading && <p>読み込み中…</p>}
      {characters.isError && <p className={errorTextClass}>{errorMessage(characters.error)}</p>}
      {voiceProfiles.isLoading && <p className={metaTextClass}>声プロファイルを読み込み中…</p>}
      {voiceProfiles.isError && (
        <p className={errorTextClass}>{errorMessage(voiceProfiles.error)}</p>
      )}
      {faceSets.isError && (
        <p className={errorTextClass}>{errorMessage(faceSets.error)}</p>
      )}
      {characters.data !== undefined && characters.data.length === 0 && (
        <p className={metaTextClass}>キャラクターがありません。下のフォームから追加してください。</p>
      )}

      {characters.data?.map((entry) => (
        <CharacterForm key={entry.id} entry={entry} voiceProfiles={profiles} faceSets={sets} />
      ))}

      <CharacterForm voiceProfiles={profiles} faceSets={sets} />
    </section>
  );
}
