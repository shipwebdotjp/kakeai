import { useEffect, useId, useState } from "react";
import {
  DEFAULT_VOICE_ADAPTER_ID,
  OPENAI_TTS_MAX_TOKENS_MAX,
  OPENAI_TTS_REF_TEXT_MAX_LENGTH,
  QWEN3_TTS_LANG_CODES,
  SUPPORTED_LOCALES,
  defaultOpenAiMaxTokens,
  localeSchema,
  voiceAdapterDescriptors,
  voiceAdapterIdSchema,
  type TtsVoice,
  type VoiceAdapterId,
  type VoiceAdapterSummary,
  type VoiceProfile,
  type VoiceProfileExtras,
} from "@kakeai/contracts";
import {
  useAdapterVoices,
  useCreateVoiceProfile,
  useDeleteVoiceProfile,
  useUpdateVoiceProfile,
  useVoiceAdapters,
  useVoiceModels,
  useVoiceProfiles,
} from "../api/hooks";
import { useAssets, useUploadAssets } from "../api/hooks/assets";
import { errorMessage } from "../lib/errorMessage";
import { adapterLabel } from "../lib/voiceAdapters";
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

function profileModel(profile: VoiceProfile | undefined): string {
  if (profile === undefined) {
    return "";
  }
  const settings = profile.settings as { model?: unknown };
  return typeof settings.model === "string" ? settings.model : "";
}

function profileExtrasField(profile: VoiceProfile | undefined, key: string): string {
  if (profile === undefined) {
    return "";
  }
  const settings = profile.settings as Record<string, unknown>;
  const value = settings[key];
  return typeof value === "string" ? value : "";
}

