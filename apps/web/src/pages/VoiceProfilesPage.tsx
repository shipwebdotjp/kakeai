import { useEffect, useState } from "react";
import {
  DEFAULT_VOICE_ADAPTER_ID,
  localeSchema,
  voiceAdapterDescriptors,
  voiceAdapterIdSchema,
  type TtsVoice,
  type VoiceAdapterId,
  type VoiceAdapterSummary,
  type VoiceProfile,
} from "@kakeai/contracts";
import {
  useAdapterVoices,
  useCreateVoiceProfile,
  useDeleteVoiceProfile,
  useUpdateVoiceProfile,
  useVoiceAdapters,
  useVoiceProfiles,
} from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { adapterLabel, voiceLocale } from "../lib/voiceAdapters";
import {
  buttonDangerClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

function findVoice(voices: TtsVoice[], voiceId: string): TtsVoice | undefined {
  return voices.find((voice) => voice.voiceId === voiceId);
}

interface ProfileFormProps {
  profile?: VoiceProfile;
  adapters: VoiceAdapterSummary[];
}

function ProfileForm({ profile, adapters }: ProfileFormProps) {
  const create = useCreateVoiceProfile();
  const update = useUpdateVoiceProfile();
  const remove = useDeleteVoiceProfile();
  const [adapterId, setAdapterId] = useState<VoiceAdapterId>(
    profile?.adapterId ?? DEFAULT_VOICE_ADAPTER_ID,
  );
  const [name, setName] = useState(profile?.name ?? "");
  const [voiceId, setVoiceId] = useState(profile?.voiceId ?? "");

  const activeAdapterId = profile?.adapterId ?? adapterId;
  const voicesQuery = useAdapterVoices(activeAdapterId);
  const voices = voicesQuery.data?.voices ?? [];
  const adapterName = adapterLabel(activeAdapterId, adapters);

  useEffect(() => {
    if (profile !== undefined) {
      return;
    }
    setVoiceId("");
  }, [adapterId, profile]);

  useEffect(() => {
    if (profile === undefined && voiceId.length === 0 && voices.length > 0) {
      const first = voices[0]!;
      setVoiceId(first.voiceId);
    }
  }, [profile, voiceId, voices]);

  useEffect(() => {
    if (profile === undefined) {
      return;
    }
    setName(profile.name);
    setVoiceId(profile.voiceId);
  }, [profile?.id, profile?.updatedAt]);

  const voice = findVoice(voices, voiceId);
  const voicesLoaded = voicesQuery.isSuccess;
  const declaredLocale =
    voice === undefined ? profile?.locale : voiceLocale(voice, activeAdapterId);
  const locale = localeSchema.safeParse(declaredLocale).data ?? "";
  const staleVoice = voicesLoaded && voiceId.length > 0 && voice === undefined;
  const mutation = profile === undefined ? create : update;
  const pending = mutation.isPending;
  const voiceUnchanged = profile !== undefined && voiceId === profile.voiceId;
  const saveBlocked =
    pending ||
    locale === "" ||
    (voicesLoaded && staleVoice) ||
    (!voicesLoaded && !voiceUnchanged);

  const save = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || voiceId.length === 0 || saveBlocked) {
      return;
    }
    if (profile === undefined) {
      create.mutate(
        { name: trimmed, adapterId, voiceId, locale, settings: {} },
        { onSuccess: () => setName("") },
      );
    } else {
      update.mutate({ id: profile.id, input: { name: trimmed, voiceId, locale, settings: {} } });
    }
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
              {adapters.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          ) : (
            <span className={metaTextClass}>{adapterName}</span>
          )}
        </label>
        <label className="inline-flex items-center gap-1.5">
          声
          <select
            className={textFieldClass}
            value={voiceId}
            disabled={voices.length === 0}
            onChange={(event) => setVoiceId(event.target.value)}
          >
            <option value="">選択してください</option>
            {voices.map((entry) => (
              <option key={entry.voiceId} value={entry.voiceId}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <span className={metaTextClass}>
          言語: {locale.length > 0 ? locale : "未確定（声を選んでください）"}
        </span>
        <button
          type="button"
          className={buttonPrimaryClass}
          disabled={saveBlocked}
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
        <p className={metaTextClass}>{adapterName} ENGINE から声の一覧を読み込み中…</p>
      )}
      {voicesQuery.isSuccess && voices.length === 0 && (
        <p className={errorTextClass}>
          {adapterName} ENGINE に利用できる声がありません。音声モデルを確認してください。
        </p>
      )}
      {staleVoice && (
        <p className={errorTextClass}>
          保存された声が現在の {adapterName} ENGINE に見つかりません。声を選び直してください。
        </p>
      )}
      {mutation.isError && <p className={errorTextClass}>{errorMessage(mutation.error)}</p>}
      {remove.isError && <p className={errorTextClass}>{errorMessage(remove.error)}</p>}
    </section>
  );
}

export function VoiceProfilesPage() {
  const profiles = useVoiceProfiles();
  const adapters = useVoiceAdapters();
  const adapterOptions =
    adapters.data?.adapters ??
    voiceAdapterDescriptors.map((descriptor) => ({ id: descriptor.id, label: descriptor.label }));

  return (
    <section>
      <h1 className="my-3 text-2xl font-bold">音声プロファイル</h1>
      <p className={metaTextClass}>
        別途起動したローカルTTSエンジンに接続し、台本の話者へ割り当てる声を登録します。
        声には言語（locale）が付き、キャラクターの言語別割り当てに使います。
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
        <ProfileForm key={profile.id} profile={profile} adapters={adapterOptions} />
      ))}
      {profiles.data !== undefined && profiles.data.length === 0 && (
        <p className={metaTextClass}>プロファイルがありません。下のフォームから追加してください。</p>
      )}

      <ProfileForm adapters={adapterOptions} />
    </section>
  );
}
