import { useEffect, useState } from "react";
import {
  DEFAULT_VOICE_ADAPTER_ID,
  voiceAdapterIdSchema,
  type TtsVoice,
  type VoiceAdapterId,
  type VoiceProfile,
} from "@kakeai/contracts";
import {
  useAdapterVoices,
  useCreateVoiceProfile,
  useDeleteVoiceProfile,
  useUpdateVoiceProfile,
  useVoiceProfiles,
} from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { VOICE_ADAPTER_LABELS, adapterLabel } from "../lib/voiceAdapters";
import {
  buttonDangerClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

const ADAPTER_IDS = voiceAdapterIdSchema.options;

function findVoice(voices: TtsVoice[], voiceId: string): TtsVoice | undefined {
  return voices.find((voice) => voice.voiceId === voiceId);
}

interface ProfileFormProps {
  profile?: VoiceProfile;
}

function ProfileForm({ profile }: ProfileFormProps) {
  const create = useCreateVoiceProfile();
  const update = useUpdateVoiceProfile();
  const remove = useDeleteVoiceProfile();
  const [adapterId, setAdapterId] = useState<VoiceAdapterId>(
    profile?.adapterId ?? DEFAULT_VOICE_ADAPTER_ID,
  );
  const [name, setName] = useState(profile?.name ?? "");
  const [voiceId, setVoiceId] = useState(profile?.settings.speakerUuid ?? "");
  const [styleId, setStyleId] = useState<number | null>(profile?.settings.defaultStyleId ?? null);

  const activeAdapterId = profile?.adapterId ?? adapterId;
  const voicesQuery = useAdapterVoices(activeAdapterId);
  const voices = voicesQuery.data?.voices ?? [];
  const adapterName = adapterLabel(activeAdapterId);

  useEffect(() => {
    if (profile !== undefined) {
      return;
    }
    setVoiceId("");
    setStyleId(null);
  }, [adapterId, profile]);

  useEffect(() => {
    if (profile === undefined && voiceId.length === 0 && voices.length > 0) {
      const first = voices[0]!;
      setVoiceId(first.voiceId);
      setStyleId(first.styles[0]?.styleId ?? null);
    }
  }, [profile, voiceId, voices]);

  useEffect(() => {
    if (profile === undefined) {
      return;
    }
    setName(profile.name);
    setVoiceId(profile.settings.speakerUuid);
    setStyleId(profile.settings.defaultStyleId);
  }, [profile?.id, profile?.updatedAt]);

  const voice = findVoice(voices, voiceId);
  const styles = voice?.styles ?? [];
  const staleVoice = voiceId.length > 0 && voices.length > 0 && voice === undefined;
  const staleStyle =
    styleId !== null && voice !== undefined && !styles.some((style) => style.styleId === styleId);
  const mutation = profile === undefined ? create : update;
  const pending = mutation.isPending;

  const save = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || voiceId.length === 0 || styleId === null) {
      return;
    }
    const settings = { speakerUuid: voiceId, defaultStyleId: styleId };
    if (profile === undefined) {
      create.mutate(
        { name: trimmed, adapterId, settings },
        { onSuccess: () => setName("") },
      );
    } else {
      update.mutate({ id: profile.id, input: { name: trimmed, settings } });
    }
  };

  const onVoiceChange = (nextVoiceId: string) => {
    setVoiceId(nextVoiceId);
    const next = findVoice(voices, nextVoiceId);
    setStyleId(next?.styles[0]?.styleId ?? null);
  };

  return (
    <section className="my-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          placeholder="プロファイル名（例: ナレーター）"
          className={`min-w-[200px] flex-1 ${textFieldClass}`}
          onChange={(event) => setName(event.target.value)}
        />
        {profile !== undefined && (
          <button
            type="button"
            className={buttonDangerClass}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`「${profile.name || profile.id}」を削除しますか？`)) {
                remove.mutate(profile.id);
              }
            }}
          >
            削除
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5">
          ENGINE
          {profile === undefined ? (
            <select
              className={textFieldClass}
              value={adapterId}
              onChange={(event) => {
                const parsed = voiceAdapterIdSchema.safeParse(event.target.value);
                if (parsed.success) {
                  setAdapterId(parsed.data);
                }
              }}
            >
              {ADAPTER_IDS.map((id) => (
                <option key={id} value={id}>
                  {VOICE_ADAPTER_LABELS[id]}
                </option>
              ))}
            </select>
          ) : (
            <span className={metaTextClass}>{adapterName}</span>
          )}
        </label>
        <label className="inline-flex items-center gap-1.5">
          話者
          <select
            className={textFieldClass}
            value={voiceId}
            disabled={voices.length === 0}
            onChange={(event) => onVoiceChange(event.target.value)}
          >
            <option value="">選択してください</option>
            {voices.map((entry) => (
              <option key={entry.voiceId} value={entry.voiceId}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5">
          既定スタイル
          <select
            className={textFieldClass}
            value={styleId ?? ""}
            disabled={styles.length === 0 && styleId === null}
            onChange={(event) => {
              if (event.target.value === "") {
                setStyleId(null);
                return;
              }
              const next = Number(event.target.value);
              setStyleId(Number.isInteger(next) ? next : null);
            }}
          >
            <option value="">未設定</option>
            {styles.map((style) => (
              <option key={style.styleId} value={style.styleId}>
                {style.name}
              </option>
            ))}
            {styleId !== null && !styles.some((style) => style.styleId === styleId) && (
              <option value={styleId}>現在の設定（{styleId}）</option>
            )}
          </select>
        </label>
        <button
          type="button"
          className={buttonPrimaryClass}
          disabled={pending || voices.length === 0}
          onClick={save}
        >
          {profile === undefined ? "追加" : "保存"}
        </button>
      </div>
      {profile !== undefined && <p className={metaTextClass}>{profile.id}</p>}
      {voicesQuery.isError && (
        <p className={errorTextClass}>
          {adapterName} ENGINE に接続できません。起動しているか確認してください。
        </p>
      )}
      {voicesQuery.isLoading && (
        <p className={metaTextClass}>{adapterName} ENGINE から話者一覧を読み込み中…</p>
      )}
      {voicesQuery.isSuccess && voices.length === 0 && (
        <p className={errorTextClass}>
          {adapterName} ENGINE に利用できる話者がありません。音声モデルを確認してください。
        </p>
      )}
      {staleVoice && (
        <p className={errorTextClass}>
          保存された話者が現在の {adapterName} ENGINE に見つかりません。話者を選び直してください。
        </p>
      )}
      {staleStyle && (
        <p className={errorTextClass}>
          保存されたスタイルが現在の {adapterName} ENGINE に見つかりません。スタイルを選び直してください。
        </p>
      )}
      {mutation.isError && <p className={errorTextClass}>{errorMessage(mutation.error)}</p>}
      {remove.isError && <p className={errorTextClass}>{errorMessage(remove.error)}</p>}
    </section>
  );
}

export function VoiceProfilesPage() {
  const profiles = useVoiceProfiles();

  return (
    <section>
      <h1 className="my-3 text-2xl font-bold">音声プロファイル</h1>
      <p className={metaTextClass}>
        別途起動した <strong>VOICEVOX ENGINE</strong> または <strong>AivisSpeech Engine</strong>
        に接続し、台本の話者へ割り当てる声（話者と既定スタイル）を登録します。
        <a
          href="https://voicevox.hiroshiba.jp/term/"
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 hover:underline dark:text-brand-400"
        >
          VOICEVOX 利用規約
        </a>
        と、使用する各音声モデルの規約を確認してください。
      </p>

      {profiles.isLoading && <p>読み込み中…</p>}
      {profiles.isError && <p className={errorTextClass}>{errorMessage(profiles.error)}</p>}

      {profiles.data?.map((profile) => (
        <ProfileForm key={profile.id} profile={profile} />
      ))}
      {profiles.data !== undefined && profiles.data.length === 0 && (
        <p className={metaTextClass}>プロファイルがありません。下のフォームから追加してください。</p>
      )}

      <ProfileForm />
    </section>
  );
}