function profileMaxTokens(profile: VoiceProfile | undefined): string {
  if (profile === undefined) {
    return String(defaultOpenAiMaxTokens());
  }
  const settings = profile.settings as { maxTokens?: unknown };
  return typeof settings.maxTokens === "number" && Number.isSafeInteger(settings.maxTokens)
    ? String(settings.maxTokens)
    : String(defaultOpenAiMaxTokens());
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
  const [model, setModel] = useState(profileModel(profile));
  const [debouncedModel, setDebouncedModel] = useState(profileModel(profile));
  const [locale, setLocale] = useState<string>(profile?.locale ?? SUPPORTED_LOCALES[0]);
  const [refAudioAssetId, setRefAudioAssetId] = useState(() =>
    profileExtrasField(profile, "refAudioAssetId"),
  );
  const [refText, setRefText] = useState(() => profileExtrasField(profile, "refText"));
  const [langCode, setLangCode] = useState(
    () => profileExtrasField(profile, "langCode") || QWEN3_TTS_LANG_CODES[0],
  );
  const [maxTokens, setMaxTokens] = useState(() => profileMaxTokens(profile));

  const activeAdapterId = profile?.adapterId ?? adapterId;
  const descriptor = adapters.find((entry) => entry.id === activeAdapterId);
  const modelSelection = descriptor?.modelSelection ?? false;
  const manualVoice = descriptor?.voiceSelection === "list-or-manual";
  const adapterName = adapterLabel(activeAdapterId, adapters);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedModel(model), 400);
    return () => clearTimeout(timer);
  }, [model]);

  const modelsQuery = useVoiceModels(modelSelection ? activeAdapterId : undefined);
  const voicesQuery = useAdapterVoices(activeAdapterId, modelSelection ? debouncedModel : undefined);
  const voices = voicesQuery.data?.voices ?? [];
  const models = modelsQuery.data?.models ?? [];

  useEffect(() => {
    if (profile !== undefined) {
      return;
    }
    setVoiceId("");
    setModel("");
    setDebouncedModel("");
    setRefAudioAssetId("");
    setRefText("");
    setLangCode(QWEN3_TTS_LANG_CODES[0]);
    setMaxTokens(String(defaultOpenAiMaxTokens()));
  }, [adapterId, profile]);

  useEffect(() => {
    if (profile !== undefined || manualVoice || voiceId.length > 0 || voices.length === 0) {
      return;
    }
    setVoiceId(voices[0]!.voiceId);
  }, [profile, manualVoice, voiceId, voices]);

  useEffect(() => {
    if (profile === undefined) {
      return;
    }
    setName(profile.name);
    setVoiceId(profile.voiceId);
    setModel(profileModel(profile));
    setDebouncedModel(profileModel(profile));
    setLocale(profile.locale);
    setRefAudioAssetId(profileExtrasField(profile, "refAudioAssetId"));
    setRefText(profileExtrasField(profile, "refText"));
    setLangCode(profileExtrasField(profile, "langCode") || QWEN3_TTS_LANG_CODES[0]);
    setMaxTokens(profileMaxTokens(profile));
  }, [profile?.id, profile?.updatedAt]);

  const assetsQuery = useAssets({ enabled: modelSelection });
  const uploadAssets = useUploadAssets();
  const readyAudioAssets = (assetsQuery.data ?? []).filter(
    (asset) => asset.kind === "audio" && asset.status === "ready",
  );

  const voice = findVoice(voices, voiceId);
  const voicesLoaded = voicesQuery.isSuccess;
  const declaredLocale =
    voice?.locale ?? descriptor?.defaultLocale ?? (locale.length > 0 ? locale : undefined);
  const effectiveLocale = localeSchema.safeParse(declaredLocale).data ?? "";
  const localeLocked = descriptor?.defaultLocale !== null && descriptor?.defaultLocale !== undefined;
  const staleVoice = !manualVoice && voicesLoaded && voiceId.length > 0 && voice === undefined;
  const mutation = profile === undefined ? create : update;
  const pending = mutation.isPending;
  const voiceUnchanged = profile !== undefined && voiceId === profile.voiceId;
  const modelMissing = modelSelection && model.trim().length === 0;
  const modelPending = modelSelection && model.trim() !== debouncedModel.trim();
  const iclMode = modelSelection && refAudioAssetId.trim().length > 0;
  const iclIncomplete =
    iclMode && (refText.trim().length === 0 || langCode.trim().length === 0);
  const maxTokensParsed = /^\d+$/.test(maxTokens.trim())
    ? Number.parseInt(maxTokens.trim(), 10)
    : Number.NaN;
  const maxTokensInvalid =
    iclMode &&
    (!Number.isSafeInteger(maxTokensParsed) ||
      maxTokensParsed < 1 ||
      maxTokensParsed > OPENAI_TTS_MAX_TOKENS_MAX);
  const refAudioPending =
    iclMode &&
    assetsQuery.isSuccess &&
    !readyAudioAssets.some((asset) => asset.id === refAudioAssetId.trim());
  const saveBlocked =
    pending ||
    effectiveLocale === "" ||
    modelMissing ||
    modelPending ||
    iclIncomplete ||
    maxTokensInvalid ||
    refAudioPending ||
    (voicesLoaded && staleVoice) ||
    (!manualVoice && !voicesLoaded && !voiceUnchanged);

  const save = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || voiceId.trim().length === 0 || saveBlocked) {
      return;
    }
    let settings: VoiceProfileExtras = modelSelection ? { model: model.trim() } : {};
    if (modelSelection) {
      const refId = refAudioAssetId.trim();
      if (refId.length > 0) {
        settings = {
          model: model.trim(),
          refAudioAssetId: refId,
          refText: refText.trim(),
          langCode: langCode.trim(),
          maxTokens: maxTokensParsed,
        };
      } else {
        settings = { model: model.trim() };
      }
    }
    const trimmedVoiceId = voiceId.trim();
    if (profile === undefined) {
      create.mutate(
        {
          name: trimmed,
          adapterId,
          voiceId: trimmedVoiceId,
          locale: effectiveLocale,
          settings,
        },
        { onSuccess: () => setName("") },
      );
    } else {
      update.mutate({
        id: profile.id,
        input: { name: trimmed, voiceId: trimmedVoiceId, locale: effectiveLocale, settings },
      });
    }
  };

  const instanceId = useId();
  const voiceDatalistId = `voice-options-${activeAdapterId}-${instanceId}`;
  const modelDatalistId = `model-options-${activeAdapterId}-${instanceId}`;

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
        {modelSelection && (
          <label className="inline-flex items-center gap-1.5">
            モデル
            <input
              value={model}
              list={modelDatalistId}
              placeholder="例: kokoro"
              className={textFieldClass}
              onChange={(event) => setModel(event.target.value)}
            />
            <datalist id={modelDatalistId}>
              {models.map((entry) => (
                <option key={entry} value={entry} />
              ))}
            </datalist>
          </label>
        )}
        <label className="inline-flex items-center gap-1.5">
          声
          {manualVoice ? (
            <>
              <input
                value={voiceId}
                list={voiceDatalistId}
                placeholder="例: af_heart"
                className={textFieldClass}
                onChange={(event) => setVoiceId(event.target.value)}
              />
              <datalist id={voiceDatalistId}>
                {voices.map((entry) => (
                  <option key={entry.voiceId} value={entry.voiceId}>
                    {entry.name}
                  </option>
                ))}
              </datalist>
            </>
          ) : (
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
          )}
        </label>
        {modelSelection && (
          <fieldset className="mt-2 w-full rounded border border-border p-2">
            <legend className={metaTextClass}>参照音声（ICLクローン・任意）</legend>
            <p className={metaTextClass}>
              音声素材を取り込んで指定すると、エンジンへ参照音声・参照テキスト・言語コード・最大トークンを送ります。このとき声IDは送信されません。
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-1.5">
                参照音声
                <select
                  className={textFieldClass}
                  value={refAudioAssetId}
                  disabled={assetsQuery.isLoading}
                  onChange={(event) => setRefAudioAssetId(event.target.value)}
                >
                  <option value="">使用しない</option>
                  {readyAudioAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.originalFilename}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5">
                取り込み
                <input
                  type="file"
                  accept="audio/wav,audio/x-wav,.wav"
                  disabled={uploadAssets.isPending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file === undefined) {
                      return;
                    }
                    uploadAssets.mutate([file], {
                      onSuccess: (result) => {
                        const first = result.uploaded[0];
                        if (first !== undefined) {
                          setRefAudioAssetId(first.id);
                        }
                      },
                    });
                    event.target.value = "";
                  }}
                />
              </label>
              {uploadAssets.isPending && <span className={metaTextClass}>取り込み中…</span>}
              <label className="inline-flex items-center gap-1.5">
                言語コード
                <select
                  className={textFieldClass}
                  value={langCode}
                  onChange={(event) => setLangCode(event.target.value)}
                >
                  {QWEN3_TTS_LANG_CODES.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5">
                最大トークン
                <input
                  value={maxTokens}
                  inputMode="numeric"
                  placeholder={String(defaultOpenAiMaxTokens())}
                  className={textFieldClass}
                  onChange={(event) => setMaxTokens(event.target.value)}
                />
              </label>
            </div>
            <label className="mt-1 block">
              <span className={metaTextClass}>参照テキスト（参照音声の書き起こし・必須）</span>
              <textarea
                value={refText}
                rows={2}
                maxLength={OPENAI_TTS_REF_TEXT_MAX_LENGTH}
                className={`mt-1 w-full ${textFieldClass}`}
                onChange={(event) => setRefText(event.target.value)}
              />
            </label>
            {assetsQuery.isError && (
              <p className={errorTextClass}>素材一覧を取得できません。</p>
            )}
            {uploadAssets.isError && (
              <p className={errorTextClass}>{errorMessage(uploadAssets.error)}</p>
            )}
            {iclMode && (
              <p className={metaTextClass}>
                参照音声モード: 声IDは送信されません（表示名としてのみ使用）。
              </p>
            )}
            {iclMode && iclIncomplete && (
              <p className={errorTextClass}>参照テキストと言語コードを入力してください。</p>
            )}
            {iclMode && maxTokensInvalid && (
              <p className={errorTextClass}>
                最大トークンは1以上{OPENAI_TTS_MAX_TOKENS_MAX}以下の整数で入力してください。
              </p>
            )}
            {iclMode && refAudioPending && (
              <p className={errorTextClass}>
                選択した参照音声はまだ利用できません。取り込みの完了を待つか、選び直してください。
              </p>
            )}
          </fieldset>
        )}
        {!localeLocked && (
          <label className="inline-flex items-center gap-1.5">
            言語
            <select
              className={textFieldClass}
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
            >
              {SUPPORTED_LOCALES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className={metaTextClass}>
          言語: {effectiveLocale.length > 0 ? effectiveLocale : "未確定"}
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
          {adapterName} に接続できません。起動しているか確認してください。
        </p>
      )}
      {voicesQuery.isLoading && (
        <p className={metaTextClass}>{adapterName} から声の一覧を読み込み中…</p>
      )}
      {!manualVoice && voicesQuery.isSuccess && voices.length === 0 && (
        <p className={errorTextClass}>
          {adapterName} に利用できる声がありません。音声モデルを確認してください。
        </p>
      )}
      {manualVoice && modelMissing && (
        <p className={metaTextClass}>利用するモデルを入力してください。</p>
      )}
      {manualVoice && !modelMissing && voices.length === 0 && (
        <p className={metaTextClass}>声の候補を取得できないため、声は直接入力してください。</p>
      )}
      {staleVoice && (
        <p className={errorTextClass}>
          保存された声が現在の {adapterName} に見つかりません。声を選び直してください。
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
  const adapterOptions: VoiceAdapterSummary[] =
    adapters.data?.adapters ??
    voiceAdapterDescriptors.map((descriptor) => ({
      id: descriptor.id,
      label: descriptor.label,
      defaultLocale: descriptor.defaultLocale,
      voiceSelection: descriptor.voiceSelection,
      modelSelection: descriptor.modelSelection,
    }));

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
