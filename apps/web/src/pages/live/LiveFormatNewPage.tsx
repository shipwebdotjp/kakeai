import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { LiveProgramCast, VisualThemeRef } from "@kakeai/contracts";
import {
  useCharacters,
  useCreateLiveFormat,
  useThemes,
  useVoiceProfiles,
} from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import {
  CHARACTER_LIBRARY_ROUTE_PATH,
  THEMES_ROUTE_PATH,
  VOICE_PROFILES_ROUTE_PATH,
  liveFormatRoute,
  liveFormatsRoute,
} from "../../lib/routes";
import { createDefaultLiveFormatDocument } from "../../live/model/format";
import {
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../../ui";
import { CastFields, ThemeFields, type ThemeOption } from "../../live/components/CastFields";
import { DurationField } from "../../live/components/DurationField";

export function LiveFormatNewPage() {
  const navigate = useNavigate();
  const themesQuery = useThemes();
  const charactersQuery = useCharacters();
  const voicesQuery = useVoiceProfiles();
  const createFormat = useCreateLiveFormat();

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [targetDurationMs, setTargetDurationMs] = useState(1_800_000);
  const [theme, setTheme] = useState<VisualThemeRef>({ id: "", version: 1 });
  const [cast, setCast] = useState<LiveProgramCast>({
    left: { characterId: "", voiceProfileId: "" },
    right: null,
  });

  const themes: ThemeOption[] = useMemo(
    () =>
      themesQuery.data
        ?.filter((entry) => entry.latestRevision !== null && entry.archivedAt === null)
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          version: entry.latestRevision?.version ?? 1,
        })) ?? [],
    [themesQuery.data],
  );

  useEffect(() => {
    if (theme.id === "" && themes[0] !== undefined) {
      setTheme({ id: themes[0].id, version: themes[0].version });
    }
  }, [theme.id, themes]);

  useEffect(() => {
    const character = charactersQuery.data?.[0];
    const voice = voicesQuery.data?.[0];
    if (cast.left.characterId === "" && character !== undefined) {
      setCast((current) => ({
        ...current,
        left: {
          characterId: character.id,
          voiceProfileId:
            character.voices.find((entry) => entry.locale === "ja-JP")?.voiceProfileId ??
            voice?.id ??
            "",
        },
      }));
    }
  }, [cast.left.characterId, charactersQuery.data, voicesQuery.data]);

  useEffect(() => {
    const fallbackVoice = voicesQuery.data?.[0]?.id;
    if (
      cast.left.characterId !== "" &&
      cast.left.voiceProfileId === "" &&
      fallbackVoice !== undefined
    ) {
      setCast((current) => ({
        ...current,
        left: { ...current.left, voiceProfileId: fallbackVoice },
      }));
    }
  }, [cast.left.characterId, cast.left.voiceProfileId, voicesQuery.data]);

  const canCreate =
    name.trim() !== "" &&
    theme.id !== "" &&
    theme.version > 0 &&
    cast.left.characterId !== "" &&
    cast.left.voiceProfileId !== "";

  const create = () => {
    if (!canCreate) {
      return;
    }
    const document = createDefaultLiveFormatDocument({
      name: name.trim(),
      title: title.trim() === "" ? name.trim() : title.trim(),
      targetDurationMs,
      theme,
      cast,
    });
    createFormat.mutate(
      { document },
      {
        onSuccess: (created) => navigate(liveFormatRoute(created.id)),
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link to={liveFormatsRoute()} className="text-sm text-brand-700 hover:underline">
          ← ライブフォーマット一覧
        </Link>
        <h1 className="mt-1 text-2xl font-bold">新しいライブフォーマット</h1>
        <p className={metaTextClass}>
          最初のスパインと汎用Cueを含む雛形を作成します。作成後にセグメント・カード・ポリシーを編集できます。
        </p>
      </div>

      {themesQuery.isLoading && <p>テーマを読み込み中…</p>}
      {charactersQuery.isLoading && <p>キャラクターを読み込み中…</p>}
      {voicesQuery.isLoading && <p>ボイスを読み込み中…</p>}
      {themesQuery.isError && (
        <p className={errorTextClass}>{errorMessage(themesQuery.error)}</p>
      )}
      {charactersQuery.isError && (
        <p className={errorTextClass}>{errorMessage(charactersQuery.error)}</p>
      )}
      {voicesQuery.isError && (
        <p className={errorTextClass}>{errorMessage(voicesQuery.error)}</p>
      )}

      <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            フォーマット名
            <input
              className={`mt-1 w-full ${textFieldClass}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例: ニュース 30分"
              autoFocus
            />
          </label>
          <label className="block text-sm">
            既定タイトル（任意）
            <input
              className={`mt-1 w-full ${textFieldClass}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={name}
            />
          </label>
          <DurationField
            label="全体目標尺"
            valueMs={targetDurationMs}
            onCommit={setTargetDurationMs}
          />
        </div>

        <div>
          <p className="m-0 mb-1 text-sm">テーマ</p>
          <ThemeFields theme={theme} themes={themes} onChange={setTheme} />
          {themes.length === 0 && (
            <p className={metaTextClass}>
              利用できるテーマがありません。
              <Link to={THEMES_ROUTE_PATH} className="ml-1 text-brand-700 underline">
                テーマを作成
              </Link>
            </p>
          )}
        </div>

        <div>
          <p className="m-0 mb-1 text-sm">既定キャスト</p>
          <CastFields
            cast={cast}
            characters={charactersQuery.data ?? []}
            voices={voicesQuery.data ?? []}
            onChange={setCast}
          />
          <p className={metaTextClass}>
            キャラクターとボイスが必要です。
            <Link to={CHARACTER_LIBRARY_ROUTE_PATH} className="ml-1 text-brand-700 underline">
              キャラクター
            </Link>
            <Link to={VOICE_PROFILES_ROUTE_PATH} className="ml-1 text-brand-700 underline">
              ボイス
            </Link>
          </p>
        </div>

        {createFormat.isError && (
          <p className={errorTextClass}>{errorMessage(createFormat.error)}</p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={!canCreate || createFormat.isPending}
            onClick={create}
          >
            {createFormat.isPending ? "作成中…" : "フォーマットを作成"}
          </button>
        </div>
      </div>
    </div>
  );
}
