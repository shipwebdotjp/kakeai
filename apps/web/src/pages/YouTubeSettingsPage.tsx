import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  countCodePoints,
  youtubeCategorySchema,
  type YouTubeCategory,
  type YouTubeCommentMode,
  type YouTubeVideoSettingsDocument,
} from "@kakeai/contracts";
import { ApiError } from "../api/client";
import {
  useCurrentScriptVersion,
  useSaveYouTubeVideoSettings,
  useWork,
  useYouTubeChapters,
  useYouTubeVideoSettings,
} from "../api/hooks";
import { YouTubeSettingsTemplatePanel } from "../components/YouTubeSettingsTemplatePanel";
import {
  badgeInfoClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  sectionCardClass,
  sectionTitleClass,
  textFieldClass,
} from "../ui";

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "操作に失敗しました。";
}

function utcIsoToLocalDatetimeInput(utcIso: string | null): string {
  if (utcIso === null || utcIso === "") {
    return "";
  }
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function localDatetimeInputToUtcIso(localStr: string): string | null {
  if (localStr === "") {
    return null;
  }
  const date = new Date(localStr);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

const YOUTUBE_CATEGORY_LABELS: Record<YouTubeCategory, string> = {
  film_and_animation: "映画とアニメ",
  autos_and_vehicles: "自動車と乗り物",
  music: "音楽",
  pets_and_animals: "ペットと動物",
  sports: "スポーツ",
  travel_and_events: "旅行とイベント",
  gaming: "ゲーム",
  people_and_blogs: "ブログと人物",
  comedy: "コメディ",
  entertainment: "エンターテインメント",
  news_and_politics: "ニュースと政治",
  howto_and_style: "ハウツーとスタイル",
  education: "教育",
  science_and_technology: "科学と技術",
  nonprofits_and_activism: "非営利団体と活動",
};

export function YouTubeSettingsPage() {
  const { workId, editionId } = useParams<{ workId: string; editionId: string }>();
  const work = useWork(workId);
  const currentScriptVersion = useCurrentScriptVersion(editionId);
  const settingsQuery = useYouTubeVideoSettings(editionId);
  const saveSettings = useSaveYouTubeVideoSettings(editionId);
  const chaptersQuery = useYouTubeChapters(currentScriptVersion.data?.id);

  const [draft, setDraft] = useState<YouTubeVideoSettingsDocument | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tagsInput, setTagsInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [chapterInsertionWarnings, setChapterInsertionWarnings] = useState<
    { code: string; message: string }[] | null
  >(null);

  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedEdition = work.data?.languageEditions.find((e) => e.id === editionId);

  useEffect(() => {
    if (settingsQuery.data !== undefined && settingsQuery.data !== null && !dirty) {
      const doc = settingsQuery.data.document;
      setDraft(doc);
      setTagsInput(doc.tags.join(", "));
      setDirty(false);
      setSaveError(null);
    }
  }, [settingsQuery.data, dirty]);

  const updateDraft = (updater: (prev: YouTubeVideoSettingsDocument) => YouTubeVideoSettingsDocument) => {
    if (draft === null) {
      return;
    }
    const next = updater(draft);
    setDraft(next);
    setDirty(true);
    setSaveError(null);
  };

  const handleTagsChange = (raw: string) => {
    setTagsInput(raw);
    const parsedTags = raw
      .split(/[,,\n]/u)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    updateDraft((prev) => ({
      ...prev,
      tags: [...new Set(parsedTags)],
    }));
  };

  const handleInsertChapters = () => {
    if (chaptersQuery.data === undefined || chaptersQuery.data === null || draft === null) {
      return;
    }
    const { chaptersText, warnings } = chaptersQuery.data;
    setChapterInsertionWarnings(warnings.length > 0 ? warnings : null);

    const textarea = descriptionTextareaRef.current;
    const trimmedChapters = chaptersText.trim();

    if (textarea !== null) {
      const start = textarea.selectionStart ?? draft.description.length;
      const end = textarea.selectionEnd ?? draft.description.length;
      const before = draft.description.slice(0, start);
      const after = draft.description.slice(end);
      const newDesc = before + (before.length > 0 && !before.endsWith("\n") ? "\n" : "") + trimmedChapters + (after.length > 0 && !after.startsWith("\n") ? "\n" : "") + after;

      updateDraft((prev) => ({
        ...prev,
        description: newDesc,
      }));
    } else {
      const newDesc = draft.description.length > 0 ? `${draft.description}\n\n${trimmedChapters}` : trimmedChapters;
      updateDraft((prev) => ({
        ...prev,
        description: newDesc,
      }));
    }
  };

  const handleSave = () => {
    if (draft === null) {
      return;
    }
    setSaveError(null);
    saveSettings.mutate(draft, {
      onSuccess: () => {
        setDirty(false);
      },
      onError: (err) => {
        setSaveError(errorMessage(err));
      },
    });
  };

  if (settingsQuery.isLoading || work.isLoading) {
    return <p className={metaTextClass}>読み込み中…</p>;
  }

  if (settingsQuery.isError) {
    return <p className={errorTextClass}>{errorMessage(settingsQuery.error)}</p>;
  }

  if (draft === null) {
    return <p className={errorTextClass}>設定を読み込めませんでした。</p>;
  }

  const descCodePoints = countCodePoints(draft.description);
  const isMadeForKids = draft.declarations.audience === "made_for_kids";

  return (
    <div className="mx-auto max-w-4xl">
      <p className={metaTextClass}>
        <Link to={workId === undefined ? "/" : `/works/${encodeURIComponent(workId)}`}>
          作品に戻る
        </Link>
      </p>
      <h1 className="mt-2 mb-1 text-lg font-bold">
        YouTube投稿設定{work.data !== undefined ? `: ${work.data.title}` : ""}
      </h1>
      <p className={metaTextClass}>
        現在の言語版: {selectedEdition === undefined ? "読み込み中…" : selectedEdition.locale}
      </p>
      <p className={metaTextClass}>
        この言語版のYouTube投稿設定（メタデータ）を管理します。台本の編集や復元とは独立して保存されます。
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonPrimaryClass}
          disabled={!dirty || saveSettings.isPending}
          onClick={handleSave}
        >
          {saveSettings.isPending ? "保存中…" : "投稿設定を保存"}
        </button>
        {dirty && <span className={badgeInfoClass}>未保存の変更があります</span>}
        {saveError !== null && <span className={errorTextClass}>{saveError}</span>}
      </div>

      <section className={sectionCardClass}>
        <h2 className={sectionTitleClass}>基本情報</h2>

        <div className="grid gap-4">
          <label className="block text-xs">
            <span className="font-semibold">タイトル（最大100文字）</span>
            <input
              className={`${textFieldClass} mt-1 block w-full`}
              maxLength={100}
              value={draft.title}
              onChange={(e) => updateDraft((prev) => ({ ...prev, title: e.target.value }))}
            />
            <span className="mt-1 block text-right text-gray-500">
              {draft.title.length} / 100
            </span>
          </label>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">説明欄（最大5,000文字）</span>
              <button
                type="button"
                className={buttonNeutralClass}
                disabled={chaptersQuery.isLoading || chaptersQuery.data === undefined}
                onClick={handleInsertChapters}
              >
                {chaptersQuery.isLoading ? "チャプター取得中…" : "Sceneチャプターを挿入"}
              </button>
            </div>
            {chapterInsertionWarnings !== null && (
              <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                <p className="font-semibold">YouTubeチャプターの警告:</p>

                <ul className="mt-1 list-disc pl-4">
                  {chapterInsertionWarnings.map((w, index) => (
                    <li key={index}>{w.message}</li>
                  ))}
                </ul>
              </div>
            )}
            <textarea
              ref={descriptionTextareaRef}
              rows={8}
              className={`${textFieldClass} mt-1 block w-full font-mono text-sm`}
              value={draft.description}
              onChange={(e) => updateDraft((prev) => ({ ...prev, description: e.target.value }))}
            />
            <span
              className={`mt-1 block text-right text-xs ${
                descCodePoints > 5000 ? "text-red-600 font-bold" : "text-gray-500"
              }`}
            >
              {descCodePoints} / 5,000 コードポイント
            </span>
          </div>

          <label className="block text-xs">
            <span className="font-semibold">タグ（カンマ区切り、最大50個）</span>
            <input
              className={`${textFieldClass} mt-1 block w-full`}
              value={tagsInput}
              onChange={(e) => handleTagsChange(e.target.value)}
              placeholder="例: アニメ, プログラミング, 解説"
            />
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="font-semibold">カテゴリ</span>
              <select
                className={`${textFieldClass} mt-1 block w-full`}
                value={draft.category ?? ""}
                onChange={(e) =>
                  updateDraft((prev) => ({
                    ...prev,
                    category:
                      e.target.value === ""
                        ? null
                        : (youtubeCategorySchema.parse(e.target.value) as YouTubeCategory),
                  }))
                }
              >
                <option value="">（未選択）</option>
                {youtubeCategorySchema.options.map((cat) => (
                  <option key={cat} value={cat}>
                    {YOUTUBE_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs">
              <span className="font-semibold">動画の言語</span>
              <input
                className={`${textFieldClass} mt-1 block w-full`}
                value={draft.language ?? ""}
                onChange={(e) =>
                  updateDraft((prev) => ({
                    ...prev,
                    language: e.target.value === "" ? null : e.target.value,
                  }))
                }
                placeholder="例: ja"
              />
            </label>
          </div>
        </div>
      </section>

      <section className={sectionCardClass}>
        <h2 className={sectionTitleClass}>公開と予約投稿</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="font-semibold">公開状態</span>
            <select
              className={`${textFieldClass} mt-1 block w-full`}
              value={draft.visibility}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  visibility: e.target.value as "public" | "unlisted" | "private",
                }))
              }
            >
              <option value="public">公開（public）</option>
              <option value="unlisted">限定公開（unlisted）</option>
              <option value="private">非公開（private）</option>
            </select>
          </label>

          <label className="block text-xs">
            <span className="font-semibold">公開予約日時（ローカル時間表示）</span>
            <input
              type="datetime-local"
              className={`${textFieldClass} mt-1 block w-full`}
              value={utcIsoToLocalDatetimeInput(draft.publishAt)}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  publishAt: localDatetimeInputToUtcIso(e.target.value),
                }))
              }
            />
            {draft.publishAt !== null && (
              <span className="mt-1 block text-xs text-gray-500">
                保存されるUTC時間: {draft.publishAt}
              </span>
            )}
          </label>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            id="premiere"
            checked={draft.premiere}
            onChange={(e) => updateDraft((prev) => ({ ...prev, premiere: e.target.checked }))}
          />
          <label htmlFor="premiere" className="text-xs">
            プレミア公開にする（Premiere）
          </label>
        </div>
      </section>

      <section className={sectionCardClass}>
        <h2 className={sectionTitleClass}>視聴者とコンテンツの申告</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="font-semibold">子ども向けの設定</span>
            <select
              className={`${textFieldClass} mt-1 block w-full`}
              value={draft.declarations.audience}
              onChange={(e) => {
                const val = e.target.value as "not_applicable" | "made_for_kids" | "not_made_for_kids";
                updateDraft((prev) => ({
                  ...prev,
                  declarations: { ...prev.declarations, audience: val },
                  comments:
                    val === "made_for_kids" && prev.comments.mode === "allow_all"
                      ? { mode: "disabled" as YouTubeCommentMode }
                      : prev.comments,
                }));
              }}
            >
              <option value="not_applicable">設定しない / 該当なし</option>
              <option value="made_for_kids">はい、子ども向けです</option>
              <option value="not_made_for_kids">いいえ、子ども向けではありません</option>
            </select>
          </label>

          <label className="block text-xs">
            <span className="font-semibold">年齢制限</span>
            <select
              className={`${textFieldClass} mt-1 block w-full`}
              value={draft.declarations.ageRestriction}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  declarations: {
                    ...prev.declarations,
                    ageRestriction: e.target.value as "not_applicable" | "restrict_over_18" | "do_not_restrict",
                  },
                }))
              }
            >
              <option value="not_applicable">設定しない / 該当なし</option>
              <option value="restrict_over_18">18歳以上の視聴者に制限する</option>
              <option value="do_not_restrict">18歳以上の視聴者に制限しない</option>
            </select>
          </label>

          <label className="block text-xs">
            <span className="font-semibold">有料プロダクト配置・案件</span>
            <select
              className={`${textFieldClass} mt-1 block w-full`}
              value={draft.declarations.paidPromotion}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  declarations: {
                    ...prev.declarations,
                    paidPromotion: e.target.value as "not_applicable" | "contains_paid_promotion" | "no_paid_promotion",
                  },
                }))
              }
            >
              <option value="not_applicable">設定しない / 該当なし</option>
              <option value="contains_paid_promotion">有料プロモーションを含む</option>
              <option value="no_paid_promotion">有料プロモーションを含まない</option>
            </select>
          </label>

          <label className="block text-xs">
            <span className="font-semibold">合成・改変されたコンテンツ（AI生成等）</span>
            <select
              className={`${textFieldClass} mt-1 block w-full`}
              value={draft.declarations.syntheticContent}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  declarations: {
                    ...prev.declarations,
                    syntheticContent: e.target.value as "not_applicable" | "altered_or_synthetic" | "none",
                  },
                }))
              }
            >
              <option value="not_applicable">設定しない / 該当なし</option>
              <option value="altered_or_synthetic">リアルに見える合成・改変コンテンツを含む</option>
              <option value="none">該当しない</option>
            </select>
          </label>
        </div>
      </section>

      <section className={sectionCardClass}>
        <h2 className={sectionTitleClass}>対話とライセンス設定</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs">
            <span className="font-semibold">コメント機能</span>
            <select
              className={`${textFieldClass} mt-1 block w-full`}
              value={draft.comments.mode}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  comments: { mode: e.target.value as YouTubeCommentMode },
                }))
              }
            >
              <option value="allow_all" disabled={isMadeForKids}>
                すべてのコメントを許可する{isMadeForKids ? "（子ども向け動画では不可）" : ""}
              </option>
              <option value="hold_potentially_inappropriate">
                不適切な可能性があるコメントを保留して確認する
              </option>
              <option value="hold_all">すべてのコメントを保留して確認する</option>
              <option value="disabled">コメントを無効にする</option>
            </select>
            {isMadeForKids && (
              <span className="mt-1 block text-amber-600">
                子ども向け動画に設定されているため「すべてのコメントを許可」は利用できません。
              </span>
            )}
          </label>

          <label className="block text-xs">
            <span className="font-semibold">Shorts リミックス</span>
            <select
              className={`${textFieldClass} mt-1 block w-full`}
              value={draft.shortsRemix}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  shortsRemix: e.target.value as "allow_video_and_audio" | "allow_audio_only" | "dont_allow",
                }))
              }
            >
              <option value="allow_video_and_audio">動画と音声のリミックスを許可</option>
              <option value="allow_audio_only">音声のみのリミックスを許可</option>
              <option value="dont_allow">リミックスを許可しない</option>
            </select>
          </label>

          <label className="block text-xs">
            <span className="font-semibold">ライセンス</span>
            <select
              className={`${textFieldClass} mt-1 block w-full`}
              value={draft.license}
              onChange={(e) =>
                updateDraft((prev) => ({
                  ...prev,
                  license: e.target.value as "youtube" | "creative_commons",
                }))
              }
            >
              <option value="youtube">標準の YouTube ライセンス</option>
              <option value="creative_commons">クリエイティブ・コモンズ - 表示</option>
            </select>
          </label>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="embeddable"
              checked={draft.embeddable}
              onChange={(e) => updateDraft((prev) => ({ ...prev, embeddable: e.target.checked }))}
            />
            <label htmlFor="embeddable" className="text-xs">
              埋め込みを許可する
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="notifySubscribers"
              checked={draft.notifySubscribers}
              onChange={(e) =>
                updateDraft((prev) => ({ ...prev, notifySubscribers: e.target.checked }))
              }
            />
            <label htmlFor="notifySubscribers" className="text-xs">
              チャンネル登録者に通知する
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="statisticsVisibility"
              checked={draft.statisticsVisibility}
              onChange={(e) =>
                updateDraft((prev) => ({ ...prev, statisticsVisibility: e.target.checked }))
              }
            />
            <label htmlFor="statisticsVisibility" className="text-xs">
              統計情報（視聴回数等）を公開する
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ratings"
              checked={draft.ratings}
              onChange={(e) => updateDraft((prev) => ({ ...prev, ratings: e.target.checked }))}
            />
            <label htmlFor="ratings" className="text-xs">
              高評価数を表示する
            </label>
          </div>
        </div>
      </section>

      <YouTubeSettingsTemplatePanel
        currentSettings={draft}
        defaultName={work.data?.title ?? "投稿設定テンプレート"}
        onApply={(doc) => {
          setDraft(doc);
          setTagsInput(doc.tags.join(", "));
          setDirty(true);
        }}
      />
    </div>
  );
}
